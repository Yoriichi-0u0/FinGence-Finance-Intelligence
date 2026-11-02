/**
 * Small bilingual (English/Malay) heading and direction-token vocabulary. It is an INDEPENDENT check
 * on a model's sign-critical mappings, never a parser: a heading either agrees with the proposed
 * meaning, contradicts it (it names the opposite side) or is opaque and needs arithmetic confirmation.
 */
export type Meaning = 'IN' | 'OUT' | 'DEBIT' | 'CREDIT' | 'BALANCE' | 'DATE' | 'DIRECTION' | 'SIGNED';
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
    // A single signed column whose heading itself states the cash convention (+ = cash in). Plain "Amount" does not.
    SIGNED: ['net cash movement', 'signed cash movement', 'cash movement', 'net movement', 'signed amount', 'pergerakan tunai', 'pergerakan bersih'],
};
const OPPOSITE: Partial<Record<Meaning, Meaning>> = { IN: 'OUT', OUT: 'IN', DEBIT: 'CREDIT', CREDIT: 'DEBIT' };
const words = (text: string) => ` ${text.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z/]+/g, ' ').replace(/\//g, ' ').replace(/\s+/g, ' ').trim()} `;
const mentions = (heading: string, meaning: Meaning) => VOCABULARY[meaning].some(term => words(heading).includes(` ${words(term).trim()} `));

export type Agreement = 'AGREES' | 'CONTRADICTS' | 'OPAQUE';
/** A signed column agrees only when its heading states a signed cash movement; a one-sided heading contradicts it. */
export function signedAgreement(heading: string): Agreement {
    if ((['IN', 'OUT', 'DEBIT', 'CREDIT'] as Meaning[]).some(m => mentions(heading, m))) return 'CONTRADICTS';
    return mentions(heading, 'SIGNED') ? 'AGREES' : 'OPAQUE';
}
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

const has = (text: string, terms: string[]) => terms.some(term => words(text).includes(` ${words(term).trim()} `));
const ROLE: Record<'BANK_STATEMENT' | 'GENERAL_LEDGER', string[]> = {
    BANK_STATEMENT: ['statement', 'bank statement', 'account statement', 'penyata', 'withdrawal', 'withdrawals', 'deposit', 'deposits', 'opening balance', 'closing balance', 'account holder', 'pemegang akaun', 'cheque'],
    GENERAL_LEDGER: ['ledger', 'general ledger', 'gl', 'journal', 'lejar', 'jurnal', 'voucher', 'nominal'],
};
/**
 * Whose books a document is decides what Debit, Credit, DR and CR mean, so the model's role is checked against
 * the document's own words (preamble, headings, file name; never transaction cells). Both or neither is OPAQUE.
 */
export function roleAgreement(text: string, role: 'BANK_STATEMENT' | 'GENERAL_LEDGER'): Agreement {
    const own = has(text, ROLE[role]), other = has(text, ROLE[role === 'BANK_STATEMENT' ? 'GENERAL_LEDGER' : 'BANK_STATEMENT']);
    return own && !other ? 'AGREES' : other && !own ? 'CONTRADICTS' : 'OPAQUE';
}
const CASH = ['cash', 'bank', 'tunai', 'current account', 'savings account', 'akaun semasa', 'petty cash'];
const NON_CASH = ['sales', 'revenue', 'income', 'expense', 'expenses', 'purchases', 'payable', 'payables', 'receivable', 'receivables', 'loan', 'pinjaman', 'inventory', 'stock', 'capital', 'equity', 'jualan', 'belanja', 'hutang', 'depreciation', 'accrual', 'accruals', 'suspense'];
/** Whether an account name is a cash or bank account. Any non-cash term contradicts, even beside "bank" ("bank loan"). */
export function cashAccountAgreement(text: string): Agreement {
    return has(text, NON_CASH) ? 'CONTRADICTS' : has(text, CASH) ? 'AGREES' : 'OPAQUE';
}
