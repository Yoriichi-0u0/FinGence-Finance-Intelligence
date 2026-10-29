import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createLocalSecurityFixture} from './backend-security.fixtures';
import {createScopedFinancialTools} from '../../lib/server/integration/scoped-financial-tools';
import {header,syntheticResult,validRow} from '../persistence/fixtures';
import {randomUUID} from 'node:crypto';
let f:Awaited<ReturnType<typeof createLocalSecurityFixture>>;
beforeAll(async()=>{f=await createLocalSecurityFixture();},30000);afterAll(async()=>{await f?.close();});
function deps(){return {readConnection:f.pool,auditDatabase:f.database,resolvePrincipal:f.resolvePrincipal,resolveAccess:f.resolveAccess,resolveTransactionScope:f.resolveTransactionScope,cursorSecret:'synthetic-cursor-secret-at-least-32-bytes-long'};}
async function find(sql:string){const r=await f.pool.query(sql);if(!r.rows[0])throw new Error('FIXTURE_MISSING');return r.rows[0].id as string;}
describe('scoped exact source amount tool',()=>{
 it('adds actual engine-generated synthetic values exactly and retains source references',async()=>{
  const a=await find("SELECT id::text FROM public.financial_records WHERE source_file='edge_cases.csv' AND reference='E-001' AND ingestion_status='VALID' LIMIT 1");
  const b=await find("SELECT id::text FROM public.financial_records WHERE source_file='edge_cases.csv' AND reference='E-002' AND ingestion_status='VALID' LIMIT 1");
  const before=(await f.pool.query('SELECT count(*)::int n FROM public.security_audit_events')).rows[0].n;
  const result=await createScopedFinancialTools(deps()).sumSourceAmounts([a,b],f.request('session-a'),'include');
  expect(result).toMatchObject({status:'AVAILABLE',currency:'MYR',monetaryBasis:'source_signed_amount',total:'105.5',includedCount:2,excludedWarnings:0});
  if(result.status!=='AVAILABLE')throw new Error('EXPECTED_AVAILABLE');
  expect(result.sources).toHaveLength(2);expect(result.sources.map(x=>x.transactionId)).toEqual([a,b]);
  const after=(await f.pool.query('SELECT count(*)::int n FROM public.security_audit_events')).rows[0].n;expect(after-before).toBe(2);
 });
 it('excludes warnings explicitly without returning a complete-looking zero',async()=>{
  const id=await find("SELECT id::text FROM public.financial_records WHERE ingestion_status='WARNING' AND monetary_basis='source_signed_amount' AND currency_basis='SOURCE' LIMIT 1");
  const result=await createScopedFinancialTools(deps()).sumSourceAmounts([id],f.request('session-a'),'exclude');
  expect(result).toMatchObject({status:'UNAVAILABLE',reason:'NO_INCLUDED_RECORDS',includedCount:0,excludedWarnings:1});
 });
 it('rejects ledger basis and duplicate ids instead of inventing a conversion',async()=>{
  const ledger=await find("SELECT id::text FROM public.financial_records WHERE monetary_basis='debit_credit' LIMIT 1");
  const signed=await find("SELECT id::text FROM public.financial_records WHERE monetary_basis='source_signed_amount' LIMIT 1");
  await expect(createScopedFinancialTools(deps()).sumSourceAmounts([ledger],f.request('session-a'),'include')).rejects.toThrow('UNSUPPORTED_FINANCIAL_BASIS');
  await expect(createScopedFinancialTools(deps()).sumSourceAmounts([ledger,ledger],f.request('session-a'),'include')).rejects.toThrow('INVALID_SELECTION');
  await expect(createScopedFinancialTools(deps()).sumSourceAmounts([ledger,signed],f.request('session-a'),'include')).rejects.toThrow('UNSUPPORTED_SELECTION_SCOPE');
 });
 it('does not disclose an out-of-organization selection or unaudited values',async()=>{
  const id=await find('SELECT id::text FROM public.financial_records LIMIT 1');
  await expect(createScopedFinancialTools(deps()).sumSourceAmounts([id],f.request('session-b'),'include')).rejects.toMatchObject({status:404});
  const broken={close:async()=>{},transaction:async()=>{throw new Error('secret');}};
  await expect(createScopedFinancialTools({...deps(),auditDatabase:broken}).sumSourceAmounts([id],f.request('session-a'),'include')).rejects.toThrow();
 });
 it('preserves precision beyond IEEE-754 through actual ingestion and persistence',async()=>{
  const second='2026-09-02,2026-09-04,0.876543211,00018,00043,00100,00003,00004,Synthetic only,MYR';
  const input=await syntheticResult(`${header}\n${validRow}\n${second}`,{}, {batchId:randomUUID(),ingestedAt:'2026-10-15T12:00:00.000Z'});
  const receipt=await f.writer.persistGroupedAttempt({attempt_id:randomUUID(),results:[input]});const batch=receipt.datasets[0].batch_id;
  await f.pool.query("INSERT INTO test_security.ownership VALUES ($1,'org-a')",[batch]);
  const ids=(await f.pool.query('SELECT id::text FROM public.financial_records WHERE batch_id=$1 ORDER BY source_row_number',[batch])).rows.map(x=>x.id as string);
  const result=await createScopedFinancialTools(deps()).sumSourceAmounts(ids,f.request('session-a'),'include');
  expect(result).toMatchObject({status:'AVAILABLE',total:'9007199254740994',currency:'MYR',includedCount:2});
 });
 it('does not add different currencies even within one batch',async()=>{
  const second='2026-09-02,2026-09-04,0.876543211,00018,00043,00100,00003,00004,Synthetic only,USD';
  const input=await syntheticResult(`${header}\n${validRow}\n${second}`,{}, {batchId:randomUUID(),ingestedAt:'2026-10-15T12:00:00.000Z'});
  const receipt=await f.writer.persistGroupedAttempt({attempt_id:randomUUID(),results:[input]});const batch=receipt.datasets[0].batch_id;
  await f.pool.query("INSERT INTO test_security.ownership VALUES ($1,'org-a')",[batch]);
  const ids=(await f.pool.query('SELECT id::text FROM public.financial_records WHERE batch_id=$1 ORDER BY source_row_number',[batch])).rows.map(x=>x.id as string);
  await expect(createScopedFinancialTools(deps()).sumSourceAmounts(ids,f.request('session-a'),'include')).rejects.toThrow('UNSUPPORTED_FINANCIAL_BASIS');
 });
});
