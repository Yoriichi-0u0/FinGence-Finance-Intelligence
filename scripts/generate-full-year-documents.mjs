#!/usr/bin/env node
// Generates the public, fictional FinGence full-year sample in public/demo/full-year/ (deterministic; no private data):
// a twelve-month MYR bank statement and cash-account ledger for a third fictional business (a furniture maker), with
// seasonal sales (before Hari Raya and at year end), a new trade customer from July, an equipment purchase, a year-end
// bonus, timing differences that clear across months, bank charges and interest the books have not recorded, and two
// payments the books do not show. Twenty-four months of bank history end with exactly the statement year, so the
// annual report can be compared with the year before and the forecast has two years to learn from.
// Usage: node scripts/generate-full-year-documents.mjs [--check]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GENERATOR = 'fingence-full-year-generator-v1';
const OUT = join(process.cwd(), 'public', 'demo', 'full-year');
const BUSINESS = { id: 'DEMO-003', name: 'Rimba Demo Furniture (Synthetic)', industry: 'Furniture manufacturing', account: '****0003' };
const CURRENCY = 'MYR';
const months = year => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
const YEAR = months(2025);
const HISTORY = [...months(2024), ...YEAR];

function prng(seed) {
    return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const random = prng(20250101);
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

// Seasonality of retail sales by calendar month: before Hari Raya (late March 2025, mid April 2024) and at year end.
const SEASON = {
    2024: [0.9, 1.0, 1.3, 1.3, 0.8, 0.9, 0.9, 1.0, 1.0, 1.0, 1.2, 1.4],
    2025: [1.0, 1.3, 1.5, 0.8, 0.9, 0.9, 1.0, 1.0, 1.0, 1.1, 1.3, 1.5],
};
// Patterns: `count` per month (seasonal ones scale with SEASON), amounts in MYR between lo and hi.
const PATTERNS = [
    { counterparty: 'Showroom Card Settlement', direction: 'Credit', count: 18, seasonal: true, lo: 1200, hi: 3200, memo: 'Showroom card terminal settlement', category: 'Sales receipts' },
    { counterparty: 'Online Marketplace Payout', direction: 'Credit', count: 6, seasonal: true, lo: 2000, hi: 5000, memo: 'Online marketplace payout', category: 'Sales receipts' },
    { counterparty: 'Mutiara Demo Hotels', direction: 'Credit', count: 2, lo: 12000, hi: 18000, memo: 'Hotel furniture invoice receipt', category: 'Trade receipts' },
    { counterparty: 'Sinar Demo Office Fitouts', direction: 'Credit', count: 2, lo: 8000, hi: 14000, memo: 'Office fit-out invoice receipt', category: 'Trade receipts' },
    { counterparty: 'Lembah Demo Property', direction: 'Credit', count: 2, from: '2025-07', lo: 14000, hi: 20000, memo: 'Show unit furniture invoice receipt', category: 'Trade receipts' },
    { counterparty: 'Kayu Demo Timber Supplies', direction: 'Debit', count: 5, seasonal: true, lo: 4500, hi: 9000, memo: 'Timber and board purchase', category: 'Materials' },
    { counterparty: 'Selangor Demo Hardware', direction: 'Debit', count: 3, lo: 800, hi: 2000, memo: 'Fittings and hardware', category: 'Materials' },
    { counterparty: 'Rapid Demo Logistics', direction: 'Debit', count: 4, seasonal: true, lo: 300, hi: 900, memo: 'Delivery charges', category: 'Delivery' },
    { counterparty: 'Staff Payroll', direction: 'Debit', count: 1, lo: 38000, hi: 40000, memo: 'Monthly payroll transfer', category: 'Payroll' },
    { counterparty: 'EPF SOCSO Contributions', direction: 'Debit', count: 1, lo: 5000, hi: 5300, memo: 'Statutory contributions', category: 'Payroll' },
    { counterparty: 'Shah Alam Demo Industrial Park', direction: 'Debit', count: 1, lo: 9500, hi: 9500, memo: 'Factory rent', category: 'Rent' },
    { counterparty: 'Demo Power Utilities', direction: 'Debit', count: 1, lo: 1800, hi: 3200, memo: 'Electricity and water', category: 'Utilities' },
    { counterparty: 'Demo Bank Equipment Loan', direction: 'Debit', count: 1, lo: 4200, hi: 4200, memo: 'Equipment loan instalment', category: 'Loan repayment' },
];
function monthRows(period, scale = 1) {
    const [year, month] = period.split('-').map(Number), season = SEASON[year][month - 1], rows = [];
    for (const p of PATTERNS) {
        if (p.from && period < p.from) continue;
        const count = p.seasonal ? Math.max(1, Math.round(p.count * season)) : p.count;
        for (let i = 0; i < count; i++) {
            const cents = Math.round(between(p.lo, p.hi) * (p.lo === p.hi ? 1 : scale));
            rows.push({ date: day(period, 2 + Math.floor(((i + 0.5) / count) * 25)), counterparty: p.counterparty, direction: p.direction, cents, memo: p.memo, category: p.category, description: `[${p.direction.toLowerCase()}] ${p.counterparty.toUpperCase()} ${p.memo.toUpperCase()}`, reference: reference() });
        }
    }
    // Sales and Service Tax is paid every second month.
    if (month % 2 === 0) rows.push({ date: day(period, 27), counterparty: 'SST Payment', direction: 'Debit', cents: Math.round(between(6000, 9000) * scale), memo: 'Sales and service tax payment', category: 'Taxes', description: '[debit] SST PAYMENT SALES AND SERVICE TAX', reference: reference() });
    return rows;
}

// ---- The statement year: ordinary rows plus documented cases ----
const statement = YEAR.flatMap(period => monthRows(period));
const extra = fields => { const row = { reference: reference(), ...fields }; statement.push(row); return row; };
// Bank charges every month and interest every quarter: not in the books (prepared as correcting entries).
for (const period of YEAR) extra({ date: day(period, 28), counterparty: 'Demo Bank Malaysia', direction: 'Debit', cents: 2500, memo: 'Monthly account fee', category: 'Bank charges', description: '[debit] DEMO BANK MALAYSIA MONTHLY ACCOUNT FEE', ledgerRole: 'none' });
for (const period of ['2025-03', '2025-06', '2025-09', '2025-12']) extra({ date: day(period, 30), counterparty: 'Demo Bank Malaysia', direction: 'Credit', cents: between(110, 160), memo: 'Interest credited', category: 'Interest income', description: '[credit] DEMO BANK MALAYSIA INTEREST CREDITED', ledgerRole: 'none' });
// Once a year: the business insurance premium, an equipment purchase, a year-end bonus and a customer refund.
extra({ date: day('2025-01', 15), counterparty: 'Perisai Demo Insurance', direction: 'Debit', cents: 1480000, memo: 'Annual business insurance premium', category: 'Insurance', description: '[debit] PERISAI DEMO INSURANCE ANNUAL PREMIUM' });
extra({ date: day('2025-08', 12), counterparty: 'Teknik Demo CNC Machinery', direction: 'Debit', cents: 8600000, memo: 'CNC router purchase', category: 'Equipment', description: '[debit] TEKNIK DEMO CNC MACHINERY ROUTER PURCHASE' });
extra({ date: day('2025-12', 19), counterparty: 'Staff Payroll', direction: 'Debit', cents: 4500000, memo: 'Year-end bonus', category: 'Payroll', description: '[debit] STAFF PAYROLL YEAR-END BONUS' });
extra({ date: day('2025-09', 18), counterparty: 'Sinar Demo Office Fitouts', direction: 'Debit', cents: 240000, memo: 'Refund for returned desks', category: 'Sales refunds', description: '[debit] SINAR DEMO OFFICE FITOUTS REFUND RETURNED DESKS' });
// Deposits booked on the last day of a quarter that the bank credits early the next month (deposit in transit, cleared).
for (const [booked, credited, cents] of [['2025-03-31', '2025-04-02', 214060], ['2025-06-30', '2025-07-01', 187530], ['2025-09-30', '2025-10-02', 162290]])
    extra({ date: credited, counterparty: 'Showroom Card Settlement', direction: 'Credit', cents, memo: 'Showroom card terminal settlement', category: 'Sales receipts', description: '[credit] SHOWROOM CARD SETTLEMENT SHOWROOM CARD TERMINAL SETTLEMENT', ledgerRole: 'posted', ledgerDate: booked });
// Cheques written late in a month that the bank pays the next month (unpresented cheques, cleared).
extra({ date: day('2025-06', 9), counterparty: 'Kayu Demo Timber Supplies', direction: 'Debit', cents: 712400, memo: 'Cheque 004118 to Kayu Demo Timber Supplies', category: 'Materials', description: '[debit] CHEQUE 004118 KAYU DEMO TIMBER SUPPLIES', ledgerRole: 'posted', ledgerDate: day('2025-05', 26) });
extra({ date: day('2025-12', 5), counterparty: 'Kayu Demo Timber Supplies', direction: 'Debit', cents: 658800, memo: 'Cheque 004163 to Kayu Demo Timber Supplies', category: 'Materials', description: '[debit] CHEQUE 004163 KAYU DEMO TIMBER SUPPLIES', ledgerRole: 'posted', ledgerDate: day('2025-11', 24) });
// A payment the bank makes on 27 Feb that the books record on 3 Mar (posted late), and a receipt booked four days late.
extra({ date: day('2025-02', 27), counterparty: 'Rapid Demo Logistics', direction: 'Debit', cents: 68450, memo: 'Delivery charges', category: 'Delivery', description: '[debit] RAPID DEMO LOGISTICS DELIVERY CHARGES', ledgerRole: 'posted', ledgerDate: day('2025-03', 3) });
extra({ date: day('2025-04', 10), counterparty: 'Mutiara Demo Hotels', direction: 'Credit', cents: 1386000, memo: 'Hotel furniture invoice receipt', category: 'Trade receipts', description: '[credit] MUTIARA DEMO HOTELS HOTEL FURNITURE INVOICE RECEIPT', ledgerRole: 'posted', ledgerDate: day('2025-04', 14) });
// Two payments the books do not show: a supplier invoice paid a second time the next day, and a payment to an unverified payee.
extra({ date: day('2025-05', 13), counterparty: 'Selangor Demo Hardware', direction: 'Debit', cents: 168420, memo: 'Fittings and hardware', category: 'Materials', description: '[debit] SELANGOR DEMO HARDWARE FITTINGS AND HARDWARE' });
extra({ date: day('2025-05', 14), counterparty: 'Selangor Demo Hardware', direction: 'Debit', cents: 168420, memo: 'Fittings and hardware', category: 'Materials', description: '[debit] SELANGOR DEMO HARDWARE FITTINGS AND HARDWARE', ledgerRole: 'none' });
extra({ date: day('2025-10', 21), counterparty: 'Kilat Demo Trading', direction: 'Debit', cents: 745000, memo: 'Supplier payment', category: 'Materials', description: '[debit] NEW UNVERIFIED VENDOR KILAT DEMO TRADING', ledgerRole: 'none' });
statement.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference) || (a.ledgerRole === 'none') - (b.ledgerRole === 'none'));
statement.forEach((r, i) => { r.id = `BANK-FY-${String(i + 1).padStart(4, '0')}`; r.sourceId = `DEMO3-${r.date.slice(0, 7).replace('-', '')}-${String(i + 1).padStart(4, '0')}`; });

