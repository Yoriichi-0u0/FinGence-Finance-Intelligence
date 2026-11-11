-- FinGence Technical log (workspace v3). Requires ingestion-layer-v1, processing-jobs-v1, workspace-v1 and workspace-v2-saic.
--   1. A server job records who submitted it, and a finished job's ingestion run carries its organization and member,
--      so processing done on the server appears on the log (before this, only runs recorded from the browser did).
--   2. ai_calls: one row of metadata per AI call made through the AI-call door (lib/ai-calls). No prompt, answer,
--      document content or amount is stored. Rows older than 90 days are deleted as new ones arrive.
--   3. fingence_workspace_log: an Admin or Superadmin reads their organization's runs, failed jobs and AI calls.
-- Like the rest of the workspace: RLS forced with no policies, and only the service role may execute the functions.

alter table fingence_processing.jobs add column if not exists member_id uuid references fingence_workspace.members(id) on delete set null;

create table if not exists fingence_workspace.ai_calls (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references fingence_workspace.organizations(id),
    member_id uuid references fingence_workspace.members(id) on delete set null,
    job_id uuid references fingence_processing.jobs(id) on delete set null,
    occurred_at timestamptz not null default now(),
    feature text not null check (feature ~ '^[a-z][a-z0-9-]{1,40}$'),
    provider text not null check (provider ~ '^[A-Z][A-Z0-9_]{1,20}$'),
    model text not null check (model ~ '^[A-Za-z0-9._:/-]{1,100}$'),
    key_label text check (key_label ~ '^[a-z0-9][a-z0-9-]{0,40}$'),
    request_id text check (request_id ~ '^[A-Za-z0-9._:-]{1,100}$'),
    status text not null check (status in ('OK', 'REFUSED', 'RATE_LIMITED', 'FAILED')),
    verdict text check (verdict in ('ACCEPTED', 'QUARANTINED', 'ANSWERED', 'WITHHELD')),
    reason_code text check (reason_code ~ '^[A-Z][A-Z0-9_]{0,59}$'),
    input_tokens int check (input_tokens between 0 and 10000000),
    output_tokens int check (output_tokens between 0 and 10000000),
    estimated_usd numeric(12, 6) check (estimated_usd between 0 and 1000),
    latency_ms int not null check (latency_ms between 0 and 3600000),
    processing_id text check (processing_id ~ '^[0-9a-f]{8,64}$')
);
create index if not exists ai_calls_organization_time on fingence_workspace.ai_calls (organization_id, occurred_at desc);
create index if not exists ai_calls_time on fingence_workspace.ai_calls (occurred_at);
alter table fingence_workspace.ai_calls enable row level security;
alter table fingence_workspace.ai_calls force row level security;
revoke all on fingence_workspace.ai_calls from public, anon, authenticated;

