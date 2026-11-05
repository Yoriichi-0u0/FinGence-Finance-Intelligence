#!/usr/bin/env node
// Generates the public, fictional FinGence quarter sample in public/demo/quarter/ (deterministic; no private data):
// a three-month SGD bank statement and cash-account ledger for a second fictional business, with timing differences
// that clear across months, plus twelve months of bank history whose last quarter is exactly the statement.
// Usage: node scripts/generate-quarter-documents.mjs [--check]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GENERATOR = 'fingence-quarter-generator-v1';
const OUT = join(process.cwd(), 'public', 'demo', 'quarter');
const BUSINESS = { id: 'DEMO-002', name: 'Straits Demo Bakery (Synthetic)', industry: 'Food & Beverage', account: '****0002' };
const CURRENCY = 'SGD';
const QUARTER = ['2026-01', '2026-02', '2026-03'];
const HISTORY = ['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', ...QUARTER];

function prng(seed) {
    return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const random = prng(20260101);
const between = (lo, hi) => Math.round((lo + random() * (hi - lo)) * 100);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const usedReferences = new Set();
function reference() {
    for (;;) { let r = ''; for (let i = 0; i < 12; i++) r += ALPHABET[Math.floor(random() * ALPHABET.length)]; if (!usedReferences.has(r)) { usedReferences.add(r); return r; } }
}
const money = cents => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
const day = (period, d) => `${period}-${String(d).padStart(2, '0')}`;
const csvCell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
const csv = (header, rows) => [header.join(','), ...rows.map(r => header.map(h => csvCell(r[h])).join(','))].join('\n') + '\n';

const PATTERNS = [
    { counterparty: 'Card Sales Settlement', direction: 'Credit', count: 14, lo: 900, hi: 1600, memo: 'Card terminal settlement', category: 'Sales receipts' },
    { counterparty: 'FoodPanda Payout', direction: 'Credit', count: 5, lo: 500, hi: 900, memo: 'Delivery platform payout', category: 'Sales receipts' },
    { counterparty: 'Marina Office Catering', direction: 'Credit', count: 2, lo: 1200, hi: 2200, memo: 'Catering invoice receipt', category: 'Sales receipts' },
    { counterparty: 'Tiong Flour Mills', direction: 'Debit', count: 6, lo: 300, hi: 700, memo: 'Flour and dry goods', category: 'Ingredients' },
    { counterparty: 'Harbour Dairy Supply', direction: 'Debit', count: 4, lo: 200, hi: 450, memo: 'Dairy purchase', category: 'Ingredients' },
    { counterparty: 'Staff Payroll', direction: 'Debit', count: 1, lo: 7800, hi: 8200, memo: 'Payroll transfer', category: 'Payroll' },
    { counterparty: 'Tanjong Demo Realty', direction: 'Debit', count: 1, lo: 3600, hi: 3600, memo: 'Shop rent', category: 'Rent' },
    { counterparty: 'SP Utilities', direction: 'Debit', count: 1, lo: 380, hi: 520, memo: 'Utilities bill', category: 'Utilities' },
];
function monthRows(period, scale) {
    const rows = [];
    for (const p of PATTERNS) for (let i = 0; i < p.count; i++) {
        const cents = Math.round(between(p.lo, p.hi) * scale);
        rows.push({ date: day(period, 2 + Math.floor(((i + 0.5) / p.count) * 24)), counterparty: p.counterparty, direction: p.direction, cents, memo: p.memo, category: p.category, description: `[${p.direction.toLowerCase()}] ${p.counterparty.toUpperCase()} ${p.memo.toUpperCase()}`, reference: reference() });
    }
    return rows;
}

// ---- The quarter statement: ordinary rows plus documented cases that clear across months ----
const statement = QUARTER.flatMap(period => monthRows(period, 1));
const extra = fields => { const row = { reference: reference(), ...fields }; statement.push(row); return row; };
// Bank charges every month: not in the books (prepared as correcting entries).
for (const period of QUARTER) extra({ date: day(period, 28), counterparty: 'Demo Bank Singapore', direction: 'Debit', cents: 1500, memo: 'Monthly service fee', category: 'Bank charges', description: '[debit] DEMO BANK SINGAPORE MONTHLY SERVICE FEE', ledgerRole: 'none' });
// A January deposit booked on 31 Jan that the bank credits on 2 Feb (deposit in transit, cleared next month).
const inTransitJan = extra({ date: day('2026-02', 2), counterparty: 'Card Sales Settlement', direction: 'Credit', cents: 186040, memo: 'Card terminal settlement', category: 'Sales receipts', description: '[credit] CARD SALES SETTLEMENT CARD TERMINAL SETTLEMENT', ledgerRole: 'posted', ledgerDate: day('2026-01', 31) });
// A cheque written on 24 Feb that the bank pays on 10 Mar (unpresented cheque, cleared next month).
extra({ date: day('2026-03', 10), counterparty: 'Tiong Flour Mills', direction: 'Debit', cents: 52480, memo: 'Cheque 000217 to Tiong Flour Mills', category: 'Ingredients', description: '[debit] CHEQUE 000217 TIONG FLOUR MILLS', ledgerRole: 'posted', ledgerDate: day('2026-02', 24) });
// A payment the bank pays on 27 Feb that the books record on 2 Mar (posted late).
extra({ date: day('2026-02', 27), counterparty: 'Harbour Dairy Supply', direction: 'Debit', cents: 31275, memo: 'Dairy purchase', category: 'Ingredients', description: '[debit] HARBOUR DAIRY SUPPLY DAIRY PURCHASE', ledgerRole: 'posted', ledgerDate: day('2026-03', 2) });
// A January receipt the books record four days later (late match within the month).
extra({ date: day('2026-01', 9), counterparty: 'Marina Office Catering', direction: 'Credit', cents: 164500, memo: 'Catering invoice receipt', category: 'Sales receipts', description: '[credit] MARINA OFFICE CATERING CATERING INVOICE RECEIPT', ledgerRole: 'posted', ledgerDate: day('2026-01', 13) });
// Anomaly candidates: an unusually large flour order the books also recorded, and a payment to an unverified payee they did not.
extra({ date: day('2026-02', 16), counterparty: 'Tiong Flour Mills', direction: 'Debit', cents: 486000, memo: 'Flour and dry goods', category: 'Ingredients', description: '[debit] TIONG FLOUR MILLS BULK ORDER' });
extra({ date: day('2026-03', 19), counterparty: 'Lucky Star Trading', direction: 'Debit', cents: 129900, memo: 'Supplier payment', category: 'Ingredients', description: '[debit] NEW UNVERIFIED VENDOR LUCKY STAR TRADING', ledgerRole: 'none' });
statement.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
statement.forEach((r, i) => { r.id = `BANK-Q1-${String(i + 1).padStart(4, '0')}`; r.sourceId = `DEMO2-${r.date.slice(0, 7).replace('-', '')}-${String(i + 1).padStart(4, '0')}`; });

// ---- General ledger cash account: every ordinary row posted on its bank date, the cases as documented ----
const ledger = [];
for (const r of statement) if (r.ledgerRole !== 'none') ledger.push({ date: r.ledgerDate ?? r.date, reference: r.reference, memo: r.memo, counterparty: r.counterparty, cents: r.direction === 'Credit' ? r.cents : -r.cents, category: r.category });
// End of March: a deposit booked on 31 Mar that is still on its way (open timing difference after the last statement).
ledger.push({ date: day('2026-03', 31), reference: reference(), memo: 'Card terminal settlement in transit', counterparty: 'Card Sales Settlement', cents: 142310, category: 'Sales receipts' });
ledger.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
ledger.forEach((l, i) => { l.id = `GL-Q1-${String(i + 1).padStart(4, '0')}`; });
if (!ledger.some(l => l.reference === inTransitJan.reference && l.date.startsWith('2026-01'))) throw new Error('deposit in transit not posted in January');

// ---- Twelve months of bank history; the quarter is exactly the statement above ----
const history = [];
HISTORY.forEach((period, m) => {
    const rows = QUARTER.includes(period) ? statement.filter(r => r.date.startsWith(period)).map(r => ({ ...r, id: r.sourceId }))
        : monthRows(period, 0.88 + m * 0.01 + (m % 4 === 2 ? 0.04 : 0)).sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference)).map((r, i) => ({ ...r, id: `DEMO2-${period.replace('-', '')}-H${String(i + 1).padStart(3, '0')}` }));
    history.push(...rows);
});

