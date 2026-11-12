-- Applied to the FinGence-Production Supabase project (zmtdozblpvtjniehwjrw) on 4 Nov 2026 as migration fingence_workspace_v1.
-- FinGence workspace v1: organizations, members with one of three roles, sign-in sessions, processing control and audit.
-- Requires ingestion-layer-v1.sql. Like the ingestion schema, nothing is exposed to the Data API: every read and write goes
-- through SECURITY DEFINER functions that only the service role may execute, and every function that acts for a person
-- takes the SHA-256 of that person's session token and checks the role inside the database.
-- Passwords are hashed (scrypt) and session tokens / enrollment codes are generated on the server; only their hashes arrive here.
create schema if not exists fingence_workspace;
revoke all on schema fingence_workspace from public, anon, authenticated;

create table fingence_workspace.organizations (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(name) between 1 and 120),
    created_at timestamptz not null default now(),
    processing_paused boolean not null default false,
    paused_reason text check (paused_reason is null or length(paused_reason) between 1 and 500),
    paused_at timestamptz,
    paused_by uuid
);
create table fingence_workspace.members (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references fingence_workspace.organizations(id),
    email text not null unique check (email = lower(email) and length(email) between 3 and 200),
    role text not null check (role in ('FINANCE', 'MANAGEMENT', 'ADMIN')),
    active boolean not null default true,
    password_hash text not null check (length(password_hash) between 32 and 300),
    created_at timestamptz not null default now(),
    version int not null default 1
);
create table fingence_workspace.invitations (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null references fingence_workspace.organizations(id),
    email text not null check (email = lower(email) and length(email) between 3 and 200),
    role text not null check (role in ('FINANCE', 'MANAGEMENT', 'ADMIN')),
    issuer text not null check (issuer in ('ADMIN', 'OWNER')),
    issued_by uuid references fingence_workspace.members(id),
    code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
    state text not null default 'PENDING' check (state in ('PENDING', 'ACCEPTED', 'REVOKED')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
);
create table fingence_workspace.sessions (
    id uuid primary key default gen_random_uuid(),
    member_id uuid not null references fingence_workspace.members(id),
    token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    expires_at timestamptz not null,
    ended_at timestamptz,
    end_reason text check (end_reason in ('SIGNED_OUT', 'ENDED_BY_MANAGEMENT', 'ENDED_BY_ADMIN', 'ACCESS_CHANGED')),
    ended_by uuid references fingence_workspace.members(id)
);
create table fingence_workspace.audit (
    id bigint generated always as identity primary key,
    organization_id uuid not null references fingence_workspace.organizations(id),
    actor_id uuid references fingence_workspace.members(id),
    action text not null check (action ~ '^[a-z_]+\.[a-z_]+$'),
    target_id uuid,
    detail jsonb not null default '{}',
    occurred_at timestamptz not null default now()
);
create index on fingence_workspace.members (organization_id);
create index on fingence_workspace.sessions (member_id) where ended_at is null;
create index on fingence_workspace.audit (organization_id, occurred_at desc);

alter table fingence_ingestion.runs add column organization_id uuid references fingence_workspace.organizations(id);
alter table fingence_ingestion.runs add column member_id uuid references fingence_workspace.members(id);
create index on fingence_ingestion.runs (organization_id, created_at desc);

alter table fingence_workspace.organizations enable row level security;
alter table fingence_workspace.organizations force row level security;
alter table fingence_workspace.members enable row level security;
alter table fingence_workspace.members force row level security;
alter table fingence_workspace.invitations enable row level security;
alter table fingence_workspace.invitations force row level security;
alter table fingence_workspace.sessions enable row level security;
alter table fingence_workspace.sessions force row level security;
alter table fingence_workspace.audit enable row level security;
alter table fingence_workspace.audit force row level security;
revoke all on all tables in schema fingence_workspace from public, anon, authenticated;

-- The signed-in person behind a session token hash: an open, unexpired session of an active member. Internal only.
create function fingence_workspace.actor(p_token_hash text) returns table (session_id uuid, member_id uuid, email text, role text, organization_id uuid)
language sql stable security definer set search_path = '' as $$
    select s.id, m.id, m.email, m.role, m.organization_id
    from fingence_workspace.sessions s join fingence_workspace.members m on m.id = s.member_id
    where s.token_hash = p_token_hash and s.ended_at is null and s.expires_at > now() and m.active
$$;
create function fingence_workspace.log(p_org uuid, p_actor uuid, p_action text, p_target uuid, p_detail jsonb default '{}') returns void
language sql security definer set search_path = '' as $$
    insert into fingence_workspace.audit (organization_id, actor_id, action, target_id, detail) values (p_org, p_actor, p_action, p_target, p_detail)
$$;
create function fingence_workspace.end_sessions(p_member uuid, p_reason text, p_by uuid) returns int
language sql security definer set search_path = '' as $$
    with ended as (update fingence_workspace.sessions set ended_at = now(), end_reason = p_reason, ended_by = p_by
        where member_id = p_member and ended_at is null returning 1)
    select count(*)::int from ended
$$;
revoke all on function fingence_workspace.actor(text) from public, anon, authenticated;
revoke all on function fingence_workspace.log(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function fingence_workspace.end_sessions(uuid, text, uuid) from public, anon, authenticated;

-- Owner bootstrap (run by the project owner in SQL, never through the app): an organization and a one-time Admin code.
create function public.fingence_workspace_bootstrap(p_name text, p_admin_email text, p_code_hash text, p_hours int default 72) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare org uuid; inv uuid; expires timestamptz;
begin
    if p_hours not between 1 and 168 then raise exception 'hours must be 1 to 168'; end if;
    insert into fingence_workspace.organizations (name) values (p_name) returning id into org;
    insert into fingence_workspace.invitations (organization_id, email, role, issuer, code_hash, expires_at)
    values (org, lower(trim(p_admin_email)), 'ADMIN', 'OWNER', p_code_hash, now() + make_interval(hours => p_hours)) returning id, expires_at into inv, expires;
    perform fingence_workspace.log(org, null, 'invitation.issued', inv, jsonb_build_object('role', 'ADMIN', 'issuer', 'OWNER'));
    return jsonb_build_object('organizationId', org, 'invitationId', inv, 'expiresAt', expires);
end $$;

-- Redeem a one-time code with a new password. The invitation is the approval: the membership is active at once.
create function public.fingence_workspace_redeem(p_code_hash text, p_password_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inv fingence_workspace.invitations; member uuid;
begin
    select * into inv from fingence_workspace.invitations where code_hash = p_code_hash for update;
    if not found or inv.state <> 'PENDING' or inv.expires_at <= now() then return jsonb_build_object('error', 'INVITATION_UNAVAILABLE'); end if;
    if exists (select 1 from fingence_workspace.members where email = inv.email) then return jsonb_build_object('error', 'ALREADY_MEMBER'); end if;
    insert into fingence_workspace.members (organization_id, email, role, password_hash) values (inv.organization_id, inv.email, inv.role, p_password_hash) returning id into member;
    update fingence_workspace.invitations set state = 'ACCEPTED' where id = inv.id;
    perform fingence_workspace.log(inv.organization_id, member, 'member.joined', member, jsonb_build_object('role', inv.role));
    return jsonb_build_object('email', inv.email, 'role', inv.role);
end $$;

-- Sign-in: the server verifies the password against this hash (a dummy one when there is no such member), then opens a session.
create function public.fingence_workspace_credentials(p_email text) returns jsonb
language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('memberId', id, 'passwordHash', password_hash, 'active', active) from fingence_workspace.members where email = lower(trim(p_email))
$$;
create function public.fingence_workspace_open_session(p_member uuid, p_token_hash text, p_hours int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m fingence_workspace.members; sid uuid; expires timestamptz;
begin
    select * into m from fingence_workspace.members where id = p_member;
    if not found or not m.active then return jsonb_build_object('error', 'UNAVAILABLE'); end if;
    if p_hours not between 1 and 24 then raise exception 'hours must be 1 to 24'; end if;
    insert into fingence_workspace.sessions (member_id, token_hash, expires_at) values (m.id, p_token_hash, now() + make_interval(hours => p_hours)) returning id, expires_at into sid, expires;
    perform fingence_workspace.log(m.organization_id, m.id, 'session.opened', sid);
    return jsonb_build_object('sessionId', sid, 'expiresAt', expires);
end $$;

-- Who is signed in, for every request. Refreshes last_seen_at at most once a minute.
create function public.fingence_workspace_principal(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; o fingence_workspace.organizations;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found then return null; end if;
    select * into o from fingence_workspace.organizations where id = a.organization_id;
    update fingence_workspace.sessions set last_seen_at = now() where id = a.session_id and last_seen_at < now() - interval '1 minute';
    return jsonb_build_object('sessionId', a.session_id, 'memberId', a.member_id, 'email', a.email, 'role', a.role,
        'organization', jsonb_build_object('id', o.id, 'name', o.name),
        'processing', jsonb_build_object('paused', o.processing_paused, 'reason', o.paused_reason, 'since', o.paused_at));
end $$;

create function public.fingence_workspace_sign_out(p_token_hash text) returns void
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found then return; end if;
    update fingence_workspace.sessions set ended_at = now(), end_reason = 'SIGNED_OUT', ended_by = a.member_id where id = a.session_id;
    perform fingence_workspace.log(a.organization_id, a.member_id, 'session.signed_out', a.session_id);
end $$;

-- Admin: members, pending invitations and the organization's audit trail.
create function public.fingence_workspace_team(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or a.role <> 'ADMIN' then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    return jsonb_build_object(
        'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'email', m.email, 'role', m.role, 'active', m.active, 'version', m.version, 'joinedAt', m.created_at,
            'openSessions', (select count(*) from fingence_workspace.sessions s where s.member_id = m.id and s.ended_at is null and s.expires_at > now())) order by m.created_at)
            from fingence_workspace.members m where m.organization_id = a.organization_id), '[]'),
        'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'createdAt', i.created_at, 'expiresAt', i.expires_at) order by i.created_at desc)
            from fingence_workspace.invitations i where i.organization_id = a.organization_id and i.state = 'PENDING' and i.expires_at > now()), '[]'));
