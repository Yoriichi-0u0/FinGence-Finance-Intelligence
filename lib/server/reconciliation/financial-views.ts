import 'server-only';
import {dashboardContext} from '../../reconciliation-dashboard';
import {cashTotals} from '../../poc-insights/model';
import {forecastBusiness,FORECAST_VERSION,type ForecastRow} from '../../poc-forecast/forecast';
import {cashCents,formatCents} from '../../poc-reconciliation/engine';
import {toCents} from '../../poc-anomalies/source';
export const FINANCIAL_VIEWS_VERSION='db04-financial-views/1';
/** Called only with an authenticated get result; no queries, cross-job selection or AI promotion. */
export function financialViews(input:unknown,id:string) {
 const context=dashboardContext(input,id),bank:ForecastRow[]=[];
 let scope:string|undefined,businessId='',period='';
 for(const r of context.transactions) {
  if(!['VALID','WARNING'].includes(String(r.status))||r.currency!=='MYR'||!r.evidence||typeof r.evidence!=='object')throw Error('UNVERIFIED_FINANCIAL_RECORD');
  const raw=r.evidence as Record<string,string>,signed=cashCents(String(r.signed_amount));
  if(raw.Currency!==r.currency||cashCents(raw.SignedCashMovementMYR)!==signed||typeof r.canonical_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.canonical_date)||new Date(r.canonical_date).toISOString().slice(0,10)!==r.canonical_date||!raw.BusinessID)throw Error('FINANCIAL_EVIDENCE_MISMATCH');
  const rowScope=JSON.stringify([raw.BusinessID,r.canonical_date.slice(0,7),r.currency]);
  if(scope!==undefined&&scope!==rowScope)throw Error('MIXED_FINANCIAL_SCOPE');scope=rowScope;businessId=raw.BusinessID;period=r.canonical_date.slice(0,7);
  if(r.kind==='BANK') {
   const amount=cashCents(raw.BankAmountMYR);
   if(r.date_basis!=='VALUE_DATE'||r.value_date!==r.canonical_date||raw.ValueDate!==r.value_date||raw.StatementMonth!==period||!['Credit','Debit'].includes(raw.BankDirection)||amount<0n||signed!==(raw.BankDirection==='Credit'?amount:-amount))throw Error('UNVERIFIED_BANK_CASH');
   bank.push({businessId,currency:'MYR',period,direction:raw.BankDirection as 'Credit'|'Debit',amount:formatCents(amount),signedAmount:formatCents(signed)});
  }else if(r.kind==='LEDGER') {
   const debit=cashCents(raw.CashAccountDebitMYR),credit=cashCents(raw.CashAccountCreditMYR);
   if(r.date_basis!=='POSTING_DATE'||r.posting_date!==r.canonical_date||raw.PostingDate!==r.posting_date||raw.CashAccount!=='1000-BANK'||debit<0n||credit<0n||(debit!==0n&&credit!==0n)||signed!==debit-credit)throw Error('UNVERIFIED_LEDGER_CASH');
  }else throw Error('UNKNOWN_FINANCIAL_ROLE');
 }
 if(!bank.length)throw Error('NO_VERIFIED_BANK_ROWS');
 const totals=cashTotals(bank),forecast=forecastBusiness(bank);
 const counts={verifiedSuggestions:0,unresolvedProposals:0,unresolvedCases:context.cases.length};
 for(const p of context.proposals){if(p.processing_id!==id||p.organization_id!==context.job.organization_id)throw Error('RECONCILIATION_SCOPE_MISMATCH');if(p.decision==='VERIFIED_SUGGESTION')counts.verifiedSuggestions++;else if(p.decision==='UNRESOLVED')counts.unresolvedProposals++;else throw Error('UNKNOWN_RECONCILIATION_DECISION');}
 const limitations=['BANK cash movement only; not revenue, expenses, profit, closing balance or a statutory statement.','Fuzzy/E5 rankings and financial eligibility are proposals, not approved transactions.'];
 const unavailable={revenue:'Unavailable accounting classification',expenses:'Unavailable accounting classification',profit:'Unavailable revenue and expense evidence',ratios:'Unavailable accounting balances and classifications',balanceSheet:'Unavailable verified balance-sheet evidence'};
 const summary={version:FINANCIAL_VIEWS_VERSION,organizationId:context.job.organization_id,processingId:id,businessId,period,currency:'MYR',sources:context.sources.map(s=>({kind:s.kind,sha256:s.sha256})),
  calculationVersions:{cash:'poc-insights/cashTotals',forecast:FORECAST_VERSION,adapter:FINANCIAL_VIEWS_VERSION},
  cashMovement:{inflows:totals.credits,outflows:formatCents(-toCents(totals.debits)),net:totals.net,bankRows:totals.rows},reconciliation:counts,
  aiProposals:{rankingBatches:context.rankings?.length??0,verificationSnapshots:context.proposalVerifications?.length??0,approvedTransactions:0},
  forecast,unavailable,limitations,evidence:{sources:context.sources,transactions:context.transactions,deterministicProposals:context.proposals,cases:context.cases,proposalVerifications:context.proposalVerifications??[]}};
 return {...summary,report:{version:'db04-financial-report/1',organizationId:summary.organizationId,processingId:id,period,sources:summary.sources,calculationVersions:summary.calculationVersions,cashMovement:summary.cashMovement,reconciliation:counts,aiProposals:summary.aiProposals,unavailable,limitations,verificationEvidence:summary.evidence}};
}
export type FinancialViewsV1=ReturnType<typeof financialViews>;
