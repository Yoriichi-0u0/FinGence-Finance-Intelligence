-- FinGence workspace v7: a signed-in member changes their own password. On top of workspace v1 and v2.
-- Until now a password was set only when joining with an invitation code, so a password handed out by the team stayed
-- known to the team. The server verifies the current password (scrypt) and hashes the new one; only hashes arrive here.
-- The change is compare-and-set on the hash the server verified, so a concurrent change cannot be overwritten unseen.
-- Every other session of the member ends (the password may have been known to someone else); the current one stays open.
-- Audited as member.password_changed, with no detail. Sign-in and joining then open sessions only while the verified hash is
-- still current (open_session_checked), so a sign-in racing a change cannot keep the old password's access.
-- RLS stays forced; executable by the service role only.

alter table fingence_workspace.sessions drop constraint if exists sessions_end_reason_check;
alter table fingence_workspace.sessions add constraint sessions_end_reason_check
    check (end_reason in ('SIGNED_OUT', 'ENDED_BY_MANAGEMENT', 'ENDED_BY_ADMIN', 'ACCESS_CHANGED', 'PASSWORD_CHANGED'));

create or replace function public.fingence_workspace_change_password(p_token_hash text, p_current_hash text, p_new_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; changed int; ended int;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    if p_new_hash is null or length(p_new_hash) not between 32 and 300 or p_new_hash = p_current_hash then return jsonb_build_object('error', 'INVALID_INPUT'); end if;
    update fingence_workspace.members set password_hash = p_new_hash where id = a.member_id and password_hash = p_current_hash;
    get diagnostics changed = row_count;
    if changed = 0 then return jsonb_build_object('error', 'PASSWORD_CHANGED_ELSEWHERE'); end if;
    with gone as (update fingence_workspace.sessions set ended_at = now(), end_reason = 'PASSWORD_CHANGED', ended_by = a.member_id
        where member_id = a.member_id and ended_at is null and id <> a.session_id returning 1)
    select count(*)::int into ended from gone;
    perform fingence_workspace.log(a.organization_id, a.member_id, 'member.password_changed', a.member_id);
    return jsonb_build_object('changed', true, 'otherSessionsEnded', ended);
end $$;
revoke execute on function public.fingence_workspace_change_password(text, text, text) from public, anon, authenticated;
grant execute on function public.fingence_workspace_change_password(text, text, text) to service_role;

-- Opening a session after the server verified a password: refused unless that hash is still the member's current one.
-- The member row is locked, so this and a password change are serialized: a sign-in that verified the old password either
-- opens its session before the change (which then ends it) or is refused after it. Sign-in and joining use this one.
create or replace function public.fingence_workspace_open_session_checked(p_member uuid, p_password_hash text, p_token_hash text, p_hours int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m fingence_workspace.members; sid uuid; expires timestamptz;
begin
    select * into m from fingence_workspace.members where id = p_member for update;
    if not found or not m.active or m.password_hash is distinct from p_password_hash then return jsonb_build_object('error', 'UNAVAILABLE'); end if;
    if p_hours not between 1 and 24 then raise exception 'hours must be 1 to 24'; end if;
    insert into fingence_workspace.sessions (member_id, token_hash, expires_at) values (m.id, p_token_hash, now() + make_interval(hours => p_hours)) returning id, expires_at into sid, expires;
    perform fingence_workspace.log(m.organization_id, m.id, 'session.opened', sid);
    return jsonb_build_object('sessionId', sid, 'expiresAt', expires);
end $$;
revoke execute on function public.fingence_workspace_open_session_checked(uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.fingence_workspace_open_session_checked(uuid, text, text, int) to service_role;
