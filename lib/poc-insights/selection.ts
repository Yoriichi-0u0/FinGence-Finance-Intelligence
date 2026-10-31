import type { M2ClientPrincipal, PendingStorage } from '../ai-ingestion/m2-client-state';
export type PocSelection = { source: string; business?: string; period?: string; currency?: string };
const key = (p: M2ClientPrincipal) => 'fingence-poc-source-v1:' + JSON.stringify([p.userId, p.organizationId, p.role, p.membershipVersion]);
function validate(value: unknown): PocSelection {
    const v = value as PocSelection;
    if (!v || typeof v !== 'object' || !/^[0-9a-f-]{36}$/.test(v.source)
        || (v.business !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(v.business))
        || (v.period !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.period))
        || (v.currency !== undefined && !/^[A-Z]{3}$/.test(v.currency))) throw Error('INVALID_SELECTION');
    return { source: v.source, ...(v.business ? { business: v.business } : {}), ...(v.period ? { period: v.period } : {}), ...(v.currency ? { currency: v.currency } : {}) };
}
/** Non-sensitive UI preference only: never a session, authorization grant or financial result cache. */
export function readSelection(storage: PendingStorage, principal: M2ClientPrincipal, search: string): PocSelection | null {
    const q = new URLSearchParams(search);
    if (q.has('source')) return validate(Object.fromEntries(['source', 'business', 'period', 'currency'].filter(k => q.has(k)).map(k => [k, q.get(k)])));
    try { const raw = storage.getItem(key(principal)); return raw ? validate(JSON.parse(raw)) : null; } catch { return null; }
}
export function rememberSelection(storage: PendingStorage, principal: M2ClientPrincipal, selection: PocSelection): boolean {
    try { storage.setItem(key(principal), JSON.stringify(validate(selection))); return true; } catch { return false; }
}
export function forgetSelection(storage: PendingStorage, principal: M2ClientPrincipal | null) {
    if (principal) try { storage.removeItem(key(principal)); } catch { /* Only a disposable preference; server access remains authoritative. */ }
}
