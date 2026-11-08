-- Applied to the FinGence-Production Supabase project (zmtdozblpvtjniehwjrw) on 4 Nov 2026 as migration fingence_ingestion_v1.
-- FinGence ingestion layer v1: verified ingestion runs (fingerprints, model receipts, gate checks, canonical records).
-- No raw document is stored. The schema is not exposed to the Data API; writes and reads go through two
-- SECURITY DEFINER functions that only the service role may execute. RLS is enabled and forced with no policies.
create schema if not exists fingence_ingestion;
revoke all on schema fingence_ingestion from public, anon, authenticated;

create table fingence_ingestion.runs (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    pipeline_version text not null check (length(pipeline_version) <= 64),
    processing_id text not null check (processing_id ~ '^[0-9a-f]{8,64}$'),
    scope jsonb not null,
    client_hash text check (client_hash is null or client_hash ~ '^[0-9a-f]{16,64}$'),
    document_count int not null check (document_count between 1 and 20)
);
create table fingence_ingestion.documents (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references fingence_ingestion.runs(id) on delete cascade,
    ordinal int not null check (ordinal >= 0),
    name text not null check (length(name) between 1 and 160),
    file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
    table_sha256 text not null check (table_sha256 ~ '^[0-9a-f]{64}$'),
    format text not null check (format in ('CSV', 'XLSX', 'PDF_TEXT', 'OCR')),
    role text check (role in ('BANK_STATEMENT', 'GENERAL_LEDGER', 'BANK_HISTORY')),
    decision text not null check (decision in ('AUTO_ACCEPTED', 'QUARANTINED', 'UNAVAILABLE')),
    reason text not null check (length(reason) <= 2000),
    method text not null check (method in ('EXACT_SIGNATURE', 'AI_LAYOUT_PROPOSAL', 'NONE')),
    model text, model_request_id text, receipt_mode text check (receipt_mode is null or receipt_mode in ('LIVE', 'REPLAYED')),
    input_tokens int, output_tokens int, estimated_usd numeric(12, 6),
    mapping jsonb not null default '[]', checks jsonb not null default '[]', disclosures jsonb not null default '[]', notes jsonb not null default '[]',
    canonical_sha256 text check (canonical_sha256 is null or canonical_sha256 ~ '^[0-9a-f]{64}$'),
    unique (run_id, ordinal)
);
create table fingence_ingestion.records (
    document_id uuid not null references fingence_ingestion.documents(id) on delete cascade,
    ordinal int not null check (ordinal >= 0),
    record_id text not null check (length(record_id) between 1 and 64),
    business_id text not null check (length(business_id) between 1 and 64),
    transaction_date date not null,
    currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
    signed_cents bigint not null,
    reference text check (length(reference) <= 200),
    description text check (length(description) <= 500),
    counterparty text check (length(counterparty) <= 200),
    primary key (document_id, ordinal)
);
create index on fingence_ingestion.documents (run_id);
create index on fingence_ingestion.documents (file_sha256);

alter table fingence_ingestion.runs enable row level security;
alter table fingence_ingestion.runs force row level security;
alter table fingence_ingestion.documents enable row level security;
alter table fingence_ingestion.documents force row level security;
alter table fingence_ingestion.records enable row level security;
alter table fingence_ingestion.records force row level security;
revoke all on all tables in schema fingence_ingestion from public, anon, authenticated;

-- One run, atomically: the run, its documents, and each accepted document's canonical records.
create function public.fingence_ingestion_record_run(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
    run_id uuid; doc jsonb; doc_ordinal bigint; doc_id uuid;
begin
    if jsonb_typeof(payload->'documents') <> 'array' or jsonb_array_length(payload->'documents') not between 1 and 20 then
        raise exception 'documents must be an array of 1 to 20';
    end if;
    insert into fingence_ingestion.runs (pipeline_version, processing_id, scope, client_hash, document_count)
    values (payload->>'pipelineVersion', payload->>'processingId', coalesce(payload->'scope', '{}'::jsonb), payload->>'clientHash', jsonb_array_length(payload->'documents'))
    returning id into run_id;
    for doc, doc_ordinal in select value, ordinality - 1 from jsonb_array_elements(payload->'documents') with ordinality loop
        if jsonb_typeof(coalesce(doc->'records', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(doc->'records', '[]'::jsonb)) > 5000 then
            raise exception 'records must be an array of at most 5000';
        end if;
        insert into fingence_ingestion.documents (run_id, ordinal, name, file_sha256, table_sha256, format, role, decision, reason, method,
            model, model_request_id, receipt_mode, input_tokens, output_tokens, estimated_usd, mapping, checks, disclosures, notes, canonical_sha256)
        values (run_id, doc_ordinal, doc->>'name', doc->>'fileSha256', doc->>'tableSha256', doc->>'format', doc->>'role', doc->>'decision', doc->>'reason', doc->>'method',
            doc->>'model', doc->>'modelRequestId', doc->>'receiptMode', (doc->>'inputTokens')::int, (doc->>'outputTokens')::int, (doc->>'estimatedUsd')::numeric,
            coalesce(doc->'mapping', '[]'), coalesce(doc->'checks', '[]'), coalesce(doc->'disclosures', '[]'), coalesce(doc->'notes', '[]'), doc->>'canonicalSha256')
        returning id into doc_id;
        insert into fingence_ingestion.records (document_id, ordinal, record_id, business_id, transaction_date, currency, signed_cents, reference, description, counterparty)
        select doc_id, r.ordinality - 1, r.value->>'recordId', r.value->>'businessId', (r.value->>'date')::date, r.value->>'currency', (r.value->>'signedCents')::bigint,
            r.value->>'reference', r.value->>'description', r.value->>'counterparty'
        from jsonb_array_elements(coalesce(doc->'records', '[]'::jsonb)) with ordinality as r;
    end loop;
    return run_id;
end $$;

-- A stored run as JSON, for the layers that read ingestion output.
create function public.fingence_ingestion_get_run(run uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
    select jsonb_build_object(
        'run', to_jsonb(r),
        'documents', coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('records',
            coalesce((select jsonb_agg(to_jsonb(x) order by x.ordinal) from fingence_ingestion.records x where x.document_id = d.id), '[]'))
            order by d.ordinal) from fingence_ingestion.documents d where d.run_id = r.id), '[]'))
    from fingence_ingestion.runs r where r.id = run
$$;

revoke execute on function public.fingence_ingestion_record_run(jsonb) from public, anon, authenticated;
revoke execute on function public.fingence_ingestion_get_run(uuid) from public, anon, authenticated;
grant usage on schema fingence_ingestion to service_role;
grant execute on function public.fingence_ingestion_record_run(jsonb) to service_role;
grant execute on function public.fingence_ingestion_get_run(uuid) to service_role;
