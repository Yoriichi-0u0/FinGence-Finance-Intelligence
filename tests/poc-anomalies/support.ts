import { inflateSync } from 'node:zlib';

export const HEADER = 'TransactionID,BusinessID,BusinessName,Industry,AccountNumber,Currency,TransactionDate,StatementMonth,RawBankDescription,BankDirection,AmountMYR,SignedCashMovementMYR,HFCategoryLabel,BusinessCategoryLabel,BankFormat,Counterparty,Reference,RunningBalanceMYR,OriginalGenerationMethod';
export type Fixture = { id: string; business?: string; date?: string; description?: string; direction?: 'Credit' | 'Debit'; amount?: string; signed?: string; counterparty?: string; reference?: string; category?: string; method?: string };
let sequence = 0;
/** Synthetic fixture rows in the normalized PoC layout. */
export function csv(rows: Fixture[], header = HEADER) {
    const lines = rows.map(r => {
        const direction = r.direction ?? 'Debit', amount = r.amount ?? '100.00', date = r.date ?? '2026-03-05';
        const reference = r.reference ?? `R${String(++sequence).padStart(11, '0')}`;
        const counterparty = r.counterparty ?? 'Borneo Food Distributor';
        return [r.id, r.business ?? 'BUS-T01', 'Synthetic Test Cafe', 'Food & Beverage', '****0000', 'MYR', date, date.slice(0, 7),
            JSON.stringify(r.description ?? `[${direction.toLowerCase()}] ${counterparty} payment`), direction, amount,
            r.signed ?? (direction === 'Credit' ? amount : '-' + amount), r.category ?? 'Groceries', r.category ?? 'Ingredients', 'POS', counterparty, reference, '1000.00', r.method ?? 'synthetic test'].join(',');
    });
    return new TextEncoder().encode([header, ...lines].join('\n'));
}
/** Twenty ordinary debits to one counterparty, around MYR 100. */
export const ordinary = (prefix: string, overrides: Partial<Fixture> = {}) => Array.from({ length: 20 }, (_, i) => ({ id: `${prefix}-${i}`, amount: `${100 + (i % 5)}.00`, date: `2026-03-${String(1 + i).padStart(2, '0')}`, ...overrides }));

/** Text drawn by pdf-lib: inflate content streams and decode hex text operands. */
export function pdfText(bytes: Uint8Array) {
    const raw = Buffer.from(bytes), parts: string[] = [];
    let at = 0;
    while ((at = raw.indexOf('stream', at)) !== -1) {
        let start = at + 6;
        if (raw[start] === 0x0d) start++;
        if (raw[start] === 0x0a) start++;
        const end = raw.indexOf('endstream', start);
        try { parts.push(inflateSync(raw.subarray(start, end)).toString('latin1')); } catch { parts.push(raw.subarray(start, end).toString('latin1')); }
        at = end + 9;
    }
    return parts.join('\n').match(/<([0-9A-Fa-f]+)>\s*Tj/g)?.map(m => Buffer.from(m.slice(1, m.indexOf('>')), 'hex').toString('latin1')).join('\n') ?? '';
}
