-- FinGence saved runs (workspace v6), on top of workspace v1–v3 (and independent of v4/v5). Owner's decisions, 12 Nov 2026:
-- every completed run is saved for the person who ran it, with its documents, until they (or an Admin) delete it; each
-- person sees their own runs, and Admins and Superadmins see everyone's in the organization.
--
--   saved_runs   one row per run: what it was (business, period, currency, documents, confidence, report summary) and the
--                small restore bundle (the AI's accepted layout readings, OCR readings, server job). With the documents,
--                the bundle reproduces every result exactly; no figure is stored that could drift from its source.
--   saved_files  each document stored once per organization, by SHA-256, in a private Storage bucket (the file bytes are
--                never in the database). A file is removed when no saved run uses it any more.
--
-- Free-plan guard: at most 900 MB of files and 300 MB of saved-run rows per organization. When files would exceed the cap,
-- the run is still saved (summary and report) without its documents, and it cannot be reopened.
-- RLS is forced with no policies; every function is SECURITY DEFINER and executable by the service role only.

create table if not exists fingence_workspace.saved_files (
    organization_id uuid not null references fingence_workspace.organizations(id),
    sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
    bytes bigint not null check (bytes between 1 and 50000000),
    content_type text not null check (content_type ~ '^[a-z]+/[a-z0-9.+-]{1,80}$'),
    created_at timestamptz not null default now(),
    primary key (organization_id, sha256)
);
create table if not exists fingence_workspace.saved_runs (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references fingence_workspace.organizations(id),
    member_id uuid references fingence_workspace.members(id) on delete set null,
    created_at timestamptz not null default now(),
    processed_at timestamptz not null,
    processing_id text not null check (processing_id ~ '^[0-9a-f]{8,64}$'),
    pipeline_version text not null check (length(pipeline_version) between 1 and 64),
    status text not null check (status in ('COMPLETED', 'COMPLETED_WITH_EXCEPTIONS', 'QUARANTINED')),
    business_id text check (length(business_id) <= 64),
    business_name text check (length(business_name) <= 200),
    period text check (period ~ '^\d{4}-\d{2}(/\d{4}-\d{2})?$'),
    currency char(3) check (currency ~ '^[A-Z]{3}$'),
    -- [{ name, provenance, sha256, bytes, contentType, stored }]
    documents jsonb not null check (jsonb_typeof(documents) = 'array' and jsonb_array_length(documents) between 1 and 20),
    -- { status, percent?, band? }
    confidence jsonb not null check (jsonb_typeof(confidence) = 'object'),
    report jsonb check (report is null or jsonb_typeof(report) = 'object'),
    -- { interpretations, extractions?, job? }: what the browser needs to reproduce the run from the documents
    bundle jsonb not null check (jsonb_typeof(bundle) = 'object' and pg_column_size(bundle) < 4000000),
    files_kept boolean not null
);
create index if not exists saved_runs_organization_time on fingence_workspace.saved_runs (organization_id, created_at desc);
create index if not exists saved_runs_member_time on fingence_workspace.saved_runs (member_id, created_at desc);
alter table fingence_workspace.saved_files enable row level security;
alter table fingence_workspace.saved_files force row level security;
alter table fingence_workspace.saved_runs enable row level security;
alter table fingence_workspace.saved_runs force row level security;
revoke all on fingence_workspace.saved_files, fingence_workspace.saved_runs from public, anon, authenticated;

create or replace function fingence_workspace.saved_usage(org uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
    select jsonb_build_object(
        'filesBytes', coalesce((select sum(f.bytes) from fingence_workspace.saved_files f where f.organization_id = org), 0),
        'rowsBytes', coalesce((select sum(pg_column_size(r.*)) from fingence_workspace.saved_runs r where r.organization_id = org), 0),
        'runs', (select count(*) from fingence_workspace.saved_runs r where r.organization_id = org),
        'filesCap', 900000000, 'rowsCap', 300000000)
$$;
revoke all on function fingence_workspace.saved_usage(uuid) from public, anon, authenticated;

-- Before uploading: which of these documents the organization already stores, and whether the new ones fit under the cap.
create or replace function public.fingence_workspace_plan_save(p_org uuid, p_member uuid, p_files jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare usage jsonb; missing jsonb; needed bigint;
begin
    if not exists (select 1 from fingence_workspace.members m where m.id = p_member and m.organization_id = p_org and m.active) then return jsonb_build_object('error', 'MEMBER_MISMATCH'); end if;
    usage := fingence_workspace.saved_usage(p_org);
    select coalesce(jsonb_agg(f->>'sha256'), '[]'), coalesce(sum((f->>'bytes')::bigint), 0) into missing, needed
    from jsonb_array_elements(p_files) f
    where not exists (select 1 from fingence_workspace.saved_files s where s.organization_id = p_org and s.sha256 = f->>'sha256');
    return jsonb_build_object('upload', missing, 'filesFit', (usage->>'filesBytes')::bigint + needed <= (usage->>'filesCap')::bigint,
        'rowsFit', (usage->>'rowsBytes')::bigint < (usage->>'rowsCap')::bigint);
end $$;

-- After uploading: the run, and (when its documents were kept) the files it uses. The server has already checked the session.
create or replace function public.fingence_workspace_save_run(p_org uuid, p_member uuid, p_run jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare kept boolean := coalesce((p_run->>'filesKept')::boolean, false); new_id uuid; usage jsonb;
begin
    if not exists (select 1 from fingence_workspace.members m where m.id = p_member and m.organization_id = p_org and m.active) then return jsonb_build_object('error', 'MEMBER_MISMATCH'); end if;
    usage := fingence_workspace.saved_usage(p_org);
    if (usage->>'rowsBytes')::bigint >= (usage->>'rowsCap')::bigint then return jsonb_build_object('error', 'STORAGE_FULL'); end if;
    if kept then
        insert into fingence_workspace.saved_files (organization_id, sha256, bytes, content_type)
        select p_org, d->>'sha256', (d->>'bytes')::bigint, d->>'contentType' from jsonb_array_elements(p_run->'documents') d
        on conflict (organization_id, sha256) do nothing;
    end if;
    insert into fingence_workspace.saved_runs (organization_id, member_id, processed_at, processing_id, pipeline_version, status, business_id, business_name, period, currency,
        documents, confidence, report, bundle, files_kept)
    values (p_org, p_member, (p_run->>'processedAt')::timestamptz, p_run->>'processingId', p_run->>'pipelineVersion', p_run->>'status', p_run->>'businessId', p_run->>'businessName',
        p_run->>'period', p_run->>'currency',
        (select coalesce(jsonb_agg(d || jsonb_build_object('stored', kept)), '[]') from jsonb_array_elements(p_run->'documents') d),
        p_run->'confidence', p_run->'report', p_run->'bundle', kept)
    returning saved_runs.id into new_id;
    return jsonb_build_object('id', new_id, 'filesKept', kept);
end $$;

-- A signed-in member's history: their own runs, or (Admin and above, scope 'all') everyone's in the organization. No bundle.
create or replace function public.fingence_workspace_history(p_token_hash text, p_scope text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    if p_scope = 'all' and fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    return jsonb_build_object(
        'usage', fingence_workspace.saved_usage(a.organization_id),
        'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'at', r.processed_at, 'by', m.email, 'mine', r.member_id = a.member_id, 'processingId', r.processing_id,
                'status', r.status, 'businessId', r.business_id, 'businessName', r.business_name, 'period', r.period, 'currency', r.currency,
                'documents', (select jsonb_agg(jsonb_build_object('name', d->>'name', 'bytes', (d->>'bytes')::bigint, 'stored', (d->>'stored')::boolean)) from jsonb_array_elements(r.documents) d),
                'confidence', r.confidence, 'filesKept', r.files_kept) order by r.processed_at desc)
            from fingence_workspace.saved_runs r left join fingence_workspace.members m on m.id = r.member_id
            where r.organization_id = a.organization_id and (p_scope = 'all' or r.member_id = a.member_id)), '[]'));
end $$;

-- One saved run in full (its bundle and documents), for its owner or an Admin and above of the same organization.
create or replace function public.fingence_workspace_saved_run(p_token_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; r fingence_workspace.saved_runs;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into r from fingence_workspace.saved_runs s where s.id = p_id and s.organization_id = a.organization_id;
    if not found or (r.member_id is distinct from a.member_id and fingence_workspace.rank(a.role) < 2) then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    return jsonb_build_object('id', r.id, 'organizationId', r.organization_id, 'at', r.processed_at, 'processingId', r.processing_id, 'pipelineVersion', r.pipeline_version,
        'status', r.status, 'businessName', r.business_name, 'period', r.period, 'currency', r.currency, 'documents', r.documents, 'confidence', r.confidence,
        'report', r.report, 'bundle', r.bundle, 'filesKept', r.files_kept);
end $$;

-- Delete a saved run (its owner, or an Admin and above). Returns the files no saved run uses any more: the server removes them
-- from Storage, and their rows are already gone.
create or replace function public.fingence_workspace_delete_run(p_token_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; r fingence_workspace.saved_runs; orphans jsonb;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into r from fingence_workspace.saved_runs s where s.id = p_id and s.organization_id = a.organization_id for update;
    if not found or (r.member_id is distinct from a.member_id and fingence_workspace.rank(a.role) < 2) then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    delete from fingence_workspace.saved_runs where id = r.id;
    with gone as (
        delete from fingence_workspace.saved_files f
        where f.organization_id = r.organization_id
          and f.sha256 in (select d->>'sha256' from jsonb_array_elements(r.documents) d)
          and not exists (select 1 from fingence_workspace.saved_runs o, jsonb_array_elements(o.documents) od
                          where o.organization_id = r.organization_id and o.files_kept and od->>'sha256' = f.sha256)
        returning f.sha256)
    select coalesce(jsonb_agg(sha256), '[]') into orphans from gone;
    perform fingence_workspace.log(a.organization_id, a.member_id, 'run.deleted', r.id, jsonb_build_object('processingId', r.processing_id, 'owner', r.member_id));
    return jsonb_build_object('deleted', r.id, 'removeFiles', orphans);
end $$;

do $$ declare f text; begin
    foreach f in array array['fingence_workspace_plan_save(uuid, uuid, jsonb)', 'fingence_workspace_save_run(uuid, uuid, jsonb)', 'fingence_workspace_history(text, text)',
        'fingence_workspace_saved_run(text, uuid)', 'fingence_workspace_delete_run(text, uuid)'] loop
        execute format('revoke execute on function public.%s from public, anon, authenticated', f);
        execute format('grant execute on function public.%s to service_role', f);
    end loop;
end $$;
