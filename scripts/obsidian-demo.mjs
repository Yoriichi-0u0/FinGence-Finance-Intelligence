import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (!process.versions.node.startsWith('24.')) throw new Error('LOCAL_NODE_24_REQUIRED');
if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('OBSIDIAN_DEMO_LOCAL_ONLY');
if (process.env.FINGENCE_OBSIDIAN_DEMO !== '1') throw new Error('SET_FINGENCE_OBSIDIAN_DEMO_1');
if (['FINGENCE_POC_LOCAL', 'FINGENCE_M2_LOCAL', 'FINGENCE_M3_LOCAL', 'FINGENCE_M4_LOCAL', 'FINGENCE_M5_LOCAL'].some(k => process.env[k] === '1')) {
    throw new Error('OBSIDIAN_DEMO_CANNOT_RUN_WITH_SIGNED_IN_POC_FLAGS');
}
process.env.NODE_ENV ??= 'development';
process.env.FINGENCE_AI_LOCAL = '1';
process.env.FINGENCE_V2_I1_LOCAL = '1';

await import('./ai-runtime-03.mjs');
const { assertObsidianDemoAccess, retrieveObsidianPassages, obsidianVaultRoot } = await import('../lib/server/obsidian-demo/vault.ts');
const { createConsentChat, DEMO_SESSION_COOKIE } = await import('../lib/server/obsidian-demo/consent-chat.ts');
const { generateSyntheticObsidianVault } = await import('../lib/server/obsidian-demo/generate.ts');
const { persistSecurityAuditEvent } = await import('../lib/server/security/audit-store.ts');
const { PGlite } = await import('@electric-sql/pglite');

const [action, ...rawQueryParts] = process.argv.slice(2);
const queryParts = rawQueryParts[0] === '--' ? rawQueryParts.slice(1) : rawQueryParts;
const url = 'http://127.0.0.1:3186/internal/obsidian-demo';
const request = new Request(url, { headers: { host: '127.0.0.1:3186', origin: 'http://127.0.0.1:3186', 'sec-fetch-site': 'same-origin' } });

function output(value) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }

async function installAuditSchema(database) {
    const present = await database.transaction(tx => tx.query("SELECT to_regclass('public.security_audit_events') AS table_name"));
    if (present.rows[0]?.table_name) return;
    let migration = await readFile(resolve('supabase/sql/phase3-security-audit-upgrade.sql'), 'utf8');
    migration = migration.replace(/^\s*--.*$/gm, '').replace(/^\s*BEGIN;\s*/i, '').replace(/\s*COMMIT;\s*$/i, '');
    const statements = migration.split(';').map(s => s.trim()).filter(Boolean);
    await database.transaction(async tx => { for (const statement of statements) await tx.query(statement); });
}

async function auditRetrieval(database) {
    const requestId = randomUUID();
    await database.transaction(tx => persistSecurityAuditEvent(tx, {
        actorId: null, organizationId: null, action: 'financial_record.read', outcome: 'success',
        targetType: null, targetId: null, requestId, approvalId: null,
    }));
    const result = await database.transaction(tx => tx.query(
        'SELECT occurred_at,action,outcome FROM public.security_audit_events WHERE request_id=$1 ORDER BY id DESC LIMIT 1', [requestId]));
    const row = result.rows[0];
    if (!row) throw new Error('OBSIDIAN_AUDIT_NOT_STORED');
    if (typeof row.action !== 'string' || typeof row.outcome !== 'string' || !(row.occurred_at instanceof Date || typeof row.occurred_at === 'string')) throw new Error('OBSIDIAN_AUDIT_NOT_STORED');
    return { stored: true, action: row.action, outcome: row.outcome, occurredAt: new Date(row.occurred_at).toISOString() };
}

// This standalone demo command uses an isolated in-memory audit database. It
// exercises the existing audit module without opening the application's local
// account/data database or creating any signed-in route.
let auditDatabase;
try {
    assertObsidianDemoAccess(request);
    if (action === 'generate' && queryParts.length === 0) {
        const note = await generateSyntheticObsidianVault(request);
        const root = await obsidianVaultRoot();
        const { readFile: readNote } = await import('node:fs/promises');
        const noteContent = await readNote(resolve(root.real, note.relativePath), 'utf8');
        output({ status: 'GENERATED_FROM_SERVER_PIPELINE', ...note, noteContent });
    } else if (action === 'verify-fallback' && queryParts.length === 0) {
        const generated = await generateSyntheticObsidianVault(request);
        const session = 'a'.repeat(64);
        const consentRequest = new Request(url, { headers: {
            host: '127.0.0.1:3186', origin: 'http://127.0.0.1:3186', 'sec-fetch-site': 'same-origin',
            cookie: `${DEMO_SESSION_COOKIE}=${session}`,
        } });
        const chat = createConsentChat({
            transport: async () => { throw new Error('PROVIDER_UNREACHABLE'); },
            admitCall: async () => ({ admitted: true, reservedMicros: 1, settle: async () => undefined }),
        });
        const question = 'What was total cash in March?';
        const preview = await chat.preview(consentRequest, question, session);
        const response = await chat.send(consentRequest, { previewId: preview.previewId, payloadHash: preview.payloadHash, consent: true });
        output({ status: 'FAKE_PROVIDER_FALLBACK_FROM_GENERATED_VAULT', generated: {
            processingId: generated.processingId, period: generated.period, currency: generated.currency,
            sourceHashes: generated.sourceHashes, noteTitle: generated.noteTitle,
        }, query: question, response });
    } else if (action === 'retrieve' && queryParts.length > 0) {
        const query = queryParts.join(' ').trim();
        const pg = await PGlite.create();
        auditDatabase = {
            close: () => pg.close(),
            exec: sql => pg.exec(sql),
            transaction: work => pg.transaction(async tx => work({
                async query(sql, values) {
                    const result = await tx.query(sql, values);
                    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
                },
            })),
        };
        await auditDatabase.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
        await installAuditSchema(auditDatabase);
        const passages = await retrieveObsidianPassages(request, query);
        const audit = await auditRetrieval(auditDatabase);
        output({ status: 'RETRIEVED', query, resultCount: passages.length, passages, audit });
    } else {
        throw new Error('USAGE: obsidian-demo.mjs generate | retrieve <question> | verify-fallback');
    }
} catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_ :.-]{1,100}$/.test(error.message) ? error.message : 'OBSIDIAN_DEMO_FAILED';
    process.stderr.write(`${JSON.stringify({ status: 'FAILED', code })}\n`);
    process.exitCode = 1;
} finally {
    if (auditDatabase) await auditDatabase.close();
}
