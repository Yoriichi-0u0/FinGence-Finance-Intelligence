// Optional local PostgreSQL/WASM verifier; no application dependency or credentials.
// Install the pinned runtime using the command in docs/database/initial-ingestion-foundation.md.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const sql = path => readFileSync(new URL(path, import.meta.url), 'utf8');
try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  await db.exec(sql('./fixtures/phase1-original-schema.sql'));
  console.log('PASS original Phase 1 test fixture on fresh PostgreSQL runtime');
  await db.exec(sql('../seed.sql'));
  await db.exec(sql('../seed.sql'));
  console.log('PASS seed and repeat seed');
  await db.exec(sql('./verify_ingestion_foundation.sql'));
  console.log('PASS SQL assertions and rolled-back negative tests');
  await db.exec(`BEGIN;
    UPDATE public.financial_records SET monetary_basis='debit_credit', debit=3.125, credit=1.005, derived_ledger_net=2.12, source_amount=9.75 WHERE id='20000000-0000-4000-8000-000000000001';
    SET CONSTRAINTS ALL IMMEDIATE;
    ROLLBACK;`);
  console.log('PASS optional source_amount preserved alongside ledger representation');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    for (const table of ['ingestion_batches','financial_records','validation_issues']) {
      await assert.rejects(db.query(`SELECT * FROM public.${table}`), e => e.code === '42501');
    }
    await db.exec('RESET ROLE');
    // Demonstrate RLS itself denies reads even if a future grant is added.
    await db.exec(`BEGIN; GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT ON public.ingestion_batches, public.financial_records, public.validation_issues TO ${role}; SET ROLE ${role};`);
    for (const table of ['ingestion_batches','financial_records','validation_issues']) {
      assert.equal((await db.query(`SELECT * FROM public.${table}`)).rows.length, 0);
    }
    await db.exec('RESET ROLE; ROLLBACK;');
  }
  console.log('PASS anon/authenticated privilege denial and RLS row denial');
  const evidence = JSON.parse(sql('../../docs/handoff/examples/ingestion-evidence.json'));
  assert.equal(evidence.schema_version, '0.1');
  assert.equal(evidence.ruleset_version, '0.1');
  const columns = ['transaction_date','posting_date','canonical_date','canonical_date_basis','reference','source_transaction_id','account_code','account_id','entity_id','description','counterparty','debit','credit','source_amount','derived_ledger_net','balance','entry_side','monetary_basis','currency','currency_basis','transformations','ingestion_status','source_system','source_file','source_sheet','source_row_number','source_row_id','file_sha256','ingestion_batch_id','ingested_at'];
  const monetary = ['debit','credit','source_amount','derived_ledger_net','balance'];
  await db.exec('BEGIN');
  const batch = (await db.query("INSERT INTO public.ingestion_batches(ingestion_batch_id,schema_version,ruleset_version) VALUES ('synthetic-handoff-example-batch-001','0.1','0.1') RETURNING id")).rows[0].id;
  let accepted = 0, warnings = 0;
  for (const dataset of evidence.datasets) {
    assert.equal(dataset.schema_version, '0.1');
    assert.equal(dataset.ruleset_version, '0.1');
    for (const row of dataset.normalized) {
      for (const field of monetary) assert.ok(row[field] === null || typeof row[field] === 'string');
      const values = columns.map(key => key === 'transformations' ? JSON.stringify(row[key]) : row[key]);
      const stored = (await db.query(`INSERT INTO public.financial_records(batch_id,${columns.join(',')}) VALUES ($1,${columns.map((_,i) => '$'+(i+2)).join(',')}) RETURNING id`, [batch,...values])).rows[0];
      for (const [ordinal, issue] of row.validation_messages.entries()) {
        await db.query('INSERT INTO public.validation_issues(financial_record_id,issue_ordinal,rule,category,severity,field,source_column,original_value,message) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [stored.id,ordinal,issue.rule,issue.category,issue.severity,issue.field,issue.sourceColumn,JSON.stringify(issue.originalValue),issue.message]);
      }
      const exact = (await db.query(`SELECT ${monetary.map(k => k+'::text AS '+k).join(',')},source_row_id FROM public.financial_records WHERE id=$1`, [stored.id])).rows[0];
      for (const field of monetary) assert.equal(exact[field], row[field]);
      assert.equal(exact.source_row_id,row.source_row_id);
      accepted++; if (row.ingestion_status === 'WARNING') warnings++;
    }
  }
  assert.equal(accepted,23); assert.equal(warnings,3);
  await db.exec('SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;');
  console.log('PASS all 23 engine-exported canonical records and ordered warnings without decimal coercion');
  const indexes = await db.query("SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY indexname");
  assert.equal(indexes.rows.length, 11);
  console.log('PASS 11 indexes including primary/unique relationship indexes');
  console.log('ALL LOCAL DATABASE CHECKS PASSED');
} catch (error) { console.error('FAIL', error.code ?? '', error.message); process.exitCode = 1; } finally { await db.close(); }
