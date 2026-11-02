import {it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import FinancialViews from '../../components/db04/financial-views';
import {dashboardContext} from '../../lib/reconciliation-dashboard';
vi.mock('server-only',()=>({}));
import {financialViews} from '../../lib/server/reconciliation/financial-views';
import {prepareProcessing,digest} from '../../lib/server/reconciliation/processing';
import {bank,ledger,csv} from '../poc-reconciliation/fixtures';
const org='00000000-0000-4000-8000-000000000001';
function fixture(bs=[bank],ls=[ledger]) {
 const b=csv(bs),l=csv(ls),plan=prepareProcessing(org,{bytes:b,filename:'bank.csv'},{bytes:l,filename:'ledger.csv'},{bank:digest(b),ledger:digest(l)}),id=plan.processingId;
 return {id,input:{version:'db04-processing-read/1',processingId:id,job:{processing_id:id,organization_id:org},sources:[{kind:'BANK',sha256:digest(b),organization_id:org},{kind:'LEDGER',sha256:digest(l),organization_id:org}],transactions:plan.transactions.map(r=>({kind:r.kind,sha256:r.sha256,record_id:r.recordId,status:'VALID',signed_amount:r.signedAmount,currency:'MYR',date_basis:r.kind==='BANK'?'VALUE_DATE':'POSTING_DATE',canonical_date:r.date,value_date:r.kind==='BANK'?r.date:null,posting_date:r.kind==='LEDGER'?r.date:null,evidence:r.evidence})),proposals:plan.proposals.map(p=>({organization_id:org,processing_id:id,decision:p.decision})),cases:plan.cases,rankings:[{version:'db04-e5-proposals/1',evidence:[{decision:'UNRESOLVED',score:1}]}],proposalVerifications:[]}};
}
it('derives source-bound analytics, unavailable forecast and report from one context',()=>{
 const f=fixture(),r=financialViews(f.input,f.id);
 expect(r.cashMovement).toEqual({inflows:'6380.53',outflows:'0.00',net:'6380.53',bankRows:1});
 expect(r.reconciliation.verifiedSuggestions).toBe(1);expect(r.aiProposals.approvedTransactions).toBe(0);
 expect(r.forecast.forecast).toMatchObject({status:'UNAVAILABLE',code:'INSUFFICIENT_HISTORY'});
 expect(r.report.processingId).toBe(r.processingId);expect(r.report.sources).toEqual(r.sources);expect(r.report.cashMovement).toEqual(r.cashMovement);
 expect(r.unavailable.profit).toContain('Unavailable');
});
it('preserves exact cents above JS safe-integer range and does not sum ledger amounts',()=>{
 const amount='9007199254740991.99',f=fixture([{...bank,BankAmountMYR:amount,SignedCashMovementMYR:amount}]);
 const r=financialViews(f.input,f.id);expect(r.cashMovement.inflows).toBe(amount);expect(r.cashMovement.net).toBe(amount);expect(r.cashMovement.bankRows).toBe(1);
});
it('calculates outflow magnitude and net with existing exact cash arithmetic',()=>{
 const f=fixture([{...bank,BankDirection:'Debit',BankAmountMYR:'0.10',SignedCashMovementMYR:'-0.10'}],[{...ledger,CashAccountDebitMYR:'0.00',CashAccountCreditMYR:'0.10',SignedCashMovementMYR:'-0.10'}]);
 expect(financialViews(f.input,f.id).cashMovement).toEqual({inflows:'0.00',outflows:'0.10',net:'-0.10',bankRows:1});
});
it('preserves totals larger than the individual-source amount bound',()=>{
 const amount='9007199254740991.99';
 const bs=[1,2].map(i=>({...bank,BankTransactionID:`B${i}`,BankReference:`R${i}`,BankDirection:'Debit',BankAmountMYR:amount,SignedCashMovementMYR:`-${amount}`}));
 const ls=[1,2].map(i=>({...ledger,LedgerEntryID:`L${i}`,LedgerReference:`R${i}`,CashAccountDebitMYR:'0.00',CashAccountCreditMYR:amount,SignedCashMovementMYR:`-${amount}`}));
 const f=fixture(bs,ls);expect(financialViews(f.input,f.id).cashMovement).toMatchObject({outflows:'18014398509481983.98',net:'-18014398509481983.98'});
});
it('rejects changed scope, fingerprints and rejected or contradictory financial records',()=>{
 const f=fixture();expect(()=>financialViews(f.input,'wrong')).toThrow();
 f.input.sources[0].sha256='f'.repeat(64);expect(()=>financialViews(f.input,f.id)).toThrow();
 const g=fixture();g.input.transactions[0].status='REJECTED';expect(()=>financialViews(g.input,g.id)).toThrow();
 const h=fixture();h.input.transactions[0].evidence.SignedCashMovementMYR='0';expect(()=>financialViews(h.input,h.id)).toThrow();
});
it('renders source-backed report and explicit forecast/refused accounting metrics',()=>{
 const f=fixture(),data=financialViews(f.input,f.id);
 const report=renderToStaticMarkup(createElement(FinancialViews,{data,view:'reports'}));
 expect(report).toContain(f.id);expect(report).toContain('6380.53');expect(report).toContain('profit: UNAVAILABLE');expect(report).toContain('not financial approval');
 const forecast=renderToStaticMarkup(createElement(FinancialViews,{data,view:'forecasting'}));expect(forecast).toContain('UNAVAILABLE');expect(forecast).toContain('INSUFFICIENT_HISTORY');
});
it('rejects financial summaries from another processing/report context at the dashboard boundary',()=>{
 const f=fixture(),data=financialViews(f.input,f.id);
 expect(dashboardContext({...f.input,financialViews:data},f.id).processingId).toBe(f.id);
 expect(()=>dashboardContext({...f.input,financialViews:{...data,processingId:'other'}},f.id)).toThrow();
 expect(()=>dashboardContext({...f.input,financialViews:{...data,report:{...data.report,organizationId:'other'}}},f.id)).toThrow();
});
