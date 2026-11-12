-- FinGence workspace v2: for SAIC users only. Requires workspace-v1.sql. NOT yet applied to FinGence-Production.
-- - One organization (SAIC): a second one is refused by the database.
-- - Three stacked roles, each including the one below: FINANCE < ADMIN < SUPERADMIN. Management (Technical) is retired.
-- - A person manages only people below their own level: an Admin manages Finance users; a Superadmin manages Admins and
--   Finance users. Nobody changes their own role, and Superadmin is granted only by the owner bootstrap (never in the app).
-- - Pausing processing: Admin and Superadmin. Turning the AI on or off: Superadmin. The full audit trail: Superadmin.
-- Every rule below is checked inside the database, whatever the server asks.

-- Roles. No Management members or invitations existed on Production (0 organizations on 11 Nov 2026); any would become Admin.
alter table fingence_workspace.members drop constraint members_role_check;
alter table fingence_workspace.invitations drop constraint invitations_role_check;
update fingence_workspace.members set role = 'ADMIN' where role = 'MANAGEMENT';
update fingence_workspace.invitations set role = 'ADMIN' where role = 'MANAGEMENT';
alter table fingence_workspace.members add constraint members_role_check check (role in ('FINANCE', 'ADMIN', 'SUPERADMIN'));
alter table fingence_workspace.invitations add constraint invitations_role_check check (role in ('FINANCE', 'ADMIN', 'SUPERADMIN'));

-- One organization only.
create unique index organizations_single on fingence_workspace.organizations ((true));

-- The AI switch: when off, no request goes to the language model; rule-based processing still runs.
alter table fingence_workspace.organizations add column ai_enabled boolean not null default true;
alter table fingence_workspace.organizations add column ai_changed_at timestamptz;
alter table fingence_workspace.organizations add column ai_changed_by uuid references fingence_workspace.members(id);

create function fingence_workspace.rank(p_role text) returns int
language sql immutable set search_path = '' as $$
    select case p_role when 'FINANCE' then 1 when 'ADMIN' then 2 when 'SUPERADMIN' then 3 else 0 end
$$;
revoke all on function fingence_workspace.rank(text) from public, anon, authenticated;

-- Owner bootstrap (run by the project owner in SQL, never through the app): the SAIC organization, created once, and a
-- one-time Superadmin code. Run again, it reuses the organization and issues another Superadmin code.
create or replace function public.fingence_workspace_bootstrap(p_name text, p_admin_email text, p_code_hash text, p_hours int default 72) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare org uuid; inv uuid; expires timestamptz;
begin
    if p_hours not between 1 and 168 then raise exception 'hours must be 1 to 168'; end if;
    select id into org from fingence_workspace.organizations limit 1;
    if org is null then insert into fingence_workspace.organizations (name) values (p_name) returning id into org; end if;
    insert into fingence_workspace.invitations (organization_id, email, role, issuer, code_hash, expires_at)
    values (org, lower(trim(p_admin_email)), 'SUPERADMIN', 'OWNER', p_code_hash, now() + make_interval(hours => p_hours)) returning id, expires_at into inv, expires;
    perform fingence_workspace.log(org, null, 'invitation.issued', inv, jsonb_build_object('role', 'SUPERADMIN', 'issuer', 'OWNER'));
    return jsonb_build_object('organizationId', org, 'invitationId', inv, 'expiresAt', expires);
end $$;

create or replace function public.fingence_workspace_principal(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; o fingence_workspace.organizations;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found then return null; end if;
    select * into o from fingence_workspace.organizations where id = a.organization_id;
    update fingence_workspace.sessions set last_seen_at = now() where id = a.session_id and last_seen_at < now() - interval '1 minute';
    return jsonb_build_object('sessionId', a.session_id, 'memberId', a.member_id, 'email', a.email, 'role', a.role,
        'organization', jsonb_build_object('id', o.id, 'name', o.name),
        'processing', jsonb_build_object('paused', o.processing_paused, 'reason', o.paused_reason, 'since', o.paused_at),
        'ai', jsonb_build_object('enabled', o.ai_enabled, 'since', o.ai_changed_at));
end $$;

-- Admin and above: members, pending invitations.
create or replace function public.fingence_workspace_team(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    return jsonb_build_object(
        'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'email', m.email, 'role', m.role, 'active', m.active, 'version', m.version, 'joinedAt', m.created_at,
            'openSessions', (select count(*) from fingence_workspace.sessions s where s.member_id = m.id and s.ended_at is null and s.expires_at > now())) order by m.created_at)
            from fingence_workspace.members m where m.organization_id = a.organization_id), '[]'),
        'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'role', i.role, 'createdAt', i.created_at, 'expiresAt', i.expires_at) order by i.created_at desc)
            from fingence_workspace.invitations i where i.organization_id = a.organization_id and i.state = 'PENDING' and i.expires_at > now()), '[]'));
end $$;

