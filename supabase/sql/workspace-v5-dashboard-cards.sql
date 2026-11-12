-- FinGence Overview cards (workspace v5), on top of workspace-v4-preferences.sql. Two new cards, from SAIC's 12 Nov feedback:
-- 'confidence' (processing confidence) and 'at-a-glance' (one line per page, with the report download). The saved layout's
-- shape check accepts their IDs and up to 10 cards; every layout already saved stays valid (it is a strict superset).
-- Must be applied before the code that offers the cards: a layout that includes them would otherwise be refused on save.
create or replace function fingence_workspace.valid_dashboard(d jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare c jsonb; seen text[] := '{}';
begin
    if d is null or jsonb_typeof(d) <> 'object' then return false; end if;
    if (select array_agg(k order by k) from jsonb_object_keys(d) k) is distinct from array['cards', 'v'] then return false; end if;
    if d->'v' <> '1'::jsonb or jsonb_typeof(d->'cards') <> 'array' then return false; end if;
    if jsonb_array_length(d->'cards') not between 1 and 10 then return false; end if;
    for c in select value from jsonb_array_elements(d->'cards') loop
        if jsonb_typeof(c) <> 'object' then return false; end if;
        if (select array_agg(k order by k) from jsonb_object_keys(c) k) is distinct from array['id', 'visible'] then return false; end if;
        if jsonb_typeof(c->'id') <> 'string' or jsonb_typeof(c->'visible') <> 'boolean' then return false; end if;
        if not (c->>'id' = any (array['figures', 'cash-chart', 'flagged', 'forecast', 'checks', 'counterparties', 'reconciliation-summary', 'last-runs', 'confidence', 'at-a-glance'])) then return false; end if;
        if c->>'id' = any (seen) then return false; end if;
        seen := seen || (c->>'id');
    end loop;
    return true;
end $$;
revoke all on function fingence_workspace.valid_dashboard(jsonb) from public, anon, authenticated;
