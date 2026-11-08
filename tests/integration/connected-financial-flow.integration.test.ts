import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createLocalSecurityFixture } from './backend-security.fixtures';
import { createLocalSessionSumService } from '../../lib/server/integration/local-session-sum';
import { createLocalFinancialReportService } from '../../lib/server/integration/local-financial-report';
import { createLocalFinancialQuestionService } from '../../lib/server/integration/local-financial-question';

describe('local synthetic persisted-source financial flow', () => {
 it('preserves the persisted amounts and source references from tenant access through report and answer', async () => {
  const fixture = await createLocalSecurityFixture();
  try {
   await fixture.local.exec(readFileSync('tests/fixtures/local-session-scope.sql', 'utf8'));
   const org = randomUUID(), otherOrg = randomUUID(), subject = randomUUID();
   const token = randomBytes(32).toString('base64url');
   await fixture.pool.query("INSERT INTO fingence_local_security_v1.memberships VALUES($1,$2,'Finance',true,1)", [subject, org]);
   await fixture.pool.query("INSERT INTO fingence_local_security_v1.sessions VALUES($1,$2,$3,now()+interval '1 hour',false)", [createHash('sha256').update(token).digest('hex'), subject, org]);
   for (const child of fixture.receipt.datasets) await fixture.pool.query('INSERT INTO fingence_local_security_v1.batch_owners VALUES($1,$2)', [child.batch_id, org]);
   const counts = (await fixture.pool.query(`SELECT count(*)::int AS records FROM public.financial_records`)).rows[0];
   expect(counts.records).toBe(23);
   const selected = await fixture.pool.query(`SELECT id::text,batch_id::text,source_row_id,source_amount::text,currency FROM public.financial_records WHERE source_file='edge_cases.csv' AND reference IN ('E-001','E-002') AND ingestion_status='VALID' ORDER BY reference`);
   expect(selected.rows.map(r => [r.source_amount,r.currency])).toEqual([['125.5','MYR'],['-20','MYR']]);
   const ids = selected.rows.map(row => row.id as string);
   const service = createLocalFinancialReportService(createLocalSessionSumService(fixture.database));
   const result = await service.build(token, ids, 'include');
   expect(result.status).toBe('AVAILABLE');
   if (result.status !== 'AVAILABLE') throw new Error('expected local result');
   const report = JSON.parse(result.download);
   expect(report).toMatchObject({publicationEligible:false,kind:'SOURCE_SIGNED_AMOUNT_SUM',total:'105.5',currency:'MYR',includedCount:2});
   expect(result.answer).toMatchObject({origin:'DETERMINISTIC_ONLY',value:report.total,currency:report.currency,sources:report.sources});
   const questions = createLocalFinancialQuestionService(service);
   expect(await questions.answer(token,ids,'include','What is the sum of signed source amounts?')).toEqual({status:'ANSWERED',...result.answer});
   expect(await questions.answer(token,ids,'include','What is the revenue?')).toEqual({status:'UNSUPPORTED'});
   expect(report.sources).toEqual(expect.arrayContaining(selected.rows.map(row => ({transactionId:row.id,batchId:row.batch_id,sourceRowId:row.source_row_id}))));
   await fixture.pool.query('UPDATE fingence_local_security_v1.batch_owners SET organization_id=$1 WHERE batch_id=$2', [otherOrg, selected.rows[0].batch_id]);
   expect(await service.build(token, ids, 'include')).toEqual({status:'DENIED'});
   expect(await questions.answer(token,ids,'include','What is the sum of signed source amounts?')).toEqual({status:'DENIED'});
   console.info('SYNTHETIC_CONNECTED_FLOW', JSON.stringify({batches:fixture.receipt.datasets.length,acceptedRecords:counts.records,selected:ids.length,total:report.total,currency:report.currency,origin:result.answer.origin,publicationEligible:report.publicationEligible}));
  } finally { await fixture.close(); }
 }, 30000);
});