-- A job created by a signed-in member: the same as the three-argument version, plus who submitted it (a member of that organization).
create or replace function public.fingence_processing_create_job(org text, inputs jsonb, client text, member uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c fingence_processing.controls; job uuid;
begin
    if member is not null and not exists (select 1 from fingence_workspace.members m where m.id = member and m.organization_id::text = org and m.active) then
        return jsonb_build_object('error', 'MEMBER_MISMATCH');
    end if;
    perform fingence_processing.reap(org);
    select * into c from fingence_processing.controls where organization_id = org for share;
    if c.paused then return jsonb_build_object('error', 'PROCESSING_PAUSED', 'reason', c.reason, 'since', c.changed_at); end if;
    insert into fingence_processing.jobs (organization_id, inputs, client_hash, member_id) values (org, inputs, client, member) returning id into job;
    return jsonb_build_object('jobId', job);
end $$;

-- As in processing-jobs-v1, plus: the ingestion run is stamped with the job's organization (when it is a workspace one) and member.
create or replace function public.fingence_processing_finish_job(job uuid, run jsonb, result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j fingence_processing.jobs; run_id uuid; item jsonb; n bigint;
begin
    select * into j from fingence_processing.jobs where id = job for update;
    if not found or j.status <> 'RUNNING' then return jsonb_build_object('error', 'NOT_RUNNING'); end if;
    if jsonb_typeof(result->'flagged') <> 'array' or jsonb_array_length(result->'flagged') > 10000 then raise exception 'flagged must be an array of at most 10000'; end if;
    run_id := public.fingence_ingestion_record_run(run);
    update fingence_ingestion.runs set organization_id = (select o.id from fingence_workspace.organizations o where o.id::text = j.organization_id), member_id = j.member_id
    where id = run_id;
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

-- Runs already finished by server jobs of a workspace organization (before this migration) get that organization; who ran them is unknown.
update fingence_ingestion.runs r set organization_id = o.id
from fingence_processing.jobs j join fingence_workspace.organizations o on o.id::text = j.organization_id
where j.ingestion_run_id = r.id and r.organization_id is null;

-- The AI-call door's sink (service role only): validates the caller against the organization, then keeps 90 days.
create or replace function public.fingence_workspace_record_ai_call(p_call jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare org uuid; mem uuid; job uuid; new_id uuid;
begin
    org := (p_call->>'organizationId')::uuid; mem := (p_call->>'memberId')::uuid; job := (p_call->>'jobId')::uuid;
    if not exists (select 1 from fingence_workspace.organizations o where o.id = org) then return jsonb_build_object('error', 'UNKNOWN_ORGANIZATION'); end if;
    if mem is not null and not exists (select 1 from fingence_workspace.members m where m.id = mem and m.organization_id = org) then return jsonb_build_object('error', 'MEMBER_MISMATCH'); end if;
    if job is not null and not exists (select 1 from fingence_processing.jobs x where x.id = job and x.organization_id = org::text) then job := null; end if;
    delete from fingence_workspace.ai_calls where occurred_at < now() - interval '90 days';
    insert into fingence_workspace.ai_calls (organization_id, member_id, job_id, feature, provider, model, key_label, request_id, status, verdict, reason_code,
        input_tokens, output_tokens, estimated_usd, latency_ms, processing_id)
    values (org, mem, job, p_call->>'feature', p_call->>'provider', p_call->>'model', p_call->>'keyLabel', p_call->>'requestId', p_call->>'status', p_call->>'verdict', p_call->>'reasonCode',
        (p_call->>'inputTokens')::int, (p_call->>'outputTokens')::int, (p_call->>'estimatedUsd')::numeric, (p_call->>'latencyMs')::int, p_call->>'processingId')
    returning ai_calls.id into new_id;
    return jsonb_build_object('id', new_id);
end $$;

-- Admin and above: the organization's processing runs (with each document's method, model and checks), failed jobs and AI calls since a time
-- (at most 90 days back). Never a record, an amount or a document's content.
create or replace function public.fingence_workspace_log(p_token_hash text, p_since timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; since timestamptz;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    since := greatest(coalesce(p_since, now() - interval '7 days'), now() - interval '90 days');
    return jsonb_build_object(
        'since', since,
        'runs', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
            select jsonb_build_object('id', r.id, 'at', r.created_at, 'by', m.email, 'source', case when j.id is null then 'BROWSER' else 'SERVER' end, 'jobId', j.id,
                'durationMs', case when j.finished_at is not null and j.started_at is not null then (extract(epoch from j.finished_at - j.started_at) * 1000)::int end,
                'outcome', j.outcome, 'flagged', j.flagged_count, 'processingId', r.processing_id, 'pipelineVersion', r.pipeline_version, 'scope', r.scope,
                -- A server job's stages (title, decision, how many checks failed); a run recorded from the browser has none stored.
                'stages', coalesce((select jsonb_agg(jsonb_build_object('title', s->>'title', 'decision', s->>'decision', 'failedChecks', coalesce(jsonb_array_length(s->'failedChecks'), 0)))
                    from jsonb_array_elements(coalesce(j.stages, '[]')) s), '[]'),
                'documents', coalesce((select jsonb_agg(jsonb_build_object('name', d.name, 'role', d.role, 'format', d.format, 'decision', d.decision, 'method', d.method,
                        'model', d.model, 'receiptMode', d.receipt_mode, 'inputTokens', d.input_tokens, 'outputTokens', d.output_tokens, 'estimatedUsd', d.estimated_usd,
                        'checks', jsonb_array_length(d.checks), 'failedChecks', (select count(*) from jsonb_array_elements(d.checks) c where (c->>'passed')::boolean is not true)) order by d.ordinal)
                    from fingence_ingestion.documents d where d.run_id = r.id), '[]')) x
            from fingence_ingestion.runs r
            left join fingence_workspace.members m on m.id = r.member_id
            left join fingence_processing.jobs j on j.ingestion_run_id = r.id
            where r.organization_id = a.organization_id and r.created_at >= since
            order by r.created_at desc limit 200) runs), '[]'),
        'failedJobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'at', j.created_at, 'by', m.email, 'error', j.error, 'documents', jsonb_array_length(j.inputs)) order by j.created_at desc)
            from fingence_processing.jobs j left join fingence_workspace.members m on m.id = j.member_id
            where j.organization_id = a.organization_id::text and j.status = 'FAILED' and j.created_at >= since), '[]'),
        'aiCalls', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
            select jsonb_build_object('at', c.occurred_at, 'by', m.email, 'feature', c.feature, 'provider', c.provider, 'model', c.model, 'keyLabel', c.key_label,
                'requestId', c.request_id, 'status', c.status, 'verdict', c.verdict, 'reasonCode', c.reason_code, 'inputTokens', c.input_tokens, 'outputTokens', c.output_tokens,
                'estimatedUsd', c.estimated_usd, 'latencyMs', c.latency_ms, 'jobId', c.job_id, 'processingId', c.processing_id) x
            from fingence_workspace.ai_calls c left join fingence_workspace.members m on m.id = c.member_id
            where c.organization_id = a.organization_id and c.occurred_at >= since
            order by c.occurred_at desc limit 1000) calls), '[]'));
end $$;

do $$ declare f text; begin
    foreach f in array array['fingence_processing_create_job(text, jsonb, text, uuid)', 'fingence_processing_finish_job(uuid, jsonb, jsonb)',
        'fingence_workspace_record_ai_call(jsonb)', 'fingence_workspace_log(text, timestamptz)'] loop
        execute format('revoke execute on function public.%s from public, anon, authenticated', f);
        execute format('grant execute on function public.%s to service_role', f);
    end loop;
end $$;
