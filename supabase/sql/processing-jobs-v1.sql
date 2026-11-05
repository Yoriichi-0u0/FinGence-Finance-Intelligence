-- FinGence server processing v1: processing jobs, their stored reconciliation and anomaly results, flagged items and
-- the processing pause. Requires ingestion-layer-v1.sql (a completed job stores its ingestion run atomically).
-- No uploaded document is stored: a job keeps fingerprints, stage decisions, accepted layout proposals and results.
-- Like the ingestion schema, it is not exposed to the Data API. RLS is enabled and forced with no policies; every
-- read and write is a SECURITY DEFINER function that only the service role may execute.
create schema if not exists fingence_processing;
revoke all on schema fingence_processing from public, anon, authenticated;

create table fingence_processing.controls (
    organization_id text primary key check (organization_id ~ '^[a-z0-9-]{1,64}$'),
    paused boolean not null default false,
    reason text check (reason is null or length(reason) between 1 and 300),
    changed_at timestamptz not null default now()
);
create table fingence_processing.jobs (
    id uuid primary key default gen_random_uuid(),
    organization_id text not null check (organization_id ~ '^[a-z0-9-]{1,64}$'),
    created_at timestamptz not null default now(),
    started_at timestamptz, finished_at timestamptz,
    status text not null default 'QUEUED' check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
    client_hash text check (client_hash is null or client_hash ~ '^[0-9a-f]{16,64}$'),
    inputs jsonb not null check (jsonb_typeof(inputs) = 'array' and jsonb_array_length(inputs) between 1 and 20),
    stages jsonb not null default '[]' check (jsonb_typeof(stages) = 'array' and jsonb_array_length(stages) <= 16),
    pipeline_version text check (length(pipeline_version) <= 64),
    processing_id text check (processing_id is null or processing_id ~ '^[0-9a-f]{8,64}$'),
    outcome text check (outcome is null or outcome in ('COMPLETED', 'COMPLETED_WITH_EXCEPTIONS', 'QUARANTINED')),
    scope jsonb,
    summary text check (length(summary) <= 600),
    flagged_count int not null default 0 check (flagged_count >= 0),
    interpretations jsonb not null default '{}' check (jsonb_typeof(interpretations) = 'object'),
    -- What the job read from each PDF or scan, for the browser's re-check; deleted 15 minutes after the job finishes.
    extractions jsonb not null default '{}' check (jsonb_typeof(extractions) = 'object' and pg_column_size(extractions) < 4000000),
    ingestion_run_id uuid references fingence_ingestion.runs(id) on delete set null,
    error text check (length(error) <= 300)
);
create table fingence_processing.results (
    job_id uuid primary key references fingence_processing.jobs(id) on delete cascade,
    reconciliation jsonb, anomalies jsonb, report jsonb, documents jsonb not null default '[]'
);
create table fingence_processing.flagged (
    job_id uuid not null references fingence_processing.jobs(id) on delete cascade,
    ordinal int not null check (ordinal >= 0),
    kind text not null check (kind in ('DOCUMENT', 'RECONCILIATION_EXCEPTION', 'ANOMALY_CANDIDATE', 'HISTORY')),
    reference text not null check (length(reference) between 1 and 300),
    status text not null check (length(status) <= 64),
    period text check (period is null or period ~ '^\d{4}-\d{2}$'),
    record_date date, currency char(3) check (currency is null or currency ~ '^[A-Z]{3}$'), signed_amount numeric(18, 2),
    title text not null check (length(title) <= 400),
    reason text not null check (length(reason) <= 2000),
    primary key (job_id, ordinal)
);
create index on fingence_processing.jobs (organization_id, created_at desc);
create index on fingence_processing.jobs (processing_id);

alter table fingence_processing.controls enable row level security;
alter table fingence_processing.controls force row level security;
alter table fingence_processing.jobs enable row level security;
alter table fingence_processing.jobs force row level security;
alter table fingence_processing.results enable row level security;
alter table fingence_processing.results force row level security;
alter table fingence_processing.flagged enable row level security;
alter table fingence_processing.flagged force row level security;
revoke all on all tables in schema fingence_processing from public, anon, authenticated;

-- A job that never finished within the longest run a server allows has stopped: it is failed, never left running.
-- What a job read from PDFs and scans is kept only for the browser's re-check, then deleted.
create function fingence_processing.reap(org text) returns void
language sql security definer set search_path = '' as $$
    update fingence_processing.jobs set status = 'FAILED', finished_at = now(), error = 'TIMED_OUT'
    where organization_id = org and status in ('QUEUED', 'RUNNING') and created_at < now() - interval '10 minutes';
    update fingence_processing.jobs set extractions = '{}'
    where organization_id = org and extractions <> '{}' and finished_at < now() - interval '15 minutes';
$$;
revoke execute on function fingence_processing.reap(text) from public, anon, authenticated;