// ---- General ledger cash account: every ordinary row posted on its bank date, the cases as documented ----
const ledger = [];
for (const r of statement) if (r.ledgerRole !== 'none') ledger.push({ date: r.ledgerDate ?? r.date, reference: r.reference, memo: r.memo, counterparty: r.counterparty, cents: r.direction === 'Credit' ? r.cents : -r.cents, category: r.category });
// End of year: a deposit booked on 31 Dec still on its way and a cheque written on 29 Dec not yet presented (open).
ledger.push({ date: day('2025-12', 31), reference: reference(), memo: 'Showroom card settlement in transit', counterparty: 'Showroom Card Settlement', cents: 236480, category: 'Sales receipts' });
ledger.push({ date: day('2025-12', 29), reference: reference(), memo: 'Cheque 004177 to Selangor Demo Hardware', counterparty: 'Selangor Demo Hardware', cents: -142500, category: 'Materials' });
ledger.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
ledger.forEach((l, i) => { l.id = `GL-FY-${String(i + 1).padStart(4, '0')}`; });

// ---- Twenty-four months of bank history; the last twelve are exactly the statement above ----
const history = [];
HISTORY.forEach((period, m) => {
    const rows = YEAR.includes(period) ? statement.filter(r => r.date.startsWith(period)).map(r => ({ ...r, id: r.sourceId }))
        : monthRows(period, 0.86 + m * 0.005).sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference)).map((r, i) => ({ ...r, id: `DEMO3-${period.replace('-', '')}-H${String(i + 1).padStart(3, '0')}` }));
    history.push(...rows);
});

