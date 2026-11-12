import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {verifyPersistedProposals} from '../../lib/server/reconciliation/proposal-verification';
import {bank,ledger} from '../poc-reconciliation/fixtures';
type Row=Record<string,unknown>;
const org='org',id='a'.repeat(64),bsha='b'.repeat(64),lsha='c'.repeat(64);
function fixture(){
 const records:Row[]=[{organization_id:org,processing_id:id,kind:'BANK',record_id:'B',sha256:bsha,status:'VALID',signed_amount:'6380.53',currency:'MYR',transaction_date:null,canonical_date:'2026-03-01',value_date:'2026-03-01',date_basis:'VALUE_DATE',evidence:{...bank}},{organization_id:org,processing_id:id,kind:'LEDGER',record_id:'L',sha256:lsha,status:'WARNING',signed_amount:'6380.53',currency:'MYR',transaction_date:null,canonical_date:'2026-03-01',posting_date:'2026-03-01',date_basis:'POSTING_DATE',evidence:{...ledger}}];
 const candidate:Row={version:'db04-fuzzy-proposals/1',bankRecordId:'B',ledgerRecordId:'L',bankSha256:bsha,ledgerSha256:lsha,amount:'6380.53',currency:'MYR',bankDateBasis:'VALUE_DATE',ledgerDateBasis:'POSTING_DATE',score:1,scoringEvidence:{}};
 const rankings:Row[]=[{version:'db04-fuzzy-proposals/1',evidence:[candidate]}];
 const sources:Row[]=[{kind:'BANK',sha256:bsha},{kind:'LEDGER',sha256:lsha}];
 const job={organization_id:org,processing_id:id,policy:{version:'synthetic-cash-same-day/1',maxDays:0}};
 return {records,candidate,rankings,sources,run:(d:Row[]=[])=>verifyPersistedProposals(org,id,job,sources,records,rankings,d)};
}
it('records independent financial eligibility without implying financial approval',()=>{
 const r=fixture().run()[0];expect(r.financialEligible).toBe(true);expect(r.identity).toEqual({REFERENCE:true,COUNTERPARTY:true});expect(r.outcome).toBe('UNRESOLVED');expect(r.reasons).toContain('ASSIGNMENT_POLICY_NOT_APPROVED');
});
it.each([
 ['signed_amount','6380.54','EXACT_AMOUNT'],['currency','USD','CURRENCY'],['signed_amount','-6380.53','DIRECTION'],['date_basis','TRANSACTION_DATE','DATE_BASIS'],['sha256',null,'SOURCE_IDENTITY'],['status','REJECTED','ACCEPTED'],['organization_id','other','CONTEXT'],['processing_id','other','CONTEXT'],
])('rejects authoritative %s contradictions', (field,value,check)=>{
 const f=fixture();f.records[1][field]=value;expect(f.run()[0].checks[check as keyof ReturnType<typeof f.run>[number]['checks']]).toBe(false);expect(f.run()[0].outcome).toBe('UNRESOLVED');
});
it('does not trust forged model financial values or source lineage',()=>{
 const f=fixture();f.candidate.amount='1';f.candidate.bankSha256='f'.repeat(64);const r=f.run()[0];expect(r.financialEligible).toBe(true);expect(r.rankingLineage).toBe(false);
});
it('checks raw accounting directions and dates without substituting date meanings',()=>{
 const f=fixture();(f.records[0].evidence as Row).BankDirection='Debit';expect(f.run()[0].checks.RAW_ACCOUNTING).toBe(false);
 const g=fixture();g.records[1].canonical_date='2026-03-03';g.records[1].posting_date='2026-03-03';(g.records[1].evidence as Row).PostingDate='2026-03-03';expect(g.run()[0].checks.DATE_POLICY).toBe(false);
});
it('retains missing records, unknown algorithms and group proposals as unresolved',()=>{
 const f=fixture();f.candidate.bankRecordId='missing';f.candidate.proposalType='GROUP';f.rankings[0].version='unregistered';const r=f.run()[0];expect(r.checks.RECORDS_EXIST).toBe(false);expect(r.rankingLineage).toBe(false);expect(r.reasons).toContain('GROUP_PARTIAL_UNSUPPORTED');
});
it('detects duplicate pairs and competing bank/ledger candidates across algorithms',()=>{
 const f=fixture();f.rankings.push({version:'db04-e5-proposals/1',evidence:[{...f.candidate,version:'db04-e5-proposals/1',ledgerRecordId:'L2'},{...f.candidate,version:'db04-e5-proposals/1',bankRecordId:'B2'}]});
 const r=f.run()[0];expect(r.conflicts.competingBank).toBe(true);expect(r.conflicts.competingLedger).toBe(true);
 const g=fixture();g.rankings[0].evidence=[g.candidate,g.candidate];expect(g.run()[0].conflicts.duplicatePair).toBe(true);
});
it('protects deterministic assignments without modifying them or choosing a higher score',()=>{
 const f=fixture(),d=[{bank_record_id:'B',ledger_record_id:'OTHER',decision:'VERIFIED_SUGGESTION'}];expect(f.run(d)[0].conflicts.deterministic).toBe(true);expect(d[0].ledger_record_id).toBe('OTHER');
});
