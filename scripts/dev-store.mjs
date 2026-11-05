#!/usr/bin/env node
/**
 * Local FinGence store for development: the same Supabase migrations (ingestion layer + server processing) in PGlite,
 * persisted under .local/dev/processing-store (git-ignored), behind a PostgREST-shaped RPC endpoint on 127.0.0.1 only.
 *
 *   node scripts/dev-store.mjs            # listens on 127.0.0.1:54329
 *   FINGENCE_PROCESSING_JOBS=1 FINGENCE_PROCESSING_LOCAL_URL=http://127.0.0.1:54329 pnpm dev
 *
 * Nothing leaves this machine, and no hosted database or sign-in is involved. Delete the folder to start empty.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';

const port = Number(process.env.FINGENCE_DEV_STORE_PORT ?? 54329);
const dir = '.local/dev/processing-store';
const fresh = !existsSync(dir);
mkdirSync('.local/dev', { recursive: true });
const db = new PGlite(dir);
if (fresh) {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync('supabase/sql/ingestion-layer-v1.sql', 'utf8'));
    await db.exec(readFileSync('supabase/sql/processing-jobs-v1.sql', 'utf8'));
}
// One statement at a time, like a single database connection.
let queue = Promise.resolve();
const serial = work => (queue = queue.then(work, work));

createServer((req, res) => {
    const fn = req.method === 'POST' ? req.url?.match(/^\/rest\/v1\/rpc\/(fingence_(?:processing|ingestion)_[a-z_]+)$/)?.[1] : null;
    if (!fn) { res.writeHead(404).end(); return; }
    const chunks = [];
    let size = 0;
    req.on('data', c => { size += c.length; if (size > 16_000_000) req.destroy(); else chunks.push(c); });
    req.on('end', () => serial(async () => {
        try {
            const args = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'), names = Object.keys(args);
            const sql = `select to_jsonb(public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})) as result`;
            const { rows } = await db.query(sql, names.map(n => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n])));
            res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(rows[0]?.result ?? null));
        } catch (error) {
            res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: String(error?.message ?? error).slice(0, 300) }));
        }
    }));
}).listen(port, '127.0.0.1', () => console.log(`FinGence local store on http://127.0.0.1:${port} (${fresh ? 'new' : 'existing'} data in ${dir})`));
