#!/usr/bin/env node
// Generates the public, fictional FinGence demo documents in public/demo/ (deterministic; no private data).
// Usage: node scripts/generate-demo-documents.mjs [--check]
// --check regenerates in memory and fails if the committed files differ.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GENERATOR = 'fingence-demo-generator-v1';
const OUT = join(process.cwd(), 'public', 'demo');
const BUSINESS = { id: 'DEMO-001', name: 'Rimba Demo Kitchen (Synthetic)', industry: 'Food & Beverage', account: '****0000' };
const PERIOD = '2026-03';
const HISTORY = ['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'];

/** mulberry32: small deterministic PRNG so the files are byte-identical on every run. */
function prng(seed) {
    return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const random = prng(20260301);
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

/** Recurring cash patterns. Descriptions always name the counterparty unless a row deliberately does not. */
const PATTERNS = [
    { counterparty: 'POS Sales Settlement', direction: 'Credit', count: 20, lo: 1800, hi: 3200, memo: 'Daily POS settlement', category: 'Sales receipts' },
    { counterparty: 'GrabFood Marketplace Payout', direction: 'Credit', count: 8, lo: 900, hi: 1600, memo: 'Marketplace payout', category: 'Sales receipts' },
    { counterparty: 'Hartanah Events Catering', direction: 'Credit', count: 3, lo: 2500, hi: 4000, memo: 'Catering invoice receipt', category: 'Sales receipts' },
    { counterparty: 'Borneo Fresh Supplies', direction: 'Debit', count: 10, lo: 400, hi: 900, memo: 'Ingredient purchase', category: 'Ingredients' },
    { counterparty: 'Kuching Packaging Supply', direction: 'Debit', count: 6, lo: 150, hi: 300, memo: 'Packaging purchase', category: 'Packaging' },
    { counterparty: 'Staff Payroll', direction: 'Debit', count: 2, lo: 9000, hi: 9600, memo: 'Payroll transfer', category: 'Payroll' },
    { counterparty: 'Jalan Demo Properties', direction: 'Debit', count: 1, lo: 4200, hi: 4200, memo: 'Shoplot rent', category: 'Rent' },
    { counterparty: 'Sarawak Energy', direction: 'Debit', count: 1, lo: 600, hi: 760, memo: 'Electricity bill', category: 'Utilities' },
];

function monthRows(period, scale) {
    const rows = [];
    for (const p of PATTERNS) for (let i = 0; i < p.count; i++) {
        const cents = Math.round(between(p.lo, p.hi) * scale);
        rows.push({ date: day(period, 1 + Math.floor(((i + 0.5) / p.count) * 27)), counterparty: p.counterparty, direction: p.direction, cents, memo: p.memo, category: p.category, description: `[${p.direction.toLowerCase()}] ${p.counterparty.toUpperCase()} ${p.memo.toUpperCase()}`, reference: reference() });
    }
    return rows;
}

// ---- March 2026 statement: ordinary rows plus deliberate, documented review cases ----
const march = monthRows(PERIOD, 1);
const extra = (fields) => { const row = { reference: reference(), ...fields }; march.push(row); return row; };
// Anomaly candidates (detector rules, not fraud): an outlier supplier amount, an unverified payee, a description that omits the counterparty.
extra({ date: day(PERIOD, 18), counterparty: 'Borneo Fresh Supplies', direction: 'Debit', cents: 685000, memo: 'Ingredient purchase', category: 'Ingredients', description: '[debit] BORNEO FRESH SUPPLIES BULK ORDER' });
extra({ date: day(PERIOD, 21), counterparty: 'Ace Niaga Trading', direction: 'Debit', cents: 248000, memo: 'Supplier payment', category: 'Ingredients', description: '[debit] NEW UNVERIFIED VENDOR ACE NIAGA TRADING' });
extra({ date: day(PERIOD, 24), counterparty: 'Kuching Packaging Supply', direction: 'Debit', cents: 21450, memo: 'Packaging purchase', category: 'Packaging', description: '[debit] OFFICE STATIONERY ORDER' });
// Bank-only: bank charges and a payout not yet booked in the ledger.
const bankOnly = [
    extra({ date: day(PERIOD, 31), counterparty: 'Demo Bank Berhad', direction: 'Debit', cents: 1850, memo: 'Monthly account fee', category: 'Bank charges', description: '[debit] DEMO BANK BERHAD MONTHLY ACCOUNT FEE' }),
    extra({ date: day(PERIOD, 15), counterparty: 'Demo Bank Berhad', direction: 'Debit', cents: 735, memo: 'IBG transfer charge', category: 'Bank charges', description: '[debit] DEMO BANK BERHAD IBG CHARGE' }),
    extra({ date: day(PERIOD, 30), counterparty: 'GrabFood Marketplace Payout', direction: 'Credit', cents: 131977, memo: 'Marketplace payout', category: 'Sales receipts', description: '[credit] GRABFOOD MARKETPLACE PAYOUT' }),
];
march.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
march.forEach((r, i) => { r.id = `BANK-DEMO-${String(i + 1).padStart(4, '0')}`; r.sourceId = `DEMO-${PERIOD.replace('-', '')}-${String(i + 1).padStart(4, '0')}`; });

// ---- General ledger cash account, derived from the statement with deliberate differences ----
const pick = (predicate, n) => march.filter(r => !r.ledgerRole && predicate(r)).slice(0, n);
for (const r of bankOnly) r.ledgerRole = 'none';
for (const r of pick(r => Number(r.date.slice(8)) <= 26 && r.counterparty === 'POS Sales Settlement', 3)) r.ledgerRole = 'shift2';
for (const r of pick(r => Number(r.date.slice(8)) <= 27 && r.counterparty === 'Borneo Fresh Supplies' && r.cents < 100000, 1)) r.ledgerRole = 'shift1';
for (const r of pick(r => r.counterparty === 'Kuching Packaging Supply' && r.description.includes('PACKAGING'), 2)) r.ledgerRole = 'amount';
for (const r of pick(r => r.counterparty === 'Hartanah Events Catering', 1)) r.ledgerRole = 'duplicate';
for (const r of pick(r => r.counterparty === 'GrabFood Marketplace Payout', 1)) r.ledgerRole = 'reference';
const ledger = [];
const post = (r, fields = {}) => ledger.push({ date: r.date, reference: r.reference, memo: r.memo, counterparty: r.counterparty, cents: r.direction === 'Credit' ? r.cents : -r.cents, category: r.category, ...fields });
const shift = (date, n) => day(PERIOD, Number(date.slice(8)) + n);
for (const r of march) {
    switch (r.ledgerRole) {
        case 'none': break;
        case 'shift2': post(r, { date: shift(r.date, 2) }); break;
        case 'shift1': post(r, { date: shift(r.date, 1) }); break;
        // Transposed digits in the posted amount: reference agrees, cents differ.
        case 'amount': { const s = money(r.cents).replace('.', ''); const t = s.length > 2 ? s.slice(0, -3) + s.at(-2) + s.at(-3) + s.at(-1) : s; post(r, { cents: -(Number(t) === r.cents ? r.cents + 900 : Number(t)) }); break; }
        // The same receipt posted twice under one reference: ambiguous, never auto-cleared.
        case 'duplicate': post(r); post(r, { memo: `${r.memo} (duplicate posting)` }); break;
        // Same date and amount, mistyped reference: a reference-review candidate, not an automatic match.
        case 'reference': post(r, { reference: reference() }); break;
        default: post(r);
    }
}
// Ledger-only: an unpresented cheque and a deposit in transit.
ledger.push({ date: day(PERIOD, 29), reference: reference(), memo: 'Cheque 000431 to Borneo Fresh Supplies (unpresented)', counterparty: 'Borneo Fresh Supplies', cents: -73320, category: 'Ingredients' });
ledger.push({ date: day(PERIOD, 31), reference: reference(), memo: 'Cash deposit in transit', counterparty: 'POS Sales Settlement', cents: 214560, category: 'Sales receipts' });
ledger.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
ledger.forEach((l, i) => { l.id = `GL-DEMO-${String(i + 1).padStart(4, '0')}`; });

// ---- Twelve months of bank transaction history; March is exactly the statement above ----
const history = [];
HISTORY.forEach((period, m) => {
    const rows = period === PERIOD ? march.map(r => ({ ...r, id: r.sourceId })) : monthRows(period, 0.86 + m * 0.012 + (m % 3 === 1 ? 0.03 : 0)).sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference)).map((r, i) => ({ ...r, id: `DEMO-${period.replace('-', '')}-${String(i + 1).padStart(4, '0')}` }));
    history.push(...rows);
});