-- The same for every organization, on a schedule that does not depend on anyone reading a job (see the end of this file).
create function public.fingence_processing_reap_all() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
    update fingence_processing.jobs set status = 'FAILED', finished_at = now(), error = 'TIMED_OUT'
    where status in ('QUEUED', 'RUNNING') and created_at < now() - interval '10 minutes';
    update fingence_processing.jobs set extractions = '{}' where extractions <> '{}' and finished_at < now() - interval '15 minutes';
    get diagnostics n = row_count;
    return n;
end $$;

-- A flagged item as JSON, in the field names the server and console use.
create function fingence_processing.flag_json(f fingence_processing.flagged) returns jsonb
language sql immutable set search_path = '' as $$
    select jsonb_build_object('ordinal', f.ordinal, 'kind', f.kind, 'reference', f.reference, 'status', f.status, 'period', f.period, 'date', f.record_date,
        'currency', f.currency, 'signedAmount', f.signed_amount::text, 'title', f.title, 'reason', f.reason)
$$;
revoke execute on function fingence_processing.flag_json(fingence_processing.flagged) from public, anon, authenticated;

-- A new job, unless the organization's processing is paused (checked in the same statement that creates the job).
create function public.fingence_processing_create_job(org text, inputs jsonb, client text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c fingence_processing.controls; job uuid;
begin
    perform fingence_processing.reap(org);
    select * into c from fingence_processing.controls where organization_id = org for share;
    if c.paused then return jsonb_build_object('error', 'PROCESSING_PAUSED', 'reason', c.reason, 'since', c.changed_at); end if;
    insert into fingence_processing.jobs (organization_id, inputs, client_hash) values (org, inputs, client) returning id into job;
    return jsonb_build_object('jobId', job);
end $$;

create function public.fingence_processing_start_job(job uuid) returns boolean
language sql security definer set search_path = '' as $$
    with s as (update fingence_processing.jobs set status = 'RUNNING', started_at = now() where id = job and status = 'QUEUED' returning 1)
    select exists (select 1 from s)
$$;

create function public.fingence_processing_job_stage(job uuid, stage jsonb) returns boolean
language sql security definer set search_path = '' as $$
    with s as (update fingence_processing.jobs set stages = stages || jsonb_build_array(stage)
        where id = job and status = 'RUNNING' and jsonb_array_length(stages) < 16 returning 1)
    select exists (select 1 from s)
$$;

-- A finished job, atomically: its ingestion run (documents, receipts, checks, verified records), its results and flagged items.
create function public.fingence_processing_finish_job(job uuid, run jsonb, result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j fingence_processing.jobs; run_id uuid; item jsonb; n bigint;
begin
    select * into j from fingence_processing.jobs where id = job for update;
    if not found or j.status <> 'RUNNING' then return jsonb_build_object('error', 'NOT_RUNNING'); end if;
    if jsonb_typeof(result->'flagged') <> 'array' or jsonb_array_length(result->'flagged') > 10000 then raise exception 'flagged must be an array of at most 10000'; end if;
    run_id := public.fingence_ingestion_record_run(run);
    update fingence_processing.jobs set status = 'COMPLETED', finished_at = now(), pipeline_version = result->>'pipelineVersion',
        processing_id = result->>'processingId', outcome = result->>'outcome', scope = result->'scope', summary = result->>'summary',
        flagged_count = jsonb_array_length(result->'flagged'), interpretations = coalesce(result->'interpretations', '{}'), extractions = coalesce(result->'extractions', '{}'), ingestion_run_id = run_id
    where id = job;
    insert into fingence_processing.results (job_id, reconciliation, anomalies, report, documents)
    values (job, result->'reconciliation', result->'anomalies', result->'report', coalesce(result->'documents', '[]'));
    for item, n in select value, ordinality - 1 from jsonb_array_elements(result->'flagged') with ordinality loop
        insert into fingence_processing.flagged (job_id, ordinal, kind, reference, status, period, record_date, currency, signed_amount, title, reason)
        values (job, n, item->>'kind', item->>'reference', item->>'status', item->>'period', (item->>'date')::date, item->>'currency',
            (item->>'signedAmount')::numeric, item->>'title', item->>'reason');
    end loop;
    return jsonb_build_object('jobId', job, 'ingestionRunId', run_id);
end $$;

create function public.fingence_processing_fail_job(job uuid, code text) returns boolean
language sql security definer set search_path = '' as $$
    with s as (update fingence_processing.jobs set status = 'FAILED', finished_at = now(), error = left(code, 300)
        where id = job and status in ('QUEUED', 'RUNNING') returning 1)
    select exists (select 1 from s)
$$;

-- One job as JSON. `detail` adds its stored results and flagged items.
create function public.fingence_processing_get_job(org text, job uuid, detail boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
    perform fingence_processing.reap(org);
    select jsonb_build_object('id', j.id, 'createdAt', j.created_at, 'startedAt', j.started_at, 'finishedAt', j.finished_at, 'status', j.status,
        'inputs', j.inputs, 'stages', j.stages, 'pipelineVersion', j.pipeline_version, 'processingId', j.processing_id, 'outcome', j.outcome,
        'scope', j.scope, 'summary', j.summary, 'flaggedCount', j.flagged_count, 'interpretations', j.interpretations,
        'extractions', j.extractions, 'ingestionRunId', j.ingestion_run_id, 'error', j.error)
        || case when detail then jsonb_build_object(
            'results', (select to_jsonb(r) - 'job_id' from fingence_processing.results r where r.job_id = j.id),
            'flagged', coalesce((select jsonb_agg(fingence_processing.flag_json(f) order by f.ordinal) from fingence_processing.flagged f where f.job_id = j.id), '[]'))
        else '{}'::jsonb end
    into out from fingence_processing.jobs j where j.id = job and j.organization_id = org;
    return out;
end $$;

-- The Management console: the pause state, recent jobs, and the items flagged by the latest completed job of each processing.
create function public.fingence_processing_overview(org text, max_jobs int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
    perform fingence_processing.reap(org);
    select jsonb_build_object(
        'processing', coalesce((select jsonb_build_object('paused', c.paused, 'reason', c.reason, 'changedAt', c.changed_at) from fingence_processing.controls c where c.organization_id = org),
            jsonb_build_object('paused', false, 'reason', null, 'changedAt', null)),
        'counts', (select jsonb_build_object('jobs', count(*), 'running', count(*) filter (where status in ('QUEUED', 'RUNNING')),
            'failed', count(*) filter (where status = 'FAILED')) from fingence_processing.jobs where organization_id = org),
        'jobs', coalesce((select jsonb_agg(x order by x->>'createdAt' desc) from (
            select jsonb_build_object('id', j.id, 'createdAt', j.created_at, 'startedAt', j.started_at, 'finishedAt', j.finished_at, 'status', j.status,
                'documents', jsonb_array_length(j.inputs), 'processingId', j.processing_id, 'outcome', j.outcome, 'scope', j.scope, 'summary', j.summary,
                'flaggedCount', j.flagged_count, 'ingestionRunId', j.ingestion_run_id, 'error', j.error, 'stage', j.stages->-1->>'id') as x
            from fingence_processing.jobs j where j.organization_id = org order by j.created_at desc limit greatest(1, least(max_jobs, 100))) s), '[]'),
        'flagged', coalesce((select jsonb_agg(fingence_processing.flag_json(f) || jsonb_build_object('jobId', l.id, 'createdAt', l.created_at, 'scope', l.scope) order by l.created_at desc, f.ordinal)
            from (select distinct on (processing_id) id, created_at, scope from fingence_processing.jobs
                  where organization_id = org and status = 'COMPLETED' order by processing_id, created_at desc) l
            join fingence_processing.flagged f on f.job_id = l.id), '[]'))
    into out;
    return out;
end $$;

-- Pause or resume the organization's processing. A pause needs a reason; Finance users see it.
create function public.fingence_processing_set_paused(org text, p_paused boolean, reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
    if p_paused and (reason is null or length(btrim(reason)) = 0) then return jsonb_build_object('error', 'REASON_REQUIRED'); end if;
    insert into fingence_processing.controls (organization_id, paused, reason, changed_at)
    values (org, p_paused, case when p_paused then left(btrim(reason), 300) end, now())
    on conflict (organization_id) do update set paused = excluded.paused, reason = excluded.reason, changed_at = excluded.changed_at;
    return jsonb_build_object('paused', p_paused);
end $$;

-- Processing state only (for the Data page): paused or not, and the reason Finance users see.
-- Each open Data page asks for this every 15 s, which also runs the cleanup.
create function public.fingence_processing_state(org text) returns jsonb
language sql security definer set search_path = '' as $$
    select fingence_processing.reap(org);
    select coalesce((select jsonb_build_object('paused', c.paused, 'reason', c.reason, 'changedAt', c.changed_at) from fingence_processing.controls c where c.organization_id = org),
        jsonb_build_object('paused', false, 'reason', null, 'changedAt', null))
$$;

do $$ declare f text; begin
    foreach f in array array['fingence_processing_create_job(text, jsonb, text)', 'fingence_processing_start_job(uuid)', 'fingence_processing_job_stage(uuid, jsonb)',
        'fingence_processing_finish_job(uuid, jsonb, jsonb)', 'fingence_processing_fail_job(uuid, text)', 'fingence_processing_get_job(text, uuid, boolean)',
        'fingence_processing_overview(text, int)', 'fingence_processing_set_paused(text, boolean, text)', 'fingence_processing_state(text)', 'fingence_processing_reap_all()'] loop
        execute format('revoke execute on function public.%s from public, anon, authenticated', f);
        execute format('grant execute on function public.%s to service_role', f);
    end loop;
end $$;
grant usage on schema fingence_processing to service_role;

-- Independent cleanup: where the pg_cron extension is enabled (Supabase: Database → Extensions), run it every 5 minutes.
-- Without pg_cron, the cleanup still runs on every job read, every new job and every Data page's 15 s state check,
-- and the local store (scripts/dev-store.mjs) runs it every minute.
do $$ begin
    if exists (select 1 from pg_extension where extname = 'pg_cron') then
        perform cron.schedule('fingence-processing-reap', '*/5 * * * *', 'select public.fingence_processing_reap_all()');
    end if;
end $$;
