-- FinGence workspace v9: each member's own assistant settings, today the name they gave their assistant (the default is
-- "Fin"). Requires workspace-v1.sql and workspace-v2-saic.sql. Applied to FinGence-Production on 25 Nov 2026
-- (fingence_workspace_v9_assistant).
--   - One row per member. Nothing financial is stored: only {"v": 1, "name": <name>}, no other keys.
--   - The member is always the one behind the session token; no function takes a member ID, so nobody reads or renames
--     another person's assistant.
--   - The app allows letters, single spaces, hyphens and apostrophes, up to twenty characters, and never a number word
--     (lib/fin/contracts.ts, cleanAssistantName). The database checks the shape and the length and refuses digits, symbols
--     and control characters, so a name can never carry a figure or markup, whatever calls the function.
--   - A personal preference, so saves are not written to the audit trail. Removing a member removes their settings.
-- Like the rest of the workspace: RLS forced with no policies, and only the service role may execute the functions.
-- Written to be re-runnable, so an existing local store (scripts/dev-store.mjs) picks it up.

create or replace function fingence_workspace.valid_assistant(s jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare n text;
begin
    if s is null or jsonb_typeof(s) <> 'object' then return false; end if;
    if (select array_agg(k order by k) from jsonb_object_keys(s) k) is distinct from array['name', 'v'] then return false; end if;
    if s->'v' <> '1'::jsonb or jsonb_typeof(s->'name') <> 'string' then return false; end if;
    n := s->>'name';
    if n <> btrim(n) or char_length(n) not between 1 and 20 or position('  ' in n) > 0 then return false; end if;
    if n ~ '[0-9[:cntrl:]<>{}()$%€£¥"\\/`@#&*=+_|~^;:!?.,]' or position('[' in n) > 0 or position(']' in n) > 0 then return false; end if;
    return true;
end $$;
revoke all on function fingence_workspace.valid_assistant(jsonb) from public, anon, authenticated;

create table if not exists fingence_workspace.assistant_settings (
    member_id uuid primary key references fingence_workspace.members(id) on delete cascade,
    settings jsonb not null constraint assistant_settings_shape check (fingence_workspace.valid_assistant(settings)),
    updated_at timestamptz not null default now()
);
alter table fingence_workspace.assistant_settings enable row level security;
alter table fingence_workspace.assistant_settings force row level security;
revoke all on fingence_workspace.assistant_settings from public, anon, authenticated;

-- Any signed-in member: their own settings, or null when they never saved any (the default name is used).
create or replace function public.fingence_workspace_assistant(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; s fingence_workspace.assistant_settings;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 1 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into s from fingence_workspace.assistant_settings where member_id = a.member_id;
    return jsonb_build_object('settings', s.settings, 'updatedAt', s.updated_at);
end $$;

-- Any signed-in member: save their own settings, or return to the default with null.
create or replace function public.fingence_workspace_save_assistant(p_token_hash text, p_settings jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; saved timestamptz;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 1 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    if p_settings is null or p_settings = 'null'::jsonb then
        delete from fingence_workspace.assistant_settings where member_id = a.member_id;
        return jsonb_build_object('ok', true, 'settings', null, 'updatedAt', null);
    end if;
    if not fingence_workspace.valid_assistant(p_settings) then return jsonb_build_object('error', 'INVALID_SETTINGS'); end if;
    insert into fingence_workspace.assistant_settings (member_id, settings) values (a.member_id, p_settings)
    on conflict (member_id) do update set settings = excluded.settings, updated_at = now()
    returning updated_at into saved;
    return jsonb_build_object('ok', true, 'settings', p_settings, 'updatedAt', saved);
end $$;

do $$ declare f text; begin
    foreach f in array array['fingence_workspace_assistant(text)', 'fingence_workspace_save_assistant(text, jsonb)'] loop
        execute format('revoke execute on function public.%s from public, anon, authenticated', f);
        execute format('grant execute on function public.%s to service_role', f);
    end loop;
end $$;