end $$;

create function public.fingence_workspace_invite(p_token_hash text, p_email text, p_role text, p_code_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; inv uuid; expires timestamptz; e text := lower(trim(p_email));
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or a.role <> 'ADMIN' then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    if p_role not in ('FINANCE', 'MANAGEMENT', 'ADMIN') then return jsonb_build_object('error', 'INVALID_ROLE'); end if;
    if exists (select 1 from fingence_workspace.members where email = e) then return jsonb_build_object('error', 'ALREADY_MEMBER'); end if;
    update fingence_workspace.invitations set state = 'REVOKED' where organization_id = a.organization_id and email = e and state = 'PENDING';
    insert into fingence_workspace.invitations (organization_id, email, role, issuer, issued_by, code_hash, expires_at)
    values (a.organization_id, e, p_role, 'ADMIN', a.member_id, p_code_hash, now() + interval '72 hours') returning id, expires_at into inv, expires;
    perform fingence_workspace.log(a.organization_id, a.member_id, 'invitation.issued', inv, jsonb_build_object('role', p_role, 'email', e));
    return jsonb_build_object('invitationId', inv, 'expiresAt', expires);
end $$;

create function public.fingence_workspace_revoke_invitation(p_token_hash text, p_invitation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or a.role <> 'ADMIN' then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    update fingence_workspace.invitations set state = 'REVOKED' where id = p_invitation and organization_id = a.organization_id and state = 'PENDING';
    if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    perform fingence_workspace.log(a.organization_id, a.member_id, 'invitation.revoked', p_invitation);
    return jsonb_build_object('ok', true);
end $$;

-- Admin: change a member's role or access. Any change ends that member's open sessions; one active Admin always remains.
create function public.fingence_workspace_update_member(p_token_hash text, p_member uuid, p_role text, p_active boolean, p_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; m fingence_workspace.members; ended int;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or a.role <> 'ADMIN' then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    perform pg_advisory_xact_lock(hashtextextended(a.organization_id::text, 0));
    select * into m from fingence_workspace.members where id = p_member and organization_id = a.organization_id for update;
    if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    if m.version <> p_version then return jsonb_build_object('error', 'STALE'); end if;
    if p_role not in ('FINANCE', 'MANAGEMENT', 'ADMIN') then return jsonb_build_object('error', 'INVALID_ROLE'); end if;
    if m.role = p_role and m.active = p_active then return jsonb_build_object('ok', true, 'version', m.version); end if;
    if m.role = 'ADMIN' and m.active and (p_role <> 'ADMIN' or not p_active)
        and not exists (select 1 from fingence_workspace.members where organization_id = a.organization_id and role = 'ADMIN' and active and id <> m.id) then
        return jsonb_build_object('error', 'LAST_ADMIN');
    end if;
    update fingence_workspace.members set role = p_role, active = p_active, version = version + 1 where id = m.id;
    ended := fingence_workspace.end_sessions(m.id, 'ACCESS_CHANGED', a.member_id);
    perform fingence_workspace.log(a.organization_id, a.member_id, 'member.updated', m.id,
        jsonb_build_object('from', jsonb_build_object('role', m.role, 'active', m.active), 'to', jsonb_build_object('role', p_role, 'active', p_active), 'sessionsEnded', ended));
    return jsonb_build_object('ok', true, 'version', m.version + 1, 'sessionsEnded', ended);
end $$;

-- Management or Admin: end a member's open sessions (they must sign in again).
create function public.fingence_workspace_end_member_sessions(p_token_hash text, p_member uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; ended int;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or a.role not in ('MANAGEMENT', 'ADMIN') then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    if not exists (select 1 from fingence_workspace.members where id = p_member and organization_id = a.organization_id) then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    ended := fingence_workspace.end_sessions(p_member, case a.role when 'ADMIN' then 'ENDED_BY_ADMIN' else 'ENDED_BY_MANAGEMENT' end, a.member_id);
    perform fingence_workspace.log(a.organization_id, a.member_id, 'session.ended', p_member, jsonb_build_object('sessionsEnded', ended));
    return jsonb_build_object('ok', true, 'sessionsEnded', ended);
end $$;

-- Management: pause or resume the organization's processing. A pause needs a reason, which Finance users see.
create function public.fingence_workspace_set_processing(p_token_hash text, p_paused boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or a.role <> 'MANAGEMENT' then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    if p_paused and (reason is null or length(reason) > 500) then return jsonb_build_object('error', 'REASON_REQUIRED'); end if;
    update fingence_workspace.organizations set processing_paused = p_paused, paused_reason = case when p_paused then reason end,
        paused_at = case when p_paused then now() end, paused_by = case when p_paused then a.member_id end
    where id = a.organization_id;
    perform fingence_workspace.log(a.organization_id, a.member_id, case when p_paused then 'processing.paused' else 'processing.resumed' end, a.organization_id,
        case when p_paused then jsonb_build_object('reason', reason) else '{}'::jsonb end);
    return jsonb_build_object('ok', true, 'paused', p_paused);
end $$;

-- Management: what the backend did. Runs with per-document outcomes (never record amounts), open sessions, the audit trail.
create function public.fingence_workspace_operations(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; o fingence_workspace.organizations;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or a.role not in ('MANAGEMENT', 'ADMIN') then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into o from fingence_workspace.organizations where id = a.organization_id;
    return jsonb_build_object(
        'processing', jsonb_build_object('paused', o.processing_paused, 'reason', o.paused_reason, 'since', o.paused_at,
            'by', (select email from fingence_workspace.members where id = o.paused_by)),
        'runs', case when a.role = 'MANAGEMENT' then coalesce((select jsonb_agg(x order by x->>'createdAt' desc) from (
            select jsonb_build_object('id', r.id, 'createdAt', r.created_at, 'by', m.email, 'pipelineVersion', r.pipeline_version, 'documents', r.document_count,
                'accepted', (select count(*) from fingence_ingestion.documents d where d.run_id = r.id and d.decision = 'AUTO_ACCEPTED'),
                'quarantined', (select count(*) from fingence_ingestion.documents d where d.run_id = r.id and d.decision = 'QUARANTINED'),
                'unavailable', (select count(*) from fingence_ingestion.documents d where d.run_id = r.id and d.decision = 'UNAVAILABLE'),
                'aiCalls', (select count(*) from fingence_ingestion.documents d where d.run_id = r.id and d.model is not null)) x
            from fingence_ingestion.runs r left join fingence_workspace.members m on m.id = r.member_id
            where r.organization_id = a.organization_id order by r.created_at desc limit 50) runs), '[]') end,
        'sessions', coalesce((select jsonb_agg(jsonb_build_object('memberId', m.id, 'email', m.email, 'role', m.role, 'openedAt', s.created_at, 'lastSeenAt', s.last_seen_at,
                'expiresAt', s.expires_at, 'current', s.id = a.session_id) order by s.last_seen_at desc)
            from fingence_workspace.sessions s join fingence_workspace.members m on m.id = s.member_id
            where m.organization_id = a.organization_id and s.ended_at is null and s.expires_at > now()), '[]'),
        'audit', coalesce((select jsonb_agg(jsonb_build_object('at', x.occurred_at, 'action', x.action, 'actor', m.email, 'targetId', x.target_id, 'detail', x.detail) order by x.occurred_at desc, x.id desc)
            from (select * from fingence_workspace.audit where organization_id = a.organization_id order by occurred_at desc, id desc limit 100) x
            left join fingence_workspace.members m on m.id = x.actor_id), '[]'));
end $$;

-- Management: one run in detail, every document's checks, receipts and notes, with record counts instead of records.
create function public.fingence_workspace_run(p_token_hash text, p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; result jsonb;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or a.role <> 'MANAGEMENT' then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select jsonb_build_object('id', r.id, 'createdAt', r.created_at, 'by', m.email, 'pipelineVersion', r.pipeline_version, 'processingId', r.processing_id, 'scope', r.scope,
        'documents', coalesce((select jsonb_agg((to_jsonb(d) - 'run_id') || jsonb_build_object('record_count', (select count(*) from fingence_ingestion.records x where x.document_id = d.id)) order by d.ordinal)
            from fingence_ingestion.documents d where d.run_id = r.id), '[]'))
    into result
    from fingence_ingestion.runs r left join fingence_workspace.members m on m.id = r.member_id
    where r.id = p_run and r.organization_id = a.organization_id;
    return coalesce(result, jsonb_build_object('error', 'NOT_FOUND'));
end $$;

-- Finance: record a completed run for the organization, automatically, unless Management has paused processing.
create function public.fingence_workspace_record_run(p_token_hash text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; o fingence_workspace.organizations; run uuid;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or a.role <> 'FINANCE' then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into o from fingence_workspace.organizations where id = a.organization_id for share;
    if o.processing_paused then return jsonb_build_object('error', 'PROCESSING_PAUSED'); end if;
    run := public.fingence_ingestion_record_run(p_payload);
    update fingence_ingestion.runs set organization_id = a.organization_id, member_id = a.member_id where id = run;
    return jsonb_build_object('runId', run);
end $$;

do $$
declare f text;
begin
    foreach f in array array[
        'fingence_workspace_bootstrap(text, text, text, int)', 'fingence_workspace_redeem(text, text)', 'fingence_workspace_credentials(text)',
        'fingence_workspace_open_session(uuid, text, int)', 'fingence_workspace_principal(text)', 'fingence_workspace_sign_out(text)',
        'fingence_workspace_team(text)', 'fingence_workspace_invite(text, text, text, text)', 'fingence_workspace_revoke_invitation(text, uuid)',
        'fingence_workspace_update_member(text, uuid, text, boolean, int)', 'fingence_workspace_end_member_sessions(text, uuid)',
        'fingence_workspace_set_processing(text, boolean, text)', 'fingence_workspace_operations(text)', 'fingence_workspace_run(text, uuid)',
        'fingence_workspace_record_run(text, jsonb)'] loop
        execute format('revoke execute on function public.%s from public, anon, authenticated', f);
        execute format('grant execute on function public.%s to service_role', f);
    end loop;
end $$;
grant usage on schema fingence_workspace to service_role;