const bankHeader = ['BankTransactionID', 'BusinessID', 'BusinessName', 'AccountNumber', 'Currency', 'ValueDate', 'StatementMonth', 'BankReference', 'BankDescription', 'BankDirection', 'BankAmountMYR', 'SignedCashMovementMYR', 'Counterparty', 'SourceTransactionID'];
const ledgerHeader = ['LedgerEntryID', 'BusinessID', 'PostingDate', 'CashAccount', 'Currency', 'LedgerReference', 'LedgerMemo', 'Counterparty', 'CashAccountDebitMYR', 'CashAccountCreditMYR', 'SignedCashMovementMYR', 'CategoryLabel'];
const historyHeader = ['TransactionID', 'BusinessID', 'BusinessName', 'Industry', 'AccountNumber', 'Currency', 'TransactionDate', 'StatementMonth', 'RawBankDescription', 'BankDirection', 'AmountMYR', 'SignedCashMovementMYR', 'HFCategoryLabel', 'BusinessCategoryLabel', 'BankFormat', 'Counterparty', 'Reference', 'RunningBalanceMYR', 'OriginalGenerationMethod'];
const signed = r => r.direction === 'Credit' ? r.cents : -r.cents;
let balance = 18_500_000;
const files = {
    'demo-bank-statement-2025-fy-myr.csv': csv(bankHeader, statement.map(r => ({ BankTransactionID: r.id, BusinessID: BUSINESS.id, BusinessName: BUSINESS.name, AccountNumber: BUSINESS.account, Currency: CURRENCY, ValueDate: r.date, StatementMonth: r.date.slice(0, 7), BankReference: r.reference, BankDescription: r.description, BankDirection: r.direction, BankAmountMYR: money(r.cents), SignedCashMovementMYR: money(signed(r)), Counterparty: r.counterparty, SourceTransactionID: r.sourceId }))),
    'demo-general-ledger-2025-fy-myr.csv': csv(ledgerHeader, ledger.map(l => ({ LedgerEntryID: l.id, BusinessID: BUSINESS.id, PostingDate: l.date, CashAccount: '1000-BANK', Currency: CURRENCY, LedgerReference: l.reference, LedgerMemo: l.memo, Counterparty: l.counterparty, CashAccountDebitMYR: money(Math.max(l.cents, 0)), CashAccountCreditMYR: money(Math.max(-l.cents, 0)), SignedCashMovementMYR: money(l.cents), CategoryLabel: l.category }))),
    'demo-bank-history-2024-01-to-2025-12-myr.csv': csv(historyHeader, history.map(r => { balance += signed(r); return { TransactionID: r.id, BusinessID: BUSINESS.id, BusinessName: BUSINESS.name, Industry: BUSINESS.industry, AccountNumber: BUSINESS.account, Currency: CURRENCY, TransactionDate: r.date, StatementMonth: r.date.slice(0, 7), RawBankDescription: r.description, BankDirection: r.direction, AmountMYR: money(r.cents), SignedCashMovementMYR: money(signed(r)), HFCategoryLabel: r.category, BusinessCategoryLabel: r.category, BankFormat: 'Demo Bank CSV', Counterparty: r.counterparty, Reference: r.reference, RunningBalanceMYR: money(balance), OriginalGenerationMethod: GENERATOR }; })),
};
if (balance <= 0) throw new Error('history balance went negative');
const manifest = {
    generator: GENERATOR, origin: 'PUBLIC_FICTIONAL_SYNTHETIC', business: BUSINESS.id, businessName: BUSINESS.name, periods: YEAR, currency: CURRENCY,
    notice: 'Fictional synthetic documents generated by scripts/generate-full-year-documents.mjs. Not real company, bank or customer data.',
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) }])),
};
const outputs = { ...files, 'manifest.json': JSON.stringify(manifest, null, 2) + '\n' };
if (process.argv.includes('--check')) {
    const stale = Object.entries(outputs).filter(([name, text]) => { try { return readFileSync(join(OUT, name), 'utf8') !== text; } catch { return true; } }).map(([name]) => name);
    if (stale.length) { console.error('Full-year documents are stale:', stale.join(', ')); process.exit(1); }
    console.log('Full-year documents are current.');
} else {
    mkdirSync(OUT, { recursive: true });
    for (const [name, text] of Object.entries(outputs)) writeFileSync(join(OUT, name), text);
    console.log(JSON.stringify(manifest, null, 2));
}
