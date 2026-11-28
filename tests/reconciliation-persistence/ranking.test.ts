import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {rankPersistedCash} from '../../lib/server/reconciliation/ranking';
import {fuzzyScore} from '../../lib/server/reconciliation/ai02/fuzzy';
const id='c'.repeat(64),org='synthetic';
function context(){return {version:'db04-processing-read/1',processingId:id,job:{processing_id:id,organization_id:org},sources:[{kind:'BANK',sha256:'a'.repeat(64),organization_id:org},{kind:'LEDGER',sha256:'b'.repeat(64),organization_id:org}],transactions:[{kind:'BANK',sha256:'a'.repeat(64),record_id:'b',currency:'MYR',signed_amount:'1.00',canonical_date:'2026-03-01',value_date:'2026-03-01',date_basis:'VALUE_DATE',evidence:{SignedCashMovementMYR:'1.00',BankDescription:'Synthetic repair',BankReference:'R',Counterparty:'Supplier'}},{kind:'LEDGER',sha256:'b'.repeat(64),record_id:'l',currency:'MYR',signed_amount:'1.00',canonical_date:'2026-03-01',posting_date:'2026-03-01',date_basis:'POSTING_DATE',evidence:{SignedCashMovementMYR:'1.00',LedgerMemo:'Synthetic repair',LedgerReference:'R',Counterparty:'Supplier'}}],proposals:[],cases:[]};}
it('preserves exact amounts and original date basis while leaving fuzzy scores unapproved',()=>{
 const result=rankPersistedCash(context(),id);expect(result).toHaveLength(1);expect(result[0]).toMatchObject({amount:'1.00',decision:'UNRESOLVED',bankDateBasis:'VALUE_DATE',ledgerDateBasis:'POSTING_DATE',score:1});
});
it('rejects incompatible dates, financial evidence and duplicate records',()=>{
 const date=context();date.transactions[0].date_basis='TRANSACTION_DATE';expect(()=>rankPersistedCash(date,id)).toThrow();
 const amount=context();amount.transactions[0].evidence.SignedCashMovementMYR='2';expect(()=>rankPersistedCash(amount,id)).toThrow();
 const duplicate=context();duplicate.transactions.push(duplicate.transactions[0]);expect(()=>rankPersistedCash(duplicate,id)).toThrow('DUPLICATE_RECORD');
});
it('keeps ambiguous candidates unassigned and excludes unequal money',()=>{
 const ambiguous=context();ambiguous.transactions.push({...ambiguous.transactions[1],record_id:'other'});
 expect(rankPersistedCash(ambiguous,id).every(r=>r.decision==='UNRESOLVED')).toBe(true);
 const mismatch=context();mismatch.transactions[1].signed_amount='2';mismatch.transactions[1].evidence.SignedCashMovementMYR='2';expect(rankPersistedCash(mismatch,id)).toEqual([]);
});
it('retains the research counterparty contradiction guard',()=>{
 expect(fuzzyScore({description:'Repair',counterparty:'A',reference:'R'},{description:'Repair',counterparty:'B',reference:'R'}).supported).toBe(false);
});
