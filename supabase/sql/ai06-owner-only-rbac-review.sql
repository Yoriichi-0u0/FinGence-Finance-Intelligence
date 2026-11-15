-- REVIEW ONLY: owner-only workspace financial access. Never reinstall existing migrations.
-- Requires workspace v1-v7 and processing-jobs-v1. Owner approval required before hosted execution.
-- Atomic, no financial row updates, no new table privileges, existing function ACLs preserved.
begin;

create or replace function public.fingence_workspace_history(p_token_hash text, p_scope text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    if p_scope is distinct from 'mine' then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    return jsonb_build_object(
        'usage', fingence_workspace.saved_usage(a.organization_id),
        'runs', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'at', r.processed_at, 'by', m.email, 'mine', r.member_id = a.member_id, 'processingId', r.processing_id,
                'status', r.status, 'businessId', r.business_id, 'businessName', r.business_name, 'period', r.period, 'currency', r.currency,
                'documents', (select jsonb_agg(jsonb_build_object('name', d->>'name', 'bytes', (d->>'bytes')::bigint, 'stored', (d->>'stored')::boolean)) from jsonb_array_elements(r.documents) d),
                'confidence', r.confidence, 'filesKept', r.files_kept) order by r.processed_at desc)
            from fingence_workspace.saved_runs r left join fingence_workspace.members m on m.id = r.member_id
            where r.organization_id = a.organization_id and r.member_id = a.member_id), '[]'));
end $$;

