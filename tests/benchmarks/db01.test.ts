import { it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { Pool } from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { fixtureSql, batchId, recordId, SEED } from '../../scripts/db01/fixture';
import { createTransactionQueryService } from '../../lib/server/api/transaction-query';
import { createTransactionDetailQueryService } from '../../lib/server/api/transaction-detail-query';
import { createBatchQueryService } from '../../lib/server/api/batch-query';
import { createGroupedPersistenceService } from '../../lib/server/persistence/grouped';
import { transactionDatabase, type SqlConnection } from '../../lib/server/db/postgres';
import { syntheticResult, header, validRow } from '../persistence/fixtures';
import { hashBytes, hashSource, verifyManifest, HASH_CONVENTION } from '../../scripts/db01/integrity.mjs';

it('uses portable source hashes while preserving byte-exact artifact checks', () => {
  const lf = Buffer.from('Synthetic café\nline two\n');
  const crlf = Buffer.from('Synthetic café\r\nline two\r\n');
  const manifest = { hashConvention: HASH_CONVENTION,
    artifacts: { 'raw.json': hashBytes(lf) }, sources: { 'source.ts': hashSource(lf) } };
  expect(hashSource(crlf)).toBe(hashSource(lf));
  expect(hashSource(Buffer.from('a\rb'))).not.toBe(hashSource(Buffer.from('a\nb')));
  expect(hashSource(Buffer.from('a\n'))).not.toBe(hashSource(Buffer.from('a')));
  expect(hashSource(Buffer.from('a \n'))).not.toBe(hashSource(Buffer.from('a\n')));
  expect(verifyManifest(manifest, { readArtifact: () => lf, readSource: () => crlf }))
    .toEqual({ artifacts: 1, sources: 1 });
  expect(() => verifyManifest(manifest, { readArtifact: () => crlf, readSource: () => lf }))
    .toThrow('Artifact hash mismatch');
  expect(() => verifyManifest(manifest, { readArtifact: () => lf, readSource: () => Buffer.from('changed\n') }))
    .toThrow('Source hash mismatch');
  expect(() => verifyManifest({ ...manifest, hashConvention: {} }, { readArtifact: () => lf, readSource: () => lf }))
    .toThrow('Unsupported hash convention');
});

it('verifies the authoritative DB01 manifest, sample matrix and reported baseline', () => {
  const folder = 'docs/database/db01/2026-10-27T05-45-05-445Z';
  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  expect(verifyManifest(manifest, {
    readArtifact: (file: string) => readFileSync(join(folder, file)),
    readSource: (file: string) => readFileSync(file),
  })).toEqual({ artifacts: 389, sources: 14 });
  const rows = JSON.parse(readFileSync(join(folder, 'results.json'), 'utf8')) as {
    size: number; variant: string; scope?: number; kind: string;
    samplesMs?: number[]; medianMs?: number; p95Ms?: number; planFile?: string;
  }[];
  expect(rows).toHaveLength(408);
  expect(new Set(rows.map(r => [r.size, r.variant, r.scope, r.kind].join('|'))).size).toBe(408);
  expect(rows.filter(r => r.planFile)).toHaveLength(384);
  expect(rows.filter(r => r.kind === 'grouped_insert_100')).toHaveLength(12);
  for (const row of rows.filter(r => r.samplesMs)) {
    expect(row.samplesMs).toHaveLength(20);
    const sorted = [...row.samplesMs!].sort((a, b) => a - b);
    expect(sorted.every(n => Number.isFinite(n) && n >= 0)).toBe(true);
    expect(row.medianMs).toBe((sorted[9] + sorted[10]) / 2);
    expect(row.p95Ms).toBe(sorted[18]);
  }
  const report = readFileSync('docs/database/db01/findings-2026-10-27.md', 'utf8');
  for (const kind of ['transaction_list', 'batch_list_warning_summary']) {
    const row = rows.find(r => r.size === 100000 && r.variant === 'baseline' && r.scope === 1000 && r.kind === kind)!;
    expect(report).toContain(`${row.medianMs!.toFixed(3)} / ${row.p95Ms!.toFixed(3)}`);
  }
});

it('fixture is deterministic and refuses unsupported sizes', () => {
  expect(fixtureSql(1000)).toBe(fixtureSql(1000));
  expect(() => fixtureSql(999)).toThrow();
});

it.skipIf(!process.env.DB01_PORT)('native disposable DB01 matrix', async () => {
  const output = process.env.DB01_OUTPUT!;
  if (!process.env.DB01_CLUSTER || !output || !/^\d+$/.test(process.env.DB01_PORT!)) throw new Error('Use isolated launcher');
  const pool = new Pool({ host: '127.0.0.1', port: Number(process.env.DB01_PORT), user: 'db01', database: 'postgres', max: 1,
    statement_timeout: 120000, connectionTimeoutMillis: 5000 });
  const results: Record<string, unknown>[] = [];
  const save = () => writeFileSync(join(output, 'results.json'), JSON.stringify(results, null, 2));
  const candidates: Record<string, string | null> = {
    baseline: null,
    transaction_order: 'CREATE INDEX db01_candidate ON public.financial_records(canonical_date DESC,id DESC)',
    batch_order: 'CREATE INDEX db01_candidate ON public.ingestion_batches(created_at DESC,id DESC)',
    scoped_order: 'CREATE INDEX db01_candidate ON public.financial_records(batch_id,canonical_date DESC,id DESC)',
  };
  const stats = (samples: number[]) => {
    const sorted = [...samples].sort((a,b) => a-b);
    return { medianMs: (sorted[9]+sorted[10])/2, p95Ms: sorted[18], samplesMs: samples };
  };
  try {
    expect((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n).toBe(0);
    await pool.query('CREATE ROLE anon; CREATE ROLE authenticated;');
    for (const file of ['phase1-clean-setup.sql','c3b1-grouped-persistence-upgrade.sql']) {
      await pool.query(readFileSync(join('supabase/sql',file),'utf8'));
    }
    writeFileSync(join(output,'environment.json'), JSON.stringify({ seed: SEED, warmups: 3, measuredRuns: 20,
      version: (await pool.query('SELECT version()')).rows[0], node: process.version,
      settings: (await pool.query("SELECT name,setting,unit FROM pg_settings WHERE name IN ('shared_buffers','work_mem','effective_cache_size','fsync','synchronous_commit','max_connections','jit','random_page_cost')")).rows,
      methodology: 'Single client, warm cache, unnamed parameterized queries. Client latency includes transfer and pg decoding; plans measured separately. No hosted data.' },null,2));
    for (const size of [1000,10000,100000]) {
      for (const [variant, ddl] of Object.entries(candidates)) {
        await pool.query('DROP INDEX IF EXISTS public.db01_candidate');
        await pool.query('TRUNCATE public.validation_issues,public.financial_records,public.ingestion_batches,public.persistence_attempts');
        if (ddl) await pool.query(ddl);
        await pool.query('SET statement_timeout=600000');
        const started = performance.now();
        await pool.query(fixtureSql(size));
        const loadMs = performance.now()-started;
        await pool.query('SET statement_timeout=120000');
        expect((await pool.query('SELECT count(*)::int n FROM public.financial_records')).rows[0].n).toBe(size);
        expect((await pool.query(`SELECT count(*)::int n FROM public.financial_records r WHERE
          (ingestion_status='WARNING') <> EXISTS(SELECT 1 FROM public.validation_issues i WHERE i.financial_record_id=r.id)`)).rows[0].n).toBe(0);
        expect((await pool.query('SELECT source_amount::text, balance FROM public.financial_records WHERE id=$1',[recordId(1)])).rows[0])
          .toEqual({ source_amount:'9007199254740993.123456789', balance:null });
        results.push({ size, variant, kind:'fixture_load', loadMs, rowsPerSecond:size*1000/loadMs,
          indexes:(await pool.query(`SELECT indexrelname,pg_relation_size(indexrelid)::text bytes FROM pg_stat_user_indexes ORDER BY indexrelname`)).rows });
        for (const scope of [1,10,100,1000]) {
          const batchIds = Array.from({length:scope},(_,i)=>batchId(i+1));
          const access = { subjectId:'db01',organizationId:'synthetic',scopeVersion:'v1',batchIds };
          let captured: {sql:string; values?:unknown[]} | undefined;
          const database: SqlConnection = { async query(sql,values) { captured={sql,values}; return {rows:[],rowCount:0}; } };
          const tx = createTransactionQueryService({database,resolveAccess:async()=>access,auditRead:async()=>true,
            cursors:{issue:async()=>'synthetic',verify:async()=>({canonicalDate:'2026-07-01',transactionId:recordId(Math.floor(size/2))})}});
          const detail = createTransactionDetailQueryService({database,resolveAccess:async()=>access,audit:async()=>true});
          const batches = createBatchQueryService({database,resolveAccess:async()=>access,audit:async()=>true,
            cursors:{issue:async()=>'synthetic',verify:async()=>({createdAt:'2026-01-01T00:00:00.000500Z',batchId:batchId(500)})}});
          const cases: [string,()=>Promise<unknown>][] = [
            ['transaction_list',()=>tx.list(new URLSearchParams('limit=50'),null)],
            ['transaction_continuation',()=>tx.list(new URLSearchParams('limit=50&cursor=synthetic'),null)],
            ['transaction_dates',()=>tx.list(new URLSearchParams('limit=50&date_from=2026-06-01&date_to=2026-06-30'),null)],
            ['transaction_currency',()=>tx.list(new URLSearchParams('limit=50&currency=MYR'),null)],
            ['transaction_detail',()=>detail.get(recordId(1),null)],
            ['batch_list_warning_summary',()=>batches.list(new URLSearchParams('limit=50'),null)],
            ['batch_continuation_warning_summary',()=>batches.list(new URLSearchParams('limit=50&cursor=synthetic'),null)],
            ['batch_detail_warning_summary',()=>batches.get(batchId(1),null)],
          ];
          for (const [name,capture] of cases) {
            captured=undefined; await capture();
            if (!captured) throw new Error('SQL capture failed');
            const {sql,values} = captured as {sql:string;values?:unknown[]};
            for(let n=0;n<3;n++) await pool.query(sql,values);
            const samples:number[]=[];
            for(let n=0;n<20;n++) { const t=performance.now(); await pool.query(sql,values); samples.push(performance.now()-t); }
            const plan=(await pool.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,values)).rows[0]['QUERY PLAN'];
            const planFile=`${size}-${variant}-${scope}-${name}.json`;
            writeFileSync(join(output,planFile),JSON.stringify({sql,values,plan},null,2));
            results.push({size,variant,scope,kind:name,...stats(samples),planFile});
          }
        }
        const payload = await Promise.all([0,1].map(i=>syntheticResult(header+'\n'+Array.from({length:50},(_,n)=>validRow.replace('00017',n%5===0?'':`R${i}-${n}`)).join('\n'),{},
          {batchId:`synthetic-probe-${i}`,ingestedAt:'2026-10-01T00:00:00Z'},`probe-${i}.csv`)));
        expect(payload.reduce((n,r)=>n+r.normalized.length,0)).toBe(100);
        const writer=createGroupedPersistenceService(transactionDatabase(pool));
        const samples:number[]=[];
        for(let n=0;n<23;n++) {
          const id=randomUUID(), t=performance.now();
          await writer.persistGroupedAttempt({attempt_id:id,results:payload});
          const elapsed=performance.now()-t;
          if(n>=3) samples.push(elapsed);
          await pool.query('BEGIN');
          await pool.query(`DELETE FROM public.validation_issues WHERE financial_record_id IN (SELECT r.id FROM public.financial_records r JOIN public.ingestion_batches b ON b.id=r.batch_id WHERE b.persistence_attempt_id=$1)`,[id]);
          await pool.query('DELETE FROM public.financial_records WHERE batch_id IN (SELECT id FROM public.ingestion_batches WHERE persistence_attempt_id=$1)',[id]);
          await pool.query('DELETE FROM public.ingestion_batches WHERE persistence_attempt_id=$1',[id]);
          await pool.query('DELETE FROM public.persistence_attempts WHERE id=$1',[id]);
          await pool.query('COMMIT');
        }
        const measured=stats(samples);
        results.push({size,variant,kind:'grouped_insert_100',...measured,rowsPerSecond:100000/measured.medianMs});
        save(); console.log(`DB01 completed ${size} ${variant}`);
      }
    }
  } finally { save(); await pool.end(); }
}, 1800000);
