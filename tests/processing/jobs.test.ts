import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
vi.mock('server-only', () => ({}));
import type { PGlite } from '@electric-sql/pglite';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';
import { replayInterpreter } from '../../lib/interpretation/client';
import { replayExtractor } from '../../lib/processing/extractions';
import { runPayload } from '../../lib/document-ingestion/run-payload';
import { jobResult, MAX_FLAGGED } from '../../lib/processing/job-result';
import { createJob, getJob, overview, processingState, runJob, setPaused } from '../../lib/server/processing/jobs';
import type { ProcessingStore } from '../../lib/server/processing/store';
import { processingDatabase, rpcTransport } from './db';

const doc = (dir: string, name: string): DocumentInput => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const quarter = () => ['demo-bank-statement-2026-q1-sgd.csv', 'demo-general-ledger-2026-q1-sgd.csv', 'demo-bank-history-2025-04-to-2026-03-sgd.csv'].map(n => doc('public/demo/quarter', n));
const march = () => ['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv', 'demo-bank-history-2025-04-to-2026-03.csv'].map(n => doc('public/demo', n));
const store: ProcessingStore = { url: 'http://127.0.0.1:54329', key: null, local: true };

describe('server processing jobs', () => {
    let db: PGlite, calls: string[], deps: { store: ProcessingStore; transport: typeof fetch; interpreter: null };
    beforeEach(async () => { db = await processingDatabase(); calls = []; deps = { store, transport: rpcTransport(db, calls), interpreter: null }; }, 30_000);

    it('runs a job to the end and stores its ingestion run, results and flagged items next to each other', async () => {
        const created = await createJob(quarter(), null, deps);
        expect('jobId' in created).toBe(true);
        const jobId = (created as { jobId: string }).jobId;
        expect((await getJob(jobId, false, deps))?.status).toBe('QUEUED');
        expect(await runJob(jobId, quarter(), '127.0.0.1', deps)).toBe('COMPLETED');

        const job = (await getJob(jobId, true, deps))!;
        const local = await processDocuments(quarter());
        expect(job.status).toBe('COMPLETED');
        expect(job.processingId).toBe(local.processingId);
        expect(job.outcome).toBe(local.status);
        expect(job.stages.map(s => `${s.id}:${s.decision}`)).toEqual(local.stages.map(s => `${s.id}:${s.decision}`));
        expect(job.inputs.map(i => i.name)).toEqual(quarter().map(d => d.name));
        expect(job.ingestionRunId).toMatch(/^[0-9a-f-]{36}$/);
        // Stored results equal the result rebuilt from the same documents (JSON round trip).
        const expected = JSON.parse(JSON.stringify(jobResult(local)));
        expect(job.results?.anomalies).toEqual(expected.anomalies);
        expect(job.results?.reconciliation).toEqual(expected.reconciliation);
        // One flagged anomaly (the quarter sample's unconfirmed payment), with its month, date and amount.
        expect(job.flaggedCount).toBe(1);
        expect(job.flagged).toEqual([expect.objectContaining({ ordinal: 0, kind: 'ANOMALY_CANDIDATE', reference: 'BANK-Q1-0101', period: expect.stringMatching(/^2026-0[1-3]$/), currency: 'SGD' })]);
        expect(job.flagged![0].signedAmount).toBe(Number(expected.flagged[0].signedAmount).toFixed(2));
        // The verified records sit in the ingestion schema under the same run.
        const { rows } = await db.query<{ n: number }>(`select count(*)::int as n from fingence_ingestion.records x join fingence_ingestion.documents d on d.id = x.document_id where d.run_id = $1`, [job.ingestionRunId]);
        expect(rows[0].n).toBe(local.outputs.bankRows.length + local.outputs.ledger!.rows.length + local.outputs.history.rows.length);
        // No uploaded bytes anywhere: only fingerprints, sizes and names.
        const { rows: raw } = await db.query<{ t: string }>(`select inputs::text as t from fingence_processing.jobs where id = $1`, [jobId]);
        expect(raw[0].t).not.toContain('base64');
        expect(Object.keys(job.inputs[0]).sort()).toEqual(['bytes', 'name', 'provenance', 'sha256']);
    }, 60_000);

    it('lets the browser re-check a job: replaying its accepted readings gives the same processing ID', async () => {
        const { jobId } = await createJob(march(), null, deps) as { jobId: string };
        await runJob(jobId, march(), '127.0.0.1', deps);
        const job = (await getJob(jobId, false, deps))!;
        const replay = await processDocuments(march(), undefined, undefined, { interpreter: replayInterpreter(job.interpretations, null), job: { id: jobId, runner: 'BROWSER_DEMO_RUNNER' } });
        expect(replay.processingId).toBe(job.processingId);
        expect(replay.job).toEqual({ id: jobId });
        expect(replay.outputs.report?.limitations[0]).toMatch(/^Processed on the FinGence server as a processing job/);
        // March completes with nothing flagged.
        expect(job.outcome).toBe('COMPLETED');
        expect(job.flaggedCount).toBe(0);
    }, 60_000);

    it('refuses new jobs while processing is paused, and accepts them again once resumed', async () => {
        expect(await processingState(deps)).toEqual({ paused: false, reason: null, changedAt: null });
        expect(await setPaused(true, '  ', deps)).toEqual({ error: 'REASON_REQUIRED' });
        expect(await setPaused(true, 'Checking a bank feed problem', deps)).toEqual({ paused: true });
        expect(await processingState(deps)).toEqual(expect.objectContaining({ paused: true, reason: 'Checking a bank feed problem' }));
        expect(await createJob(march(), null, deps)).toEqual(expect.objectContaining({ error: 'PROCESSING_PAUSED', reason: 'Checking a bank feed problem' }));
        const { rows } = await db.query<{ n: number }>('select count(*)::int as n from fingence_processing.jobs');
        expect(rows[0].n).toBe(0);
        expect(await setPaused(false, null, deps)).toEqual({ paused: false });
        expect(await processingState(deps)).toEqual(expect.objectContaining({ paused: false, reason: null }));
        expect('jobId' in await createJob(march(), null, deps)).toBe(true);
    }, 30_000);

    it('lists jobs and the flagged items of the latest run of each processing for the Management console', async () => {
        for (let i = 0; i < 2; i++) { const { jobId } = await createJob(quarter(), null, deps) as { jobId: string }; await runJob(jobId, quarter(), '127.0.0.1', deps); }
        const { jobId: m } = await createJob(march(), null, deps) as { jobId: string }; await runJob(m, march(), '127.0.0.1', deps);
        const o = await overview(deps);
        expect(o.counts).toEqual({ jobs: 3, running: 0, failed: 0 });
        expect(o.jobs).toHaveLength(3);
        expect(o.jobs.map(j => j.id)).toContain(m);
        expect(o.jobs[0].id).toBe(m);
        expect(o.jobs.every(j => j.status === 'COMPLETED' && j.stage === 'REPORT')).toBe(true);
        // The same documents processed twice are one processing: its flagged item is listed once, from the latest job.
        expect(o.flagged).toHaveLength(1);
        expect(o.flagged[0]).toEqual(expect.objectContaining({ kind: 'ANOMALY_CANDIDATE', reference: 'BANK-Q1-0101', jobId: o.jobs[1].id }));
    }, 90_000);

    it('records a failure as a short code, and fails a job that never finished', async () => {
        const { jobId } = await createJob(march(), null, deps) as { jobId: string };
        const failing = { ...deps, transport: (async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('finish_job') ? new Response('', { status: 500 }) : deps.transport(input, init)) as typeof fetch };
        expect(await runJob(jobId, march(), '127.0.0.1', failing)).toBe('FAILED');
        expect(await getJob(jobId, false, deps)).toEqual(expect.objectContaining({ status: 'FAILED', error: 'STORE_HTTP_500', ingestionRunId: null }));
        // A job that does not finish within its time limit stops itself with a reason.
        const { jobId: slow } = await createJob(march(), null, deps) as { jobId: string };
        const never = { propose: () => new Promise<never>(() => undefined) };
        const unfamiliar = [doc('public/demo/unfamiliar', 'bank-statement-march-2026-export.csv')];
        expect(await runJob(slow, unfamiliar, '127.0.0.1', { ...deps, interpreter: never, timeoutMs: 50 })).toBe('FAILED');
        expect(await getJob(slow, false, deps)).toEqual(expect.objectContaining({ status: 'FAILED', error: 'TIMED_OUT' }));
        // A job is run once only.
        expect(await runJob(jobId, march(), '127.0.0.1', deps)).toBe('FAILED');
        const { jobId: stuck } = await createJob(march(), null, deps) as { jobId: string };
        await db.query(`update fingence_processing.jobs set created_at = now() - interval '11 minutes' where id = $1`, [stuck]);
        expect(await getJob(stuck, false, deps)).toEqual(expect.objectContaining({ status: 'FAILED', error: 'TIMED_OUT' }));
        expect((await overview(deps)).counts).toEqual({ jobs: 3, running: 0, failed: 3 });
    }, 60_000);

    it('keeps what a job read from a scan for the browser\'s re-check, then deletes it after 15 minutes', async () => {
        const scan: DocumentInput = { name: 'statement-scan.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), provenance: 'USER_SUPPLIED' };
        const table = new TextEncoder().encode('Date,Details,Amount\n2026-03-02,Opening deposit,100.00\n');
        const extractor = vi.fn(async (_name: string, _bytes: Uint8Array, sha256: string) => ({ bytes: table, source: { kind: 'OCR' as const, file: 'statement-scan.png', fileSha256: sha256, pages: 1, confidence: 91, notes: ['read by OCR'], disputes: [] } }));
        const { jobId } = await createJob([scan], null, deps) as { jobId: string };
        await runJob(jobId, [scan], '127.0.0.1', { ...deps, extractor });
        const job = (await getJob(jobId, false, deps))!;
        const [sha] = Object.keys(job.extractions);
        expect(Object.keys(job.extractions)).toHaveLength(1);
        expect(job.extractions[sha].source).toEqual(expect.objectContaining({ kind: 'OCR', fileSha256: sha }));
        // The browser replays that reading instead of running its own OCR, and reaches the same processing ID.
        const ocr = vi.fn(async () => ({ error: 'should not run' }));
        const replay = await processDocuments([scan], undefined, undefined, { interpreter: null, extract: replayExtractor(job.extractions, ocr) });
        expect(ocr).not.toHaveBeenCalled();
        expect(replay.processingId).toBe(job.processingId);
        expect(replay.documents[0].sha256).toBe((await processDocuments([scan], undefined, undefined, { extract: extractor })).documents[0].sha256);
        await db.query(`update fingence_processing.jobs set finished_at = now() - interval '16 minutes' where id = $1`, [jobId]);
        expect((await getJob(jobId, false, deps))!.extractions).toEqual({});
        // The cleanup does not depend on anyone reading the job: the scheduled store-wide cleanup and the Data page's state check both run it.
        const stored = async (id: string) => (await db.query<{ e: unknown }>('select extractions as e from fingence_processing.jobs where id = $1', [id])).rows[0].e;
        for (const trigger of [
            () => deps.transport(`${store.url}/rest/v1/rpc/fingence_processing_reap_all`, { method: 'POST', body: '{}' }),
            () => processingState(deps),
        ]) {
            const { jobId: other } = await createJob([scan], null, deps) as { jobId: string };
            await runJob(other, [scan], '127.0.0.1', { ...deps, extractor });
            await db.query(`update fingence_processing.jobs set finished_at = now() - interval '16 minutes' where id = $1`, [other]);
            expect(Object.keys(await stored(other) as object)).toHaveLength(1);
            await trigger();
            expect(await stored(other)).toEqual({});
        }
    }, 30_000);

    it('stops a timed-out job: no further reading, model call or stage after the limit', async () => {
        const unfamiliar = ['bank-statement-march-2026-export.csv', 'general-ledger-cash-march-2026.csv'].map(n => doc('public/demo/unfamiliar', n));
        const propose = vi.fn(() => new Promise<never>((_, reject) => setTimeout(() => reject(new Error('slow provider')), 120)));
        const { jobId } = await createJob(unfamiliar, null, deps) as { jobId: string };
        calls.length = 0;
        expect(await runJob(jobId, unfamiliar, '127.0.0.1', { ...deps, interpreter: { propose }, timeoutMs: 40 })).toBe('FAILED');
        await new Promise(r => setTimeout(r, 400));
        // The first proposal was in flight at the limit; the second document is never sent, and no stage is recorded after it.
        expect(propose).toHaveBeenCalledTimes(1);
        expect(calls.filter(c => c === 'fingence_processing_job_stage')).toEqual([]);
        expect(await getJob(jobId, false, deps)).toEqual(expect.objectContaining({ status: 'FAILED', error: 'TIMED_OUT', stages: [] }));
    }, 30_000);

    it('flags an unexplained ledger record with its own month, date and signed amount', async () => {
        const [bank, ledger, history] = march();
        const extra = 'GL-DEMO-9999,DEMO-001,2026-03-10,1000-BANK,MYR,ZZTEST000001,Office fit-out,Unknown Supplier,0.00,812.40,-812.40,Supplies';
        const edited = { ...ledger, bytes: new TextEncoder().encode(`${new TextDecoder().decode(ledger.bytes).trimEnd()}\n${extra}\n`) };
        const c = await processDocuments([bank, edited, history]);
        const flagged = jobResult(c).flagged.find(f => f.reference === 'GL-DEMO-9999');
        expect(flagged).toEqual(expect.objectContaining({ kind: 'RECONCILIATION_EXCEPTION', status: 'UNEXPLAINED', period: '2026-03', date: '2026-03-10', currency: 'MYR', signedAmount: '-812.40' }));
    }, 30_000);

    it('stores every flagged item, and refuses a run with more than the limit instead of storing a subset', async () => {
        const c = await processDocuments(march());
        const many = { ...c, quarantine: Array.from({ length: 600 }, (_, i) => ({ kind: 'ANOMALY_CANDIDATE' as const, reference: `R${i}`, status: 'HIGH', reason: 'test' })) };
        expect(jobResult(many).flagged).toHaveLength(600);
        // A finished job stores all of them (more than the old 500).
        const { jobId } = await createJob(march(), null, deps) as { jobId: string };
        await db.query(`update fingence_processing.jobs set status = 'RUNNING' where id = $1`, [jobId]);
        const done = await deps.transport(`${store.url}/rest/v1/rpc/fingence_processing_finish_job`, { method: 'POST', body: JSON.stringify({ job: jobId, run: runPayload(c), result: { ...jobResult(many), extractions: {} } }) });
        expect(done.status).toBe(200);
        expect((await getJob(jobId, true, deps))).toEqual(expect.objectContaining({ flaggedCount: 600, flagged: expect.arrayContaining([expect.objectContaining({ reference: 'R599' })]) }));
        // Over the limit, the whole run is refused with a reason and nothing is stored.
        expect(MAX_FLAGGED).toBe(10_000);
        const { jobId: over } = await createJob(quarter(), null, deps) as { jobId: string };
        expect(await runJob(over, quarter(), '127.0.0.1', { ...deps, maxFlagged: 0 })).toBe('FAILED');
        expect(await getJob(over, false, deps)).toEqual(expect.objectContaining({ status: 'FAILED', error: 'TOO_MANY_FLAGGED', ingestionRunId: null, flaggedCount: 0 }));
    }, 60_000);

    it('keeps the schema closed: only the service role may call the functions, and nobody may read the tables', async () => {
        const { rows } = await db.query<{ fn: string; anon: boolean; service: boolean }>(`select p.proname as fn, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('service_role', p.oid, 'execute') as service
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'fingence_processing_%'`);
        expect(rows.length).toBe(10);
        expect(rows.every(r => !r.anon && r.service)).toBe(true);
        for (const t of ['controls', 'jobs', 'results', 'flagged']) {
            const { rows: p } = await db.query<{ a: boolean; s: boolean }>(`select has_table_privilege('anon', 'fingence_processing.${t}', 'select') as a, has_table_privilege('authenticated', 'fingence_processing.${t}', 'select') as s`);
            expect(p[0]).toEqual({ a: false, s: false });
        }
        const { rows: rls } = await db.query<{ n: number }>(`select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'fingence_processing' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity`);
        expect(rls[0].n).toBe(4);
    }, 30_000);
});
