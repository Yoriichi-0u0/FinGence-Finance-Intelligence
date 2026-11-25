-- FinGence workspace v10: the assistant's controls beside its name. Requires workspace-v9-assistant.sql. Applied to
-- FinGence-Production on 26 Nov 2026 (fingence_workspace_v10_assistant_controls).
--   - A member's settings are now one of two strict shapes, and nothing else:
--       version 1 (from v9):  {"v": 1, "name": <name>}
--       version 2:            {"v": 2, "name": <name>, "tone": "concise" | "friendly", "quiet": <boolean>,
--                              "character": <boolean>, "motion": "device" | "off"}
--     The app writes version 2 from now on; a version 1 row still reads (lib/fin/contracts.ts, prefsOf).
--   - The name rules are unchanged: length 1 to 20, trimmed, single spaces, no digits, symbols or control characters.
--   - Only the validator changes. The table, its check constraint and both functions keep working, and rows saved
--     under v9 stay valid.
-- Written to be re-runnable, so an existing local store (scripts/dev-store.mjs) picks it up.

create or replace function fingence_workspace.valid_assistant(s jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare n text; keys text[];
begin
    if s is null or jsonb_typeof(s) <> 'object' then return false; end if;
    keys := (select array_agg(k order by k) from jsonb_object_keys(s) k);
    if s->'v' = '1'::jsonb then
        if keys is distinct from array['name', 'v'] then return false; end if;
    elsif s->'v' = '2'::jsonb then
        if keys is distinct from array['character', 'motion', 'name', 'quiet', 'tone', 'v'] then return false; end if;
        if jsonb_typeof(s->'quiet') <> 'boolean' or jsonb_typeof(s->'character') <> 'boolean' then return false; end if;
        if not (s->>'tone' = any (array['concise', 'friendly'])) or jsonb_typeof(s->'tone') <> 'string' then return false; end if;
        if not (s->>'motion' = any (array['device', 'off'])) or jsonb_typeof(s->'motion') <> 'string' then return false; end if;
    else
        return false;
    end if;
    if jsonb_typeof(s->'name') <> 'string' then return false; end if;
    n := s->>'name';
    if n <> btrim(n) or char_length(n) not between 1 and 20 or position('  ' in n) > 0 then return false; end if;
    if n ~ '[0-9[:cntrl:]<>{}()$%€£¥"\\/`@#&*=+_|~^;:!?.,]' or position('[' in n) > 0 or position(']' in n) > 0 then return false; end if;
    return true;
end $$;
revoke all on function fingence_workspace.valid_assistant(jsonb) from public, anon, authenticated;
