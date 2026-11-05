import { ArrowDownLeft, ArrowUpRight, CheckCheck, Check, Clock3, Landmark, Percent, Scale, TriangleAlert, Unlink } from 'lucide-react';
import { groupDigits } from '@/lib/poc-anomalies/format';
import type { FinancePoCReconciliationV1 } from '@/lib/poc-anomalies/reconciliation';
import type { BankTotals } from '@/lib/poc-insights/model';

export type KpiSource = {
 currency: string;
 bank: string;
 bankTotals?: BankTotals;
 reconciliation: FinancePoCReconciliationV1 | null;
 anomalies: number;
};
const money = (s: KpiSource, value: string) => `${s.currency === 'MYR' ? 'RM' : s.currency} ${groupDigits(value)}`;
const count = (n: number | undefined) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : null;
const counts = (s: KpiSource) => {
 const r = s.reconciliation;
 if (!r || !Array.isArray(r.results)) return null;
 const exact = count(r.counts.MATCH_EXACT), shifted = count(r.counts.MATCH_DATE_SHIFT);
 return exact === null || shifted === null ? null : { exact, shifted, total: r.results.length, r };
};
const bankTotals = (s: KpiSource) => s.bankTotals?.net === s.bank ? s.bankTotals : null;
type Definition = { id: string; label: string; emptyLabel?: string; detail: string; definition: string; icon: typeof Landmark; read: (s: KpiSource) => string | null };

/** Read-only presentation registry. Scope and verification remain with the existing callers. */
export const KPI_METRICS = [
 { id:'bank-net', label:'Bank net cash movement', emptyLabel:'Bank Net Cash Movement', detail:'Signed movement · selected statement', definition:'Verified signed bank movement for the current selected statement.', icon:ArrowDownLeft, read:s=>money(s,s.bank) },
 { id:'ledger-net', label:'Ledger cash movement', emptyLabel:'Ledger Cash Movement', detail:'Verified cash-account ledger', definition:'The bound reconciliation snapshot’s signed cash-account ledger movement.', icon:Landmark, read:s=>s.reconciliation ? money(s,s.reconciliation.cashMovement.ledger) : null },
 { id:'difference', label:'Signed bank − ledger difference', emptyLabel:'Signed Bank and Ledger Difference', detail:'Signed difference · cause not inferred', definition:'The existing signed bank minus ledger difference. No cause is inferred.', icon:Scale, read:s=>s.reconciliation ? money(s,s.reconciliation.cashMovement.signedDifference) : null },
 { id:'matched', label:'Automatically matched', emptyLabel:'Automatically Matched', detail:'Exact + date shift · reconciliation outcomes', definition:'MATCH_EXACT + MATCH_DATE_SHIFT outcomes / all reconciliation outcomes; not bank rows.', icon:CheckCheck, read:s=>{const c=counts(s);return c ? `${c.exact+c.shifted} / ${c.total}` : null;} },
 { id:'unmatched', label:'Unmatched Transactions', detail:'Bank-only + ledger-only outcomes', definition:'BANK_ONLY + LEDGER_ONLY reconciliation outcomes, not raw rows or all unresolved exceptions.', icon:Unlink, read:s=>{const c=counts(s);return c ? groupDigits(String(c.r.results.filter(r=>r.status==='BANK_ONLY'||r.status==='LEDGER_ONLY').length)) : null;} },
 { id:'exact', label:'Exact Matches', detail:'MATCH_EXACT reconciliation outcomes', definition:'Exact-match outcomes under the existing matcher; grouped ledger records remain one outcome.', icon:Check, read:s=>{const c=counts(s);return c ? groupDigits(String(c.exact)) : null;} },
 { id:'date-shift', label:'Date Shift Matches', detail:'MATCH_DATE_SHIFT reconciliation outcomes', definition:'Date-shift outcomes accepted by the existing matcher, not a new matching rule.', icon:Clock3, read:s=>{const c=counts(s);return c ? groupDigits(String(c.shifted)) : null;} },
 { id:'match-rate', label:'Match Rate', detail:'Exact + date shift / all outcomes', definition:'Matched outcomes divided by all reconciliation outcomes, shown to one decimal. Unavailable with no outcomes.', icon:Percent, read:s=>{const c=counts(s);return c && c.total>0 ? `${((c.exact+c.shifted)/c.total*100).toFixed(1)}%` : null;} },
 { id:'cash-in', label:'Bank Cash In', detail:'Bank credits · selected statement', definition:'Verified incoming bank credit movement for the selected statement, not revenue.', icon:ArrowDownLeft, read:s=>{const t=bankTotals(s);return t ? money(s,t.credits) : null;} },
 { id:'cash-out', label:'Bank Cash Out', detail:'Bank debit magnitude · not expenses', definition:'Magnitude of verified signed bank debit movement for the selected statement, not expenses or profit.', icon:ArrowUpRight, read:s=>{const t=bankTotals(s);return t ? money(s,t.debits.replace(/^-/,'') ) : null;} },
 { id:'anomalies', label:'Anomaly Candidates', detail:'Separate rule findings · may overlap', definition:'Current rule-based anomaly candidate findings; may overlap and are not confirmed fraud or a count of unique transactions.', icon:TriangleAlert, read:s=>count(s.anomalies) === null ? null : groupDigits(String(s.anomalies)) },
] as const satisfies readonly Definition[];
export type KpiId = typeof KPI_METRICS[number]['id'];
export const DEFAULT_KPIS: readonly KpiId[] = ['bank-net','ledger-net','difference','matched'];
export const KPI_STORAGE_KEY = 'fingence.overview.kpi-cards.v1';
export function validKpis(value: unknown): value is KpiId[] {
 return Array.isArray(value) && value.length===4 && new Set(value).size===4 && value.every(id=>KPI_METRICS.some(m=>m.id===id));
}
export function readKpiPreference(raw: string | null): KpiId[] {
 try { const value: unknown=JSON.parse(raw ?? 'null'); if(validKpis(value))return [...value]; } catch {}
 return [...DEFAULT_KPIS];
}
export function moveKpi(ids: readonly KpiId[], index: number, direction: -1 | 1): KpiId[] {
 const next=[...ids], target=index+direction;
 if(index>=0&&index<next.length&&target>=0&&target<next.length)[next[index],next[target]]=[next[target],next[index]];
 return next;
}
