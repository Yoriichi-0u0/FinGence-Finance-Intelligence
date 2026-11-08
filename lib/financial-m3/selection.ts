import { principalScope, type M2ClientPrincipal, type PendingStorage } from '../ai-ingestion/m2-client-state';
export interface FinancialSelection {
    attemptId: string;
    warningPolicy: 'include' | 'exclude';
}
const key = (p: M2ClientPrincipal) => 'fingence-m3-selection-v1:' + principalScope(p);
export function validSelection(value: unknown): value is FinancialSelection {
    if (!value || typeof value !== 'object')
        return false;
    const s = value as FinancialSelection;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.attemptId) && ['include', 'exclude'].includes(s.warningPolicy);
}
export function readSelection(storage: PendingStorage, p: M2ClientPrincipal): FinancialSelection | null { try {
    const s = JSON.parse(storage.getItem(key(p)) ?? 'null');
    return validSelection(s) ? s : null;
}
catch {
    return null;
} }
export function saveSelection(storage: PendingStorage, p: M2ClientPrincipal, selection: FinancialSelection) { if (!validSelection(selection))
    throw new Error('INVALID_SELECTION'); storage.setItem(key(p), JSON.stringify(selection)); }
/** Dimensionless BigInt ratio for pixels; never converts financial amounts to binary floats. */
export function plotRatios(amounts: readonly string[]): number[] {
    if (!amounts.length)
        return [];
    if (amounts.some(v => !/^[-]?\d+(?:\.\d+)?$/.test(v) || v.length > 200))
        throw new Error('UNPLOTTABLE');
    const scale = Math.max(...amounts.map(v => v.split('.')[1]?.length ?? 0));
    const values = amounts.map(v => { const negative = v.startsWith('-'), [whole, fraction = ''] = (negative ? v.slice(1) : v).split('.'); return BigInt(whole + fraction.padEnd(scale, '0')) * (negative ? -1n : 1n); });
    const max = values.reduce((a, v) => { const n = v < 0n ? -v : v; return n > a ? n : a; }, 0n);
    return values.map(v => max === 0n ? 0 : Number(v * 100000n / max) / 100000);
}

/** UI-only question generation. Complements, never substitutes for, dataset/auth fencing. */
export class QuestionRequestFence {
    private generation = 0;
    invalidate() { this.generation++; }
    begin() { return ++this.generation; }
    accepts(ticket: number) { return ticket === this.generation; }
}
