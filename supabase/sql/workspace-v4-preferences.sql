-- FinGence workspace v4: each member's own Overview layout ("Customise dashboard"). Requires workspace-v1.sql and
-- workspace-v2-saic.sql (not workspace-v3-log.sql). NOT yet applied to FinGence-Production.
--   - One row per member: which Overview cards they show, and in what order. Nothing financial is stored.
--   - The member is always the one behind the session token; no function takes a member ID, so nobody reads or writes
--     another person's layout.
--   - The layout has one strict shape: {"v": 1, "cards": [{"id": <known card>, "visible": <boolean>}, ...]}, each known
--     card at most once, no other keys. Anything else is refused by the function and by the table itself.
--   - A personal preference, so saves are not written to the audit trail. Removing a member removes their layout.
-- Like the rest of the workspace: RLS forced with no policies, and only the service role may execute the functions.
-- Written to be re-runnable, so an existing local store (scripts/dev-store.mjs) picks it up.

-- The known Overview cards (lib/dashboard/layout.ts, CARD_IDS). A new card needs a new migration that replaces this function.
create or replace function fingence_workspace.valid_dashboard(d jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare c jsonb; seen text[] := '{}';
begin
    if d is null or jsonb_typeof(d) <> 'object' then return false; end if;
    if (select array_agg(k order by k) from jsonb_object_keys(d) k) is distinct from array['cards', 'v'] then return false; end if;
    if d->'v' <> '1'::jsonb or jsonb_typeof(d->'cards') <> 'array' then return false; end if;
    if jsonb_array_length(d->'cards') not between 1 and 8 then return false; end if;
    for c in select value from jsonb_array_elements(d->'cards') loop
        if jsonb_typeof(c) <> 'object' then return false; end if;
        if (select array_agg(k order by k) from jsonb_object_keys(c) k) is distinct from array['id', 'visible'] then return false; end if;
        if jsonb_typeof(c->'id') <> 'string' or jsonb_typeof(c->'visible') <> 'boolean' then return false; end if;
        if not (c->>'id' = any (array['figures', 'cash-chart', 'flagged', 'forecast', 'checks', 'counterparties', 'reconciliation-summary', 'last-runs'])) then return false; end if;
        if c->>'id' = any (seen) then return false; end if;
        seen := seen || (c->>'id');
    end loop;
    return true;
end $$;
revoke all on function fingence_workspace.valid_dashboard(jsonb) from public, anon, authenticated;

create table if not exists fingence_workspace.preferences (
    member_id uuid primary key references fingence_workspace.members(id) on delete cascade,
    dashboard jsonb not null constraint preferences_dashboard_shape check (fingence_workspace.valid_dashboard(dashboard)),
    updated_at timestamptz not null default now()
);
alter table fingence_workspace.preferences enable row level security;
alter table fingence_workspace.preferences force row level security;
revoke all on fingence_workspace.preferences from public, anon, authenticated;

-- Any signed-in member: their own layout, or null when they have never saved one (the default is shown).
create or replace function public.fingence_workspace_preferences(p_token_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; p fingence_workspace.preferences;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 1 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    select * into p from fingence_workspace.preferences where member_id = a.member_id;
    return jsonb_build_object('dashboard', p.dashboard, 'updatedAt', p.updated_at);
end $$;

-- Any signed-in member: save their own layout, or reset it to the default with null.
create or replace function public.fingence_workspace_save_preferences(p_token_hash text, p_dashboard jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record; saved timestamptz;
begin
    select * into a from fingence_workspace.actor(p_token_hash);
    if not found or fingence_workspace.rank(a.role) < 1 then return jsonb_build_object('error', 'FORBIDDEN'); end if;
    if p_dashboard is null or p_dashboard = 'null'::jsonb then
        delete from fingence_workspace.preferences where member_id = a.member_id;
        return jsonb_build_object('ok', true, 'dashboard', null, 'updatedAt', null);
    end if;
    if not fingence_workspace.valid_dashboard(p_dashboard) then return jsonb_build_object('error', 'INVALID_LAYOUT'); end if;
    insert into fingence_workspace.preferences (member_id, dashboard) values (a.member_id, p_dashboard)
    on conflict (member_id) do update set dashboard = excluded.dashboard, updated_at = now()
    returning updated_at into saved;
    return jsonb_build_object('ok', true, 'dashboard', p_dashboard, 'updatedAt', saved);
end $$;

do $$ declare f text; begin
    foreach f in array array['fingence_workspace_preferences(text)', 'fingence_workspace_save_preferences(text, jsonb)'] loop
        execute format('revoke execute on function public.%s from public, anon, authenticated', f);
        execute format('grant execute on function public.%s to service_role', f);
    end loop;
end $$;
