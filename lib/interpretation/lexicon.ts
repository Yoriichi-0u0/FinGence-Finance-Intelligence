/**
 * Small bilingual (English/Malay) heading and direction-token vocabulary. It is an INDEPENDENT check
 * on a model's sign-critical mappings, never a parser: a heading either agrees with the proposed
 * meaning, contradicts it (it names the opposite side) or is opaque and needs arithmetic confirmation.
 */
export type Meaning = 'IN' | 'OUT' | 'DEBIT' | 'CREDIT' | 'BALANCE' | 'DATE' | 'DIRECTION';
const VOCABULARY: Record<Meaning, string[]> = {
    // Bank statements are written from the account holder's view: credit/deposit = cash in.
    IN: ['credit', 'credits', 'deposit', 'deposits', 'money in', 'paid in', 'receipt', 'receipts', 'inflow', 'cr', 'kredit', 'simpanan', 'masuk', 'wang masuk'],
    OUT: ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'paid out', 'payment', 'payments', 'outflow', 'dr', 'pengeluaran', 'keluar', 'wang keluar'],
    // A cash-account ledger: debit increases cash, credit decreases it.
    DEBIT: ['debit', 'debits', 'dr', 'debit amount'],
    CREDIT: ['credit', 'credits', 'cr', 'credit amount', 'kredit'],
    BALANCE: ['balance', 'running balance', 'running bal', 'bal', 'closing balance', 'ledger balance', 'available balance', 'baki'],
    DATE: ['date', 'txn date', 'transaction date', 'value date', 'posting date', 'journal date', 'entry date', 'tarikh', 'tarikh transaksi'],
    DIRECTION: ['dr cr', 'cr dr', 'dr/cr', 'debit credit', 'type', 'direction', 'd c', 'jenis', 'in out'],
};
const OPPOSITE: Partial<Record<Meaning, Meaning>> = { IN: 'OUT', OUT: 'IN', DEBIT: 'CREDIT', CREDIT: 'DEBIT' };
const words = (text: string) => ` ${text.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z/]+/g, ' ').replace(/\//g, ' ').replace(/\s+/g, ' ').trim()} `;
const mentions = (heading: string, meaning: Meaning) => VOCABULARY[meaning].some(term => words(heading).includes(` ${words(term).trim()} `));

export type Agreement = 'AGREES' | 'CONTRADICTS' | 'OPAQUE';
/** Compares a heading with the meaning a proposal assigned to its column. */
export function headingAgreement(heading: string, meaning: Meaning): Agreement {
    const opposite = OPPOSITE[meaning];
    const own = mentions(heading, meaning), other = opposite ? mentions(heading, opposite) : false;
    if (own && !other) return 'AGREES';
    if (other && !own) return 'CONTRADICTS';
    return 'OPAQUE';
}

const TOKENS: Record<'IN' | 'OUT', string[]> = {
    IN: ['CR', 'C', 'CREDIT', 'IN', 'DEPOSIT', 'KREDIT', '+'],
    OUT: ['DR', 'D', 'DEBIT', 'OUT', 'WITHDRAWAL', 'DEBIT', '-'],
};
/** For a bank statement inflow = CR; in a cash-account ledger inflow (cash increase) = DR. */
export function tokenAgreement(tokens: string[], side: 'IN' | 'OUT', ledger: boolean): Agreement {
    const expected = ledger ? (side === 'IN' ? 'OUT' : 'IN') : side, opposite = expected === 'IN' ? 'OUT' : 'IN';
    const norm = tokens.map(t => t.trim().toUpperCase());
    if (norm.length && norm.every(t => TOKENS[expected].includes(t))) return 'AGREES';
    if (norm.some(t => TOKENS[opposite].includes(t))) return 'CONTRADICTS';
    return 'OPAQUE';
}