-- Invite someone below your own level: an Admin invites Finance users; a Superadmin invites Finance users and Admins.
create or replace function public.fingence_workspace_invite(p_token_hash text, p_email text, p_role text, p_code_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; inv uuid; expires timestamptz; e text := lower(trim(p_email));
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    if fingence_workspace.rank(p_role) = 0 then return jsonb_build_object('error', 'INVALID_ROLE'); end if;
    if fingence_workspace.rank(p_role) >= fingence_workspace.rank(a.role) then return jsonb_build_object('error', 'ROLE_NOT_ALLOWED'); end if;
    if exists (select 1 from fingence_workspace.members where email = e) then return jsonb_build_object('error', 'ALREADY_MEMBER'); end if;
    update fingence_workspace.invitations set state = 'REVOKED' where organization_id = a.organization_id and email = e and state = 'PENDING';
    insert into fingence_workspace.invitations (organization_id, email, role, issuer, issued_by, code_hash, expires_at)
    values (a.organization_id, e, p_role, 'ADMIN', a.member_id, p_code_hash, now() + interval '72 hours') returning id, expires_at into inv, expires;
    perform fingence_workspace.log(a.organization_id, a.member_id, 'invitation.issued', inv, jsonb_build_object('role', p_role, 'email', e));
    return jsonb_build_object('invitationId', inv, 'expiresAt', expires);
end $$;

create or replace function public.fingence_workspace_revoke_invitation(p_token_hash text, p_invitation uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; i fingence_workspace.invitations;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into i from fingence_workspace.invitations where id = p_invitation and organization_id = a.organization_id and state = 'PENDING' for update;
    if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    if fingence_workspace.rank(i.role) >= fingence_workspace.rank(a.role) then return jsonb_build_object('error', 'ROLE_NOT_ALLOWED'); end if;
    update fingence_workspace.invitations set state = 'REVOKED' where id = i.id;
    perform fingence_workspace.log(a.organization_id, a.member_id, 'invitation.revoked', p_invitation);
    return jsonb_build_object('ok', true);
end $$;

-- Change the role or access of someone below your own level, to a role below your own level. Any change ends their sessions.
create or replace function public.fingence_workspace_update_member(p_token_hash text, p_member uuid, p_role text, p_active boolean, p_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; m fingence_workspace.members; ended int;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    perform pg_advisory_xact_lock(hashtextextended(a.organization_id::text, 0));
    select * into m from fingence_workspace.members where id = p_member and organization_id = a.organization_id for update;
    if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    if m.version <> p_version then return jsonb_build_object('error', 'STALE'); end if;
    if fingence_workspace.rank(p_role) = 0 then return jsonb_build_object('error', 'INVALID_ROLE'); end if;
    if m.id = a.member_id or fingence_workspace.rank(m.role) >= fingence_workspace.rank(a.role) or fingence_workspace.rank(p_role) >= fingence_workspace.rank(a.role) then
        return jsonb_build_object('error', 'ROLE_NOT_ALLOWED');
    end if;
    if m.role = p_role and m.active = p_active then return jsonb_build_object('ok', true, 'version', m.version); end if;
    update fingence_workspace.members set role = p_role, active = p_active, version = version + 1 where id = m.id;
    ended := fingence_workspace.end_sessions(m.id, 'ACCESS_CHANGED', a.member_id);
    perform fingence_workspace.log(a.organization_id, a.member_id, 'member.updated', m.id,
        jsonb_build_object('from', jsonb_build_object('role', m.role, 'active', m.active), 'to', jsonb_build_object('role', p_role, 'active', p_active), 'sessionsEnded', ended));
    return jsonb_build_object('ok', true, 'version', m.version + 1, 'sessionsEnded', ended);
end $$;

-- Sign out someone below your own level (they must sign in again).
create or replace function public.fingence_workspace_end_member_sessions(p_token_hash text, p_member uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; m fingence_workspace.members; ended int;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into m from fingence_workspace.members where id = p_member and organization_id = a.organization_id;
    if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
    if fingence_workspace.rank(m.role) >= fingence_workspace.rank(a.role) then return jsonb_build_object('error', 'ROLE_NOT_ALLOWED'); end if;
    ended := fingence_workspace.end_sessions(p_member, 'ENDED_BY_ADMIN', a.member_id);
    perform fingence_workspace.log(a.organization_id, a.member_id, 'session.ended', p_member, jsonb_build_object('sessionsEnded', ended));
    return jsonb_build_object('ok', true, 'sessionsEnded', ended);
end $$;

-- Admin and above: pause or resume processing. A pause needs a reason, which every user sees.
create or replace function public.fingence_workspace_set_processing(p_token_hash text, p_paused boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    if p_paused and (reason is null or length(reason) > 500) then return jsonb_build_object('error', 'REASON_REQUIRED'); end if;
    update fingence_workspace.organizations set processing_paused = p_paused, paused_reason = case when p_paused then reason end,
        paused_at = case when p_paused then now() end, paused_by = case when p_paused then a.member_id end
    where id = a.organization_id;
    perform fingence_workspace.log(a.organization_id, a.member_id, case when p_paused then 'processing.paused' else 'processing.resumed' end, a.organization_id,
        case when p_paused then jsonb_build_object('reason', reason) else '{}'::jsonb end);
    return jsonb_build_object('ok', true, 'paused', p_paused);
end $$;

-- Superadmin: turn the AI on or off for everyone.
create function public.fingence_workspace_set_ai(p_token_hash text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or a.role <> 'SUPERADMIN' then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    update fingence_workspace.organizations set ai_enabled = p_enabled, ai_changed_at = now(), ai_changed_by = a.member_id where id = a.organization_id;
    perform fingence_workspace.log(a.organization_id, a.member_id, case when p_enabled then 'ai.enabled' else 'ai.disabled' end, a.organization_id);
    return jsonb_build_object('ok', true, 'enabled', p_enabled);
end $$;

-- Admin and above: what the backend did (runs with per-document outcomes, never record amounts) and who is signed in.
-- The audit trail is for Superadmin only.
create or replace function public.fingence_workspace_operations(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; o fingence_workspace.organizations;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into o from fingence_workspace.organizations where id = a.organization_id;
    return jsonb_build_object(
        'processing', jsonb_build_object('paused', o.processing_paused, 'reason', o.paused_reason, 'since', o.paused_at,
            'by', (select email from fingence_workspace.members where id = o.paused_by)),
        'ai', jsonb_build_object('enabled', o.ai_enabled, 'since', o.ai_changed_at, 'by', (select email from fingence_workspace.members where id = o.ai_changed_by)),
        'runs', coalesce((select jsonb_agg(x order by x->>'createdAt' desc) from (
            select jsonb_build_object('id', r.id, 'createdAt', r.created_at, 'by', m.email, 'pipelineVersion', r.pipeline_version, 'documents', r.document_count,
                'accepted', (select count(*) from fingence_ingestion.documents d where d.run_id = r.id and d.decision = 'AUTO_ACCEPTED'),
                'quarantined', (select count(*) from fingence_ingestion.documents d where d.run_id = r.id and d.decision = 'QUARANTINED'),
                'unavailable', (select count(*) from fingence_ingestion.documents d where d.run_id = r.id and d.decision = 'UNAVAILABLE'),
                'aiCalls', (select count(*) from fingence_ingestion.documents d where d.run_id = r.id and d.model is not null)) x
            from fingence_ingestion.runs r left join fingence_workspace.members m on m.id = r.member_id
            where r.organization_id = a.organization_id order by r.created_at desc limit 50) runs), '[]'),
        'sessions', coalesce((select jsonb_agg(jsonb_build_object('memberId', m.id, 'email', m.email, 'role', m.role, 'openedAt', s.created_at, 'lastSeenAt', s.last_seen_at,
                'expiresAt', s.expires_at, 'current', s.id = a.session_id) order by s.last_seen_at desc)
            from fingence_workspace.sessions s join fingence_workspace.members m on m.id = s.member_id
            where m.organization_id = a.organization_id and s.ended_at is null and s.expires_at > now()), '[]'),
        'audit', case when a.role = 'SUPERADMIN' then coalesce((select jsonb_agg(jsonb_build_object('at', x.occurred_at, 'action', x.action, 'actor', m.email, 'targetId', x.target_id, 'detail', x.detail) order by x.occurred_at desc, x.id desc)
            from (select * from fingence_workspace.audit where organization_id = a.organization_id order by occurred_at desc, id desc limit 200) x
            left join fingence_workspace.members m on m.id = x.actor_id), '[]') end);
end $$;

-- Admin and above: one run in detail, every document's checks, receipts and notes, with record counts instead of records.
create or replace function public.fingence_workspace_run(p_token_hash text, p_run uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; result jsonb;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 2 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select jsonb_build_object('id', r.id, 'createdAt', r.created_at, 'by', m.email, 'pipelineVersion', r.pipeline_version, 'processingId', r.processing_id, 'scope', r.scope,
        'documents', coalesce((select jsonb_agg((to_jsonb(d) - 'run_id') || jsonb_build_object('record_count', (select count(*) from fingence_ingestion.records x where x.document_id = d.id)) order by d.ordinal)
            from fingence_ingestion.documents d where d.run_id = r.id), '[]'))
    into result
    from fingence_ingestion.runs r left join fingence_workspace.members m on m.id = r.member_id
    where r.id = p_run and r.organization_id = a.organization_id;
    return coalesce(result, jsonb_build_object('error', 'NOT_FOUND'));
end $$;

-- Every role processes: record a completed run for the organization, automatically, unless processing is paused.
create or replace function public.fingence_workspace_record_run(p_token_hash text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; o fingence_workspace.organizations; run uuid;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 1 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into o from fingence_workspace.organizations where id = a.organization_id for share;
    if o.processing_paused then return jsonb_build_object('error', 'PROCESSING_PAUSED'); end if;
    run := public.fingence_ingestion_record_run(p_payload);
    update fingence_ingestion.runs set organization_id = a.organization_id, member_id = a.member_id where id = run;
    return jsonb_build_object('runId', run);
end $$;

revoke execute on function public.fingence_workspace_set_ai(text, boolean) from public, anon, authenticated;
grant execute on function public.fingence_workspace_set_ai(text, boolean) to service_role;
