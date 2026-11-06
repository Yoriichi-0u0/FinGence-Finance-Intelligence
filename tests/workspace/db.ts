import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

/** The Supabase schema in an in-memory Postgres: the roles Supabase provides, then the ingestion and workspace migrations. */
export async function workspaceDatabase() {
    const db = new PGlite();
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync('supabase/sql/ingestion-layer-v1.sql', 'utf8'));
    await db.exec(readFileSync('supabase/sql/workspace-v1.sql', 'utf8'));
    return db;
}

/** A PostgREST-shaped transport over that database: POST /rest/v1/rpc/<fn> with named arguments → the function's JSON. */
export function rpcTransport(db: PGlite, calls: string[] = []): typeof fetch {
    return (async (input: RequestInfo | URL, init?: RequestInit) => {
        const fn = String(input).match(/\/rest\/v1\/rpc\/([a-z_]+)$/)?.[1];
        if (!fn) return new Response('not found', { status: 404 });
        calls.push(fn);
        const args = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        const names = Object.keys(args);
        const sql = `select to_jsonb(public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})) as result`;
        try {
            const { rows } = await db.query<{ result: unknown }>(sql, names.map(n => { const v = args[n]; return v !== null && typeof v === 'object' ? JSON.stringify(v) : v; }));
            return Response.json(rows[0]?.result ?? null);
        } catch (error) { return Response.json({ message: (error as Error).message }, { status: 400 }); }
    }) as typeof fetch;
}
