/**
 * Verified facts for grounded Finance Q&A. A fact is computed by deterministic code from one completed
 * processing context and carries the record identifiers it came from. The model may READ facts and refer
 * to them by placeholder; every figure a user sees is rendered from a fact by `formatValue`, never typed
 * by the model.
 */
import { groupDigits } from '../poc-anomalies/format';
import { fromCents } from '../poc-anomalies/source';

export type Value =
    | { kind: 'MONEY'; cents: string; currency: string }
    | { kind: 'COUNT'; n: number }
    | { kind: 'DATE'; iso: string }
    | { kind: 'PERIOD'; ym: string }
    | { kind: 'TEXT'; text: string }
    | { kind: 'PERCENT'; tenths: number };
export type SourceKind = 'BANK_ROW' | 'LEDGER_ROW' | 'RECONCILIATION' | 'ANOMALY' | 'TOTALS' | 'HISTORY' | 'FORECAST';
export type SourceRef = { kind: SourceKind; id: string };
/** `primary` is the field a bare placeholder {F3} renders; other fields are addressed as {F3.field}. */
export type Fact = { id: string; label: string; fields: Record<string, Value>; primary: string; sources: SourceRef[]; query: number };

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const money = (cents: bigint, currency: string): Value => ({ kind: 'MONEY', cents: cents.toString(), currency });
export const count = (n: number): Value => ({ kind: 'COUNT', n });
export const text = (t: string): Value => ({ kind: 'TEXT', text: t });

export function formatValue(v: Value): string {
    switch (v.kind) {
        case 'MONEY': { const s = groupDigits(fromCents(BigInt(v.cents))); return s.startsWith('-') ? `−${v.currency} ${s.slice(1)}` : `${v.currency} ${s}`; }
        case 'COUNT': return String(v.n);
        case 'DATE': { const [y, m, d] = v.iso.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; }
        case 'PERIOD': { const [y, m] = v.ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; }
        case 'TEXT': return v.text;
        case 'PERCENT': return `${(v.tenths / 10).toFixed(1)}%`;
    }
}

/** What the model is shown for each fact: labels and formatted values, never source internals. */
export function modelView(facts: Fact[]) {
    return facts.map(f => ({ id: f.id, label: f.label, primary: f.primary, fields: Object.fromEntries(Object.entries(f.fields).map(([k, v]) => [k, formatValue(v)])) }));
}