const bankHeader = ['BankTransactionID', 'BusinessID', 'BusinessName', 'AccountNumber', 'Currency', 'ValueDate', 'StatementMonth', 'BankReference', 'BankDescription', 'BankDirection', 'BankAmountMYR', 'SignedCashMovementMYR', 'Counterparty', 'SourceTransactionID'];
const ledgerHeader = ['LedgerEntryID', 'BusinessID', 'PostingDate', 'CashAccount', 'Currency', 'LedgerReference', 'LedgerMemo', 'Counterparty', 'CashAccountDebitMYR', 'CashAccountCreditMYR', 'SignedCashMovementMYR', 'CategoryLabel'];
const historyHeader = ['TransactionID', 'BusinessID', 'BusinessName', 'Industry', 'AccountNumber', 'Currency', 'TransactionDate', 'StatementMonth', 'RawBankDescription', 'BankDirection', 'AmountMYR', 'SignedCashMovementMYR', 'HFCategoryLabel', 'BusinessCategoryLabel', 'BankFormat', 'Counterparty', 'Reference', 'RunningBalanceMYR', 'OriginalGenerationMethod'];
const signed = r => r.direction === 'Credit' ? r.cents : -r.cents;
let balance = 4_500_000;
const files = {
    'demo-bank-statement-2026-03.csv': csv(bankHeader, march.map(r => ({ BankTransactionID: r.id, BusinessID: BUSINESS.id, BusinessName: BUSINESS.name, AccountNumber: BUSINESS.account, Currency: 'MYR', ValueDate: r.date, StatementMonth: PERIOD, BankReference: r.reference, BankDescription: r.description, BankDirection: r.direction, BankAmountMYR: money(r.cents), SignedCashMovementMYR: money(signed(r)), Counterparty: r.counterparty, SourceTransactionID: r.sourceId }))),
    'demo-general-ledger-2026-03.csv': csv(ledgerHeader, ledger.map(l => ({ LedgerEntryID: l.id, BusinessID: BUSINESS.id, PostingDate: l.date, CashAccount: '1000-BANK', Currency: 'MYR', LedgerReference: l.reference, LedgerMemo: l.memo, Counterparty: l.counterparty, CashAccountDebitMYR: money(Math.max(l.cents, 0)), CashAccountCreditMYR: money(Math.max(-l.cents, 0)), SignedCashMovementMYR: money(l.cents), CategoryLabel: l.category }))),
    'demo-bank-history-2025-04-to-2026-03.csv': csv(historyHeader, history.map(r => { balance += signed(r); return { TransactionID: r.id, BusinessID: BUSINESS.id, BusinessName: BUSINESS.name, Industry: BUSINESS.industry, AccountNumber: BUSINESS.account, Currency: 'MYR', TransactionDate: r.date, StatementMonth: r.date.slice(0, 7), RawBankDescription: r.description, BankDirection: r.direction, AmountMYR: money(r.cents), SignedCashMovementMYR: money(signed(r)), HFCategoryLabel: r.category, BusinessCategoryLabel: r.category, BankFormat: 'Demo Bank CSV', Counterparty: r.counterparty, Reference: r.reference, RunningBalanceMYR: money(balance), OriginalGenerationMethod: GENERATOR }; })),
};
const manifest = {
    generator: GENERATOR, origin: 'PUBLIC_FICTIONAL_SYNTHETIC', business: BUSINESS.id, businessName: BUSINESS.name, period: PERIOD, currency: 'MYR',
    notice: 'Fictional synthetic documents generated by scripts/generate-demo-documents.mjs. Not real company, bank or customer data.',
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) }])),
};
const outputs = { ...files, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n' };
if (process.argv.includes('--check')) {
    const stale = Object.entries(outputs).filter(([name, text]) => { try { return readFileSync(join(OUT, name), 'utf8') !== text; } catch { return true; } }).map(([name]) => name);
    if (stale.length) { console.error('Demo documents are stale:', stale.join(', ')); process.exit(1); }
    console.log('Demo documents are current.');
} else {
    mkdirSync(OUT, { recursive: true });
    for (const [name, text] of Object.entries(outputs)) writeFileSync(join(OUT, name), text);
    console.log(JSON.stringify(manifest, null, 2));
}
