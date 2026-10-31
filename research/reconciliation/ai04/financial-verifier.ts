import { equalDecimals, isDecimal } from "../decimal";
import { TEMPLATES, PERIODS } from "../m2/schemas";
import type { Check, Policy, RecordEvidence, Split } from "./types";
import { keys, object } from "./projection";
export const check = (code: string, status: Check["status"], ...evidence: string[]): Check => ({code,status,evidence});
export const text = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= 512 && !s.includes("\0");
export function day(s: unknown): number | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const n=Date.parse(s+"T00:00:00.000Z");
  return Number.isFinite(n) && new Date(n).toISOString().slice(0,10)===s ? n/86400000 : null;
}
export const positive = (x: unknown): x is string => isDecimal(x) && !x.startsWith("-") && !equalDecimals(x,"0");
function basisValid(r: RecordEvidence): boolean {
  if (!positive(r.amount) || !["INFLOW","OUTFLOW"].includes(r.direction) || [r.sourceAmount,r.debit,r.credit].some(x=>x!==null&&!isDecimal(x))) return false;
  if (["CASH_DEBIT_CREDIT","EXPENSE_DEBIT_CREDIT"].includes(r.monetaryBasis)) {
    const activeDebit=r.monetaryBasis==="CASH_DEBIT_CREDIT" ? r.direction==="INFLOW" : r.direction==="OUTFLOW";
    const active=activeDebit?r.debit:r.credit, inactive=activeDebit?r.credit:r.debit;
    return r.sourceAmount===null && active!==null && equalDecimals(active,r.amount) && inactive===null;
  }
  if (!["SIGNED_CASH","SIGNED_EXPENSE","AMOUNT_DIRECTION"].includes(r.monetaryBasis)) return false;
  const negative=r.monetaryBasis==="SIGNED_CASH"?r.direction==="OUTFLOW":r.monetaryBasis==="SIGNED_EXPENSE"&&r.direction==="INFLOW";
  return r.debit===null && r.credit===null && r.sourceAmount!==null && equalDecimals(r.sourceAmount,(negative?"-":"")+r.amount);
}
export function sourceChecks(r: RecordEvidence, split: Split): Check[] {
  const refs=[r.id], t=TEMPLATES.find(t=>t.id===r.templateId&&t.split===split);
  const identity=text(r.id)&&text(r.systemId)&&text(r.accountId)&&text(r.sourceRowId)&&t&&t.role===r.role&&t.systemId===r.systemId&&t.accountId===r.accountId;
  const p=r.provenance;
  const lineage=object(p)&&keys(p,["file","sheet","row","synthetic"])&&p.synthetic===true&&Number.isSafeInteger(p.row)&&p.row>=1&&p.row<=25&&t&&p.file===t.id+".synthetic"&&p.sheet===(t.format==="XLSX_STYLE"?"Statement":null)&&r.sourceRowId===`${t.id}:${p.row}`;
  const dateBasis=t&&r.canonicalDateBasis===t.dateBasis&&r.canonicalDate===(t.dateBasis==="TRANSACTION_DATE"?r.transactionDate:r.postingDate);
  const dates=day(r.canonicalDate)!==null&&[r.transactionDate,r.postingDate].every(d=>d===null||day(d)!==null)&&[r.canonicalDate,r.transactionDate,r.postingDate].every(d=>d===null||d.startsWith(PERIODS[split]+"-"));
  return [check("SOURCE_IDENTITY",identity?"PASS":"NOT_VERIFIED",...refs),check("SYNTHETIC_PROVENANCE",lineage?"PASS":"NOT_VERIFIED",...refs),
    check("SYNTHETIC_ELIGIBILITY",r.eligibility==="SYNTHETIC_RESEARCH_ELIGIBLE"?"PASS":"NOT_VERIFIED",...refs),
    check("SOURCE_TRANSACTION_ID",r.sourceTransactionId===null||text(r.sourceTransactionId)?"PASS":"NOT_VERIFIED",...refs),
    check("MONETARY_BASIS",t&&t.basis===r.monetaryBasis&&basisValid(r)?"PASS":"NOT_VERIFIED",...refs),
    check("DATE_BASIS",dates&&dateBasis?"PASS":"NOT_VERIFIED",...refs)];
}
/** Independent recomputation: never calls AI02 blockedReason or consumes model features. */
export function financialChecks(b: RecordEvidence,l: RecordEvidence,policy: Policy): Check[] {
  const refs=[b.id,l.id], bd=day(b.canonicalDate),ld=day(l.canonicalDate);
  const amount=positive(b.amount)&&positive(l.amount);
  const currencies=[b.currency,l.currency].every(c=>["MYR","USD"].includes(c));
  const directions=[b.direction,l.direction].every(d=>["INFLOW","OUTFLOW"].includes(d));
  return [check("EXACT_AMOUNT",!amount?"NOT_VERIFIED":equalDecimals(b.amount,l.amount)?"PASS":"FAIL",...refs),
    check("CURRENCY",!currencies?"NOT_VERIFIED":b.currency===l.currency?"PASS":"FAIL",...refs),
    check("DIRECTION",!directions?"NOT_VERIFIED":b.direction===l.direction?"PASS":"FAIL",...refs),
    check("CANONICAL_DATE_WINDOW",bd===null||ld===null?"NOT_VERIFIED":Math.abs(bd-ld)<=policy.maxDays?"PASS":"FAIL",...refs)];
}