const bankHeader = ['BankTransactionID', 'BusinessID', 'BusinessName', 'AccountNumber', 'Currency', 'ValueDate', 'StatementMonth', 'BankReference', 'BankDescription', 'BankDirection', 'BankAmountMYR', 'SignedCashMovementMYR', 'Counterparty', 'SourceTransactionID'];
const ledgerHeader = ['LedgerEntryID', 'BusinessID', 'PostingDate', 'CashAccount', 'Currency', 'LedgerReference', 'LedgerMemo', 'Counterparty', 'CashAccountDebitMYR', 'CashAccountCreditMYR', 'SignedCashMovementMYR', 'CategoryLabel'];
const historyHeader = ['TransactionID', 'BusinessID', 'BusinessName', 'Industry', 'AccountNumber', 'Currency', 'TransactionDate', 'StatementMonth', 'RawBankDescription', 'BankDirection', 'AmountMYR', 'SignedCashMovementMYR', 'HFCategoryLabel', 'BusinessCategoryLabel', 'BankFormat', 'Counterparty', 'Reference', 'RunningBalanceMYR', 'OriginalGenerationMethod'];
const signed = r => r.direction === 'Credit' ? r.cents : -r.cents;
let balance = 3_200_000;
const files = {
    'demo-bank-statement-2026-q1-sgd.csv': csv(bankHeader, statement.map(r => ({ BankTransactionID: r.id, BusinessID: BUSINESS.id, BusinessName: BUSINESS.name, AccountNumber: BUSINESS.account, Currency: CURRENCY, ValueDate: r.date, StatementMonth: r.date.slice(0, 7), BankReference: r.reference, BankDescription: r.description, BankDirection: r.direction, BankAmountMYR: money(r.cents), SignedCashMovementMYR: money(signed(r)), Counterparty: r.counterparty, SourceTransactionID: r.sourceId }))),
    'demo-general-ledger-2026-q1-sgd.csv': csv(ledgerHeader, ledger.map(l => ({ LedgerEntryID: l.id, BusinessID: BUSINESS.id, PostingDate: l.date, CashAccount: '1000-BANK', Currency: CURRENCY, LedgerReference: l.reference, LedgerMemo: l.memo, Counterparty: l.counterparty, CashAccountDebitMYR: money(Math.max(l.cents, 0)), CashAccountCreditMYR: money(Math.max(-l.cents, 0)), SignedCashMovementMYR: money(l.cents), CategoryLabel: l.category }))),
    'demo-bank-history-2025-04-to-2026-03-sgd.csv': csv(historyHeader, history.map(r => { balance += signed(r); return { TransactionID: r.id, BusinessID: BUSINESS.id, BusinessName: BUSINESS.name, Industry: BUSINESS.industry, AccountNumber: BUSINESS.account, Currency: CURRENCY, TransactionDate: r.date, StatementMonth: r.date.slice(0, 7), RawBankDescription: r.description, BankDirection: r.direction, AmountMYR: money(r.cents), SignedCashMovementMYR: money(signed(r)), HFCategoryLabel: r.category, BusinessCategoryLabel: r.category, BankFormat: 'Demo Bank CSV', Counterparty: r.counterparty, Reference: r.reference, RunningBalanceMYR: money(balance), OriginalGenerationMethod: GENERATOR }; })),
};
const manifest = {
    generator: GENERATOR, origin: 'PUBLIC_FICTIONAL_SYNTHETIC', business: BUSINESS.id, businessName: BUSINESS.name, periods: QUARTER, currency: CURRENCY,
    notice: 'Fictional synthetic documents generated by scripts/generate-quarter-documents.mjs. Not real company, bank or customer data.',
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) }])),
};
const outputs = { ...files, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n' };
if (process.argv.includes('--check')) {
    const stale = Object.entries(outputs).filter(([name, text]) => { try { return readFileSync(join(OUT, name), 'utf8') !== text; } catch { return true; } }).map(([name]) => name);
    if (stale.length) { console.error('Quarter documents are stale:', stale.join(', ')); process.exit(1); }
    console.log('Quarter documents are current.');
} else {
    mkdirSync(OUT, { recursive: true });
    for (const [name, text] of Object.entries(outputs)) writeFileSync(join(OUT, name), text);
    console.log(JSON.stringify(manifest, null, 2));
}
