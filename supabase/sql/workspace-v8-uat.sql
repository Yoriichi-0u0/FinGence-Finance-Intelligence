-- FinGence workspace v8: the in-app UAT "Testing checklist". Requires workspace-v1.sql and workspace-v2-saic.sql.
--   - One row per member: their answers to the acceptance-testing tasks (lib/uat/tasks.ts) and the overall questions.
--     Nothing financial is stored: a result, a kind, a severity and the tester's own note per task.
--   - A member reads and writes only their own answers; no function takes a member ID for that. Admins and Superadmins
--     read everyone's in their organization (to follow progress and triage issues), never anyone else's organization.
--   - The answers have one strict shape (fingence_workspace.valid_uat); anything else is refused by the function and by
--     the table itself. Notes are at most 2,000 characters each.
--   - Feedback, not an action on the workspace, so saves are not written to the audit trail. Removing a member removes
--     their answers.
-- Like the rest of the workspace: RLS forced with no policies, and only the service role may execute the functions.
-- Written to be re-runnable, so an existing local store (scripts/dev-store.mjs) picks it up.

-- { "v": 1,
--   "tasks":   { "<1..11>": { "result": PASS|ISSUE|NOT_DONE, "kind"?: WORKS_WELL|CONFUSING|WRONG_RESULT|IDEA,
--                             "severity"?: BLOCKS|WORKAROUND|COSMETIC, "note"?: text } },
--   "overall": { "trust"?: 1..5, "trustWhy"?, "useful"?, "change"?, "other"?: text },
--   "context": { "device"?: text (browser, system and screen width, at most 120 characters) } }
create or replace function fingence_workspace.valid_uat(d jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare k text; t jsonb;
begin
    if d is null or jsonb_typeof(d) <> 'object' or d->'v' is distinct from '1'::jsonb then return false; end if;
    if exists (select 1 from jsonb_object_keys(d) x where x not in ('v', 'tasks', 'overall', 'context')) then return false; end if;
    if jsonb_typeof(d->'tasks') is distinct from 'object' or jsonb_typeof(d->'overall') is distinct from 'object' or jsonb_typeof(d->'context') is distinct from 'object' then return false; end if;
    for k, t in select key, value from jsonb_each(d->'tasks') loop
        if k !~ '^([1-9]|1[01])$' or jsonb_typeof(t) <> 'object' then return false; end if;
        if exists (select 1 from jsonb_object_keys(t) x where x not in ('result', 'kind', 'severity', 'note')) then return false; end if;
        if jsonb_typeof(t->'result') is distinct from 'string' or not (t->>'result' = any (array['PASS', 'ISSUE', 'NOT_DONE'])) then return false; end if;
        if t ? 'kind' and (jsonb_typeof(t->'kind') <> 'string' or not (t->>'kind' = any (array['WORKS_WELL', 'CONFUSING', 'WRONG_RESULT', 'IDEA']))) then return false; end if;
        if t ? 'severity' and (jsonb_typeof(t->'severity') <> 'string' or not (t->>'severity' = any (array['BLOCKS', 'WORKAROUND', 'COSMETIC']))) then return false; end if;
        if t ? 'note' and (jsonb_typeof(t->'note') <> 'string' or char_length(t->>'note') > 2000) then return false; end if;
    end loop;
    if exists (select 1 from jsonb_object_keys(d->'overall') x where x not in ('trust', 'trustWhy', 'useful', 'change', 'other')) then return false; end if;
    if d->'overall' ? 'trust' and (jsonb_typeof(d->'overall'->'trust') <> 'number' or not ((d->'overall'->>'trust') = any (array['1', '2', '3', '4', '5']))) then return false; end if;
    for k, t in select key, value from jsonb_each(d->'overall') where key <> 'trust' loop
        if jsonb_typeof(t) <> 'string' or char_length(t #>> '{}') > 2000 then return false; end if;
    end loop;
    if exists (select 1 from jsonb_object_keys(d->'context') x where x <> 'device') then return false; end if;
    if d->'context' ? 'device' and (jsonb_typeof(d->'context'->'device') <> 'string' or char_length(d->'context'->>'device') > 120) then return false; end if;
    return true;
end $$;
revoke all on function fingence_workspace.valid_uat(jsonb) from public, anon, authenticated;

create table if not exists fingence_workspace.uat_results (
    member_id uuid primary key references fingence_workspace.members(id) on delete cascade,
    organization_id uuid not null references fingence_workspace.organizations(id),
    answers jsonb not null constraint uat_results_answers_shape check (fingence_workspace.valid_uat(answers)),
    -- The FinGence version the answers were last saved against (the deployment's commit), for tying a finding to a build.
    app_version text not null check (app_version ~ '^[0-9a-z.-]{1,40}$'),
    submitted_at timestamptz,
    updated_at timestamptz not null default now(),
    -- Save order within one open checklist page: the page's random ID and its save counter. Saves from one page can reach
    -- the database out of order (an autosave still in flight, then the save sent on leaving the page), so an older one
    -- from the same page never replaces a newer one. A different page (another tab, device or visit) always saves.
    client_page text not null default '' check (client_page ~ '^[A-Za-z0-9_-]{0,40}$'),
    client_seq integer not null default 0 check (client_seq >= 0)
);
alter table fingence_workspace.uat_results add column if not exists client_page text not null default '' check (client_page ~ '^[A-Za-z0-9_-]{0,40}$');
alter table fingence_workspace.uat_results add column if not exists client_seq integer not null default 0 check (client_seq >= 0);
create index if not exists uat_results_organization on fingence_workspace.uat_results (organization_id, updated_at desc);
alter table fingence_workspace.uat_results enable row level security;
alter table fingence_workspace.uat_results force row level security;
revoke all on fingence_workspace.uat_results from public, anon, authenticated;

-- Any signed-in member: their own answers, or nulls when they have not started.
create or replace function public.fingence_workspace_uat(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; r fingence_workspace.uat_results;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 1 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into r from fingence_workspace.uat_results where member_id = a.member_id;
    return jsonb_build_object('answers', r.answers, 'submittedAt', r.submitted_at, 'updatedAt', r.updated_at);
end $$;

-- Any signed-in member: save their own answers; p_submit also marks them submitted (they stay editable afterwards).
-- p_page and p_seq order the saves of one open page: an older save from the same page changes nothing ("stale").
drop function if exists public.fingence_workspace_save_uat(text, jsonb, boolean, text);
create or replace function public.fingence_workspace_save_uat(p_token_hash text, p_answers jsonb, p_submit boolean, p_version text, p_page text, p_seq integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; r fingence_workspace.uat_results;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 1 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    if not fingence_workspace.valid_uat(p_answers) or pg_column_size(p_answers) > 200000 then return jsonb_build_object('error', 'INVALID_ANSWERS'); end if;
    if p_version is null or p_version !~ '^[0-9a-z.-]{1,40}$' then return jsonb_build_object('error', 'INVALID_ANSWERS'); end if;
    if p_page is null or p_page !~ '^[A-Za-z0-9_-]{8,40}$' or p_seq is null or p_seq < 0 then return jsonb_build_object('error', 'INVALID_ANSWERS'); end if;
    insert into fingence_workspace.uat_results (member_id, organization_id, answers, app_version, submitted_at, client_page, client_seq)
    values (a.member_id, a.organization_id, p_answers, p_version, case when p_submit then now() end, p_page, p_seq)
    on conflict (member_id) do update set answers = excluded.answers, app_version = excluded.app_version,
        submitted_at = coalesce(case when p_submit then now() end, fingence_workspace.uat_results.submitted_at), updated_at = now(),
        client_page = excluded.client_page, client_seq = excluded.client_seq
    where not (fingence_workspace.uat_results.client_page = excluded.client_page and fingence_workspace.uat_results.client_seq > excluded.client_seq)
    returning * into r;
    if not found then
        select * into r from fingence_workspace.uat_results where member_id = a.member_id;
        return jsonb_build_object('ok', true, 'stale', true, 'submittedAt', r.submitted_at, 'updatedAt', r.updated_at);
    end if;
    return jsonb_build_object('ok', true, 'submittedAt', r.submitted_at, 'updatedAt', r.updated_at);
end $$;

-- Admin and above: everyone's answers in their own organization, with who and in which role, newest first.
create or replace function public.fingence_workspace_uat_results(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    return jsonb_build_object('testers', coalesce((select jsonb_agg(jsonb_build_object('email', m.email, 'role', m.role, 'active', m.active, 'mine', r.member_id = a.member_id,
            'answers', r.answers, 'appVersion', r.app_version, 'submittedAt', r.submitted_at, 'updatedAt', r.updated_at) order by r.updated_at desc)
        from fingence_workspace.uat_results r join fingence_workspace.members m on m.id = r.member_id
        where r.organization_id = a.organization_id and m.organization_id = a.organization_id), '[]'::jsonb));
end $$;

do $$ declare f text; begin
    foreach f in array array['fingence_workspace_uat(text)', 'fingence_workspace_save_uat(text, jsonb, boolean, text, text, integer)', 'fingence_workspace_uat_results(text)'] loop
        execute format('revoke execute on function public.%s from public, anon, authenticated', f);
        execute format('grant execute on function public.%s to service_role', f);
    end loop;
end $$;