-- One saved run in full (its bundle and documents), for its owner only.
create or replace function public.fingence_workspace_saved_run(p_token_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; r fingence_workspace.saved_runs;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into r from fingence_workspace.saved_runs s where s.id = p_id and s.organization_id = a.organization_id;
    if not found or r.member_id is distinct from a.member_id then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    return jsonb_build_object('id', r.id, 'organizationId', r.organization_id, 'at', r.processed_at, 'processingId', r.processing_id, 'pipelineVersion', r.pipeline_version,
        'status', r.status, 'businessName', r.business_name, 'period', r.period, 'currency', r.currency,
        'documents', (select jsonb_agg(d || jsonb_build_object('objectKey', (select f.object_key from fingence_workspace.saved_files f where f.organization_id = r.organization_id and f.sha256 = d->>'sha256')) order by n)
            from jsonb_array_elements(r.documents) with ordinality as x(d, n)), 'confidence', r.confidence,
        'report', r.report, 'bundle', r.bundle, 'filesKept', r.files_kept);
end $$;

-- Delete a saved run (its owner only). Returns the files no saved run uses any more: the server removes them
-- from Storage, and their rows are already gone.
create or replace function public.fingence_workspace_delete_run(p_token_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; r fingence_workspace.saved_runs; orphans jsonb;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into r from fingence_workspace.saved_runs s where s.id = p_id and s.organization_id = a.organization_id for update;
    if not found or r.member_id is distinct from a.member_id then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    delete from fingence_workspace.saved_runs where id = r.id;
    with gone as (
        delete from fingence_workspace.saved_files f
        where f.organization_id = r.organization_id
          and f.sha256 in (select d->>'sha256' from jsonb_array_elements(r.documents) d)
          and not exists (select 1 from fingence_workspace.saved_runs o, jsonb_array_elements(o.documents) od
                          where o.organization_id = r.organization_id and o.files_kept and od->>'sha256' = f.sha256)
        returning f.sha256, f.object_key)
    select coalesce(jsonb_agg(jsonb_build_object('sha256', sha256, 'key', object_key)), '[]') into orphans from gone;
    perform fingence_workspace.log(a.organization_id, a.member_id, 'run.deleted', r.id, jsonb_build_object('processingId', r.processing_id, 'owner', r.member_id));
    return jsonb_build_object('deleted', r.id, 'removeFiles', orphans);
end $$;

-- The web API checks this token-bound contract before loading a financial resource.
create function public.fingence_workspace_owns_resource(p_token_hash text, p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; owned boolean := false;
begin
 select * into a from fingence_workspace.actor(p_token_hash);
 if not found then return jsonb_build_object('error','FORBIDDEN'); end if;
 if p_kind = 'JOB' then
  select exists(select 1 from fingence_processing.jobs j where j.id=p_id and j.organization_id=a.organization_id::text and j.member_id=a.member_id) into owned;
 elsif p_kind = 'SAVED_RUN' then
  select exists(select 1 from fingence_workspace.saved_runs r where r.id=p_id and r.organization_id=a.organization_id and r.member_id=a.member_id) into owned;
 else return jsonb_build_object('error','FORBIDDEN'); end if;
 return jsonb_build_object('version','owner-only/1','owned',owned);
end $$;
revoke all on function public.fingence_workspace_owns_resource(text,text,uuid) from public, anon, authenticated;
grant execute on function public.fingence_workspace_owns_resource(text,text,uuid) to service_role;
create or replace function public.fingence_workspace_log(p_token_hash text, p_since timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; since timestamptz;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    since := greatest(coalesce(p_since, now() - interval '7 days'), now() - interval '90 days');
    return jsonb_build_object(
        'since', since,
        -- Totals for the whole period, independent of the timeline's limits (200 runs, 1,000 AI calls).
        'totals', jsonb_build_object(
            'runs', (select count(*) from fingence_ingestion.runs r where r.organization_id = a.organization_id and r.member_id = a.member_id and r.created_at >= since),
            'serverRuns', (select count(*) from fingence_ingestion.runs r join fingence_processing.jobs j on j.ingestion_run_id = r.id where r.organization_id = a.organization_id and r.member_id = a.member_id and r.created_at >= since),
            'documents', (select count(*) from fingence_ingestion.documents d join fingence_ingestion.runs r on r.id = d.run_id where r.organization_id = a.organization_id and r.member_id = a.member_id and r.created_at >= since),
            'documentsByAi', (select count(*) from fingence_ingestion.documents d join fingence_ingestion.runs r on r.id = d.run_id where r.organization_id = a.organization_id and r.member_id = a.member_id and r.created_at >= since and d.method = 'AI_LAYOUT_PROPOSAL'),
            'failedJobs', (select count(*) from fingence_processing.jobs j where j.organization_id = a.organization_id::text and j.member_id = a.member_id and j.status = 'FAILED' and j.created_at >= since),
            'aiCalls', (select count(*) from fingence_workspace.ai_calls c where c.organization_id = a.organization_id and c.occurred_at >= since),
            'aiProblems', (select count(*) from fingence_workspace.ai_calls c where c.organization_id = a.organization_id and c.occurred_at >= since
                and (c.status <> 'OK' or coalesce(c.verdict, '') in ('WITHHELD', 'QUARANTINED'))),
            'tokens', (select coalesce(sum(coalesce(c.input_tokens, 0) + coalesce(c.output_tokens, 0)), 0) from fingence_workspace.ai_calls c where c.organization_id = a.organization_id and c.occurred_at >= since),
            'estimatedUsd', (select coalesce(sum(c.estimated_usd), 0) from fingence_workspace.ai_calls c where c.organization_id = a.organization_id and c.occurred_at >= since)),
        -- AI calls per day (Malaysia time), for the whole period.
        'daily', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'ok', x.ok, 'problem', x.problem) order by x.day) from (
            select (c.occurred_at at time zone 'Asia/Kuching')::date as day,
                count(*) filter (where not (c.status <> 'OK' or coalesce(c.verdict, '') in ('WITHHELD', 'QUARANTINED'))) as ok,
                count(*) filter (where c.status <> 'OK' or coalesce(c.verdict, '') in ('WITHHELD', 'QUARANTINED')) as problem
            from fingence_workspace.ai_calls c where c.organization_id = a.organization_id and c.occurred_at >= since group by 1) x), '[]'),
        'limits', jsonb_build_object('runs', 200, 'aiCalls', 1000),
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
            where r.organization_id = a.organization_id and r.member_id = a.member_id and r.created_at >= since
            order by r.created_at desc limit 200) runs), '[]'),
        'failedJobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'at', j.created_at, 'by', m.email, 'error', j.error, 'documents', jsonb_array_length(j.inputs)) order by j.created_at desc)
            from fingence_processing.jobs j left join fingence_workspace.members m on m.id = j.member_id
            where j.organization_id = a.organization_id::text and j.member_id = a.member_id and j.status = 'FAILED' and j.created_at >= since), '[]'),
        'aiCalls', coalesce((select jsonb_agg(x order by x->>'at' desc) from (
            select jsonb_build_object('at', c.occurred_at, 'by', m.email, 'feature', c.feature, 'provider', c.provider, 'model', c.model, 'keyLabel', c.key_label,
                'requestId', c.request_id, 'status', c.status, 'verdict', c.verdict, 'reasonCode', c.reason_code, 'inputTokens', c.input_tokens, 'outputTokens', c.output_tokens,
                'estimatedUsd', c.estimated_usd, 'latencyMs', c.latency_ms, 'jobId', c.job_id, 'processingId', c.processing_id) x
            from fingence_workspace.ai_calls c left join fingence_workspace.members m on m.id = c.member_id
            where c.organization_id = a.organization_id and c.occurred_at >= since
            order by c.occurred_at desc limit 1000) calls), '[]'));
end $$;

-- Distinct endpoint makes old deployments fail closed instead of returning organization-wide financial details.
create function public.fingence_workspace_own_log(p_token_hash text,p_since timestamptz) returns jsonb
language sql security definer set search_path = '' as $$
 select public.fingence_workspace_log(p_token_hash,p_since);
$$;
revoke all on function public.fingence_workspace_own_log(text,timestamptz) from public,anon,authenticated;
grant execute on function public.fingence_workspace_own_log(text,timestamptz) to service_role;
commit;
