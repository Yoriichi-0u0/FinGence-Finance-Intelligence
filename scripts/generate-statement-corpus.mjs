#!/usr/bin/env node
// FinGence ingestion benchmark corpus: fictional bank statements and cash-account ledgers in many layouts (English
// and Malay headings, date and number formats, column orders, split / signed / DR-CR amounts, MYR, SGD, USD and INR,
// one to three months, long wrapped descriptions, a watermark), each written as CSV, XLSX, a text PDF (printed by
// Chrome, headings repeated on every page) and, for some, a scanned PDF and a JPEG. Every document has exact ground
// truth ({date, signed cents} per transaction) and arithmetic that holds. All names are fictional; seeded, so the
// transactions are reproducible (Chrome-rendered bytes depend on the browser build).
// Usage: CHROME=/path/to/chrome node scripts/generate-statement-corpus.mjs [outDir=.local/benchmark/corpus] [--held-out]
// --held-out writes the HELD-OUT set instead (default outDir .local/benchmark/heldout): eight further layouts, written
// for the evaluation and never used while FinGence was developed or tuned, with their own seeds. They add headings in
// German and Indonesian, dot-grouped numbers, THB, EUR and IDR, a credit-before-debit column order, a "Dr/Cr" column
// before the amount and a ledger with one signed amount column.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';

const HELD_OUT = process.argv.includes('--held-out');
const OUT = process.argv.slice(2).find(a => !a.startsWith('--')) ?? join(process.cwd(), '.local', 'benchmark', HELD_OUT ? 'heldout' : 'corpus');
const CHROME = process.env.CHROME;
mkdirSync(OUT, { recursive: true });

// ---- Seeded randomness and transactions.
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const PARTIES = {
    in: ['POS Settlement Merchant 4471', 'DuitNow Transfer from Lim Trading', 'Kedai Runcit Siti - Invoice Payment', 'Online Marketplace Payout', 'Catering Order - Dewan Seri Kenyalang', 'Customer Deposit - Tan Hardware', 'Interest Credit'],
    out: ['Supplier Payment - Borneo Fresh Produce Sdn Bhd', 'IBG Transfer to Kuching Packaging Supply', 'Payroll - Staff Salaries', 'Rent - Shoplot Jalan Padungan', 'Electricity Bill - Utility Provider', 'JomPAY Water Bill', 'Service Charge - Account Maintenance', 'Cheque Paid 000' , 'Card Purchase - Office Supplies'],
};
function transactions(r, { start, months, count, scale }) {
    const [y, m] = start.split('-').map(Number), out = [];
    const days = Array.from({ length: months }, (_, k) => { const mm = (m - 1 + k) % 12 + 1, yy = y + Math.floor((m - 1 + k) / 12); return Array.from({ length: new Date(Date.UTC(yy, mm, 0)).getUTCDate() }, (_, d) => `${yy}-${String(mm).padStart(2, '0')}-${String(d + 1).padStart(2, '0')}`); }).flat();
    for (let i = 0; i < count; i++) {
        const credit = r() < 0.45, list = credit ? PARTIES.in : PARTIES.out, who = list[Math.floor(r() * list.length)];
        const base = /Payroll/.test(who) ? 9000 : /Rent/.test(who) ? 4200 : /Service|Interest/.test(who) ? 12 : /Bill/.test(who) ? 450 : credit ? 1800 : 900;
        const cents = Math.max(150, Math.round(base * scale * (0.4 + r() * 1.2) * 100));
        const ref = Array.from({ length: 10 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(r() * 32)]).join('');
        const long = r() < 0.2 ? ` - ${['Monthly settlement for outlet operations and services', 'Reference invoice INV', 'Transfer via online banking'][Math.floor(r() * 3)]}` : '';
        out.push({ date: days[Math.floor(r() * days.length)], cents: credit ? cents : -cents, description: `${who.replace('Cheque Paid 000', `Cheque Paid 000${Math.floor(r() * 900 + 100)}`)}${long}`, ref });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
}

// ---- Formatting.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateAs = (iso, f) => { const [y, m, d] = iso.split('-'); return { 'DD/MM/YYYY': `${d}/${m}/${y}`, 'DD-MM-YYYY': `${d}-${m}-${y}`, 'D Mon YYYY': `${+d} ${MON[+m - 1]} ${y}`, 'YYYY-MM-DD': iso, 'DD.MM.YYYY': `${d}.${m}.${y}`, 'DD-Mon-YYYY': `${d}-${MON[+m - 1]}-${y}` }[f]; };
const plain = c => `${c < 0 ? '-' : ''}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, '0')}`;
const money = (c, f, prefix = '') => { const [w, fr] = plain(Math.abs(c)).split('.'); const g = f === 'DOT' ? w.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : f === 'COMMA' ? w.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : w; return `${c < 0 ? '-' : ''}${prefix}${g}${f === 'DOT' ? ',' : '.'}${fr}`; };

// ---- Layouts. Each returns { title lines (preamble), header, rows (cells per transaction), footer lines }.
const LAYOUTS = [
    { id: 'kenyalang-myr-split', role: 'BANK', bank: 'Kenyalang Community Bank', currency: 'MYR', date: 'DD/MM/YYYY', num: 'COMMA', months: 1, start: '2026-02', count: 46, scale: 1,
        header: ['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'], cells: (t, bal, L) => [dateAs(t.date, L.date), t.description, t.ref, t.cents < 0 ? money(-t.cents, L.num) : '', t.cents > 0 ? money(t.cents, L.num) : '', money(bal, L.num)] },
    { id: 'straits-sgd-quarter', role: 'BANK', bank: 'Straits Harbour Bank', currency: 'SGD', date: 'D Mon YYYY', num: 'COMMA', months: 3, start: '2026-01', count: 84, scale: 1.4,
        header: ['Txn Date', 'Value Date', 'Particulars', 'Withdrawals (SGD)', 'Deposits (SGD)', 'Balance (SGD)'], cells: (t, bal, L) => [dateAs(t.date, L.date), dateAs(t.date, L.date), t.description, t.cents < 0 ? money(-t.cents, L.num) : '', t.cents > 0 ? money(t.cents, L.num) : '', money(bal, L.num)] },
    { id: 'rajang-myr-malay', role: 'BANK', bank: 'Bank Rajang Berhad', currency: 'MYR', date: 'DD-MM-YYYY', num: 'COMMA', months: 1, start: '2026-03', count: 38, scale: 0.8, malay: true,
        header: ['Tarikh', 'Butiran', 'Rujukan', 'Debit (RM)', 'Kredit (RM)', 'Baki (RM)'], cells: (t, bal, L) => [dateAs(t.date, L.date), t.description, t.ref, t.cents < 0 ? money(-t.cents, L.num) : '', t.cents > 0 ? money(t.cents, L.num) : '', money(bal, L.num)] },
    { id: 'pelita-usd-signed', role: 'BANK', bank: 'Pelita Trade Bank', currency: 'USD', date: 'YYYY-MM-DD', num: 'PLAIN', months: 1, start: '2026-04', count: 30, scale: 0.5,
        header: ['Posting Date', 'Transaction Details', 'Net Cash Movement (USD)', 'Balance (USD)'], cells: (t, bal, L) => [dateAs(t.date, L.date), `${t.description} ${t.ref}`, money(t.cents, L.num), money(bal, L.num)] },
    { id: 'sarawak-digital-drcr', role: 'BANK', bank: 'Sarawak Digital Bank', currency: 'MYR', date: 'DD.MM.YYYY', num: 'COMMA', months: 2, start: '2026-01', count: 52, scale: 1, prefix: 'RM ',
        header: ['Date', 'Details', 'Amount', 'DR/CR', 'Balance'], cells: (t, bal, L) => [dateAs(t.date, L.date), `${t.description} ${t.ref}`, money(Math.abs(t.cents), L.num, L.prefix), t.cents < 0 ? 'DR' : 'CR', money(bal, L.num, L.prefix)] },
    { id: 'deccan-inr-quarter', role: 'BANK', bank: 'Deccan Merchant Bank', currency: 'INR', date: 'DD-Mon-YYYY', num: 'COMMA', months: 3, start: '2026-01', count: 70, scale: 18, prefix: 'Rs. ', watermark: 'SPECIMEN - FICTIONAL',
        header: ['Date', 'Narration', 'Chq/Ref No', 'Withdrawal Amt', 'Deposit Amt', 'Closing Balance'], cells: (t, bal, L) => [dateAs(t.date, L.date), t.description, t.ref, t.cents < 0 ? money(-t.cents, L.num, L.prefix) : '', t.cents > 0 ? money(t.cents, L.num, L.prefix) : '', money(bal, L.num, L.prefix)] },
    { id: 'ledger-cash-myr', role: 'LEDGER', business: 'Kopitiam Sungai Sdn Bhd (Fictional)', currency: 'MYR', date: 'DD/MM/YYYY', num: 'COMMA', months: 1, start: '2026-02', count: 40, scale: 1,
        header: ['Date', 'Voucher No', 'Narration', 'Debit (RM)', 'Credit (RM)'], cells: (t, _, L) => [dateAs(t.date, L.date), `JV-${t.ref.slice(0, 6)}`, t.description, t.cents > 0 ? money(t.cents, L.num) : '', t.cents < 0 ? money(-t.cents, L.num) : ''] },
    { id: 'lejar-tunai-malay', role: 'LEDGER', business: 'Kedai Kain Rajang Enterprise (Rekaan)', currency: 'MYR', date: 'DD-MM-YYYY', num: 'COMMA', months: 1, start: '2026-03', count: 32, scale: 0.7, malay: true,
        header: ['Tarikh', 'No. Baucar', 'Keterangan', 'Debit (RM)', 'Kredit (RM)'], cells: (t, _, L) => [dateAs(t.date, L.date), `BC-${t.ref.slice(0, 6)}`, t.description, t.cents > 0 ? money(t.cents, L.num) : '', t.cents < 0 ? money(-t.cents, L.num) : ''] },
];

// ---- Held-out layouts (evaluation only; see --held-out). Same writers, new headings, languages, formats and currencies.
const HELD_OUT_LAYOUTS = [
    { id: 'labuan-myr-moneyinout', role: 'BANK', bank: 'Labuan Island Bank', currency: 'MYR', date: 'D Mon YYYY', num: 'COMMA', months: 2, start: '2026-02', count: 60, scale: 1.1,
        header: ['Trans. Date', 'Description', 'Money Out (RM)', 'Money In (RM)', 'Running Balance'], cells: (t, bal, L) => [dateAs(t.date, L.date), `${t.description} / ${t.ref}`, t.cents < 0 ? money(-t.cents, L.num) : '', t.cents > 0 ? money(t.cents, L.num) : '', money(bal, L.num)] },
    { id: 'tanjung-eur-german', role: 'BANK', bank: 'Tanjung Europa Bank', currency: 'EUR', date: 'DD.MM.YYYY', num: 'DOT', months: 1, start: '2026-04', count: 34, scale: 0.6,
        header: ['Buchungstag', 'Verwendungszweck', 'Betrag (EUR)', 'Saldo (EUR)'], cells: (t, bal, L) => [dateAs(t.date, L.date), `${t.description} ${t.ref}`, money(t.cents, L.num), money(bal, L.num)] },
    { id: 'mekong-thb-drcr-first', role: 'BANK', bank: 'Mekong Riverside Bank', currency: 'THB', date: 'YYYY-MM-DD', num: 'COMMA', months: 1, start: '2026-03', count: 44, scale: 24,
        header: ['Date', 'Ref No.', 'Transaction', 'Dr/Cr', 'Amount (THB)', 'Balance (THB)'], cells: (t, bal, L) => [dateAs(t.date, L.date), t.ref, t.description, t.cents < 0 ? 'Dr' : 'Cr', money(Math.abs(t.cents), L.num), money(bal, L.num)] },
    { id: 'nusantara-idr-indonesian', role: 'BANK', bank: 'Bank Nusantara Timur', currency: 'IDR', date: 'DD/MM/YYYY', num: 'DOT', months: 3, start: '2026-01', count: 75, scale: 3500, lang: 'id',
        header: ['Tanggal', 'Keterangan', 'Debet', 'Kredit', 'Saldo'], cells: (t, bal, L) => [dateAs(t.date, L.date), `${t.description} ${t.ref}`, t.cents < 0 ? money(-t.cents, L.num) : '', t.cents > 0 ? money(t.cents, L.num) : '', money(bal, L.num)] },
    { id: 'kinabalu-myr-credit-first', role: 'BANK', bank: 'Kinabalu Savings Bank', currency: 'MYR', date: 'DD-MM-YYYY', num: 'COMMA', months: 1, start: '2026-05', count: 28, scale: 0.9,
        header: ['Value Date', 'Credit', 'Debit', 'Narrative', 'Balance'], cells: (t, bal, L) => [dateAs(t.date, L.date), t.cents > 0 ? money(t.cents, L.num) : '', t.cents < 0 ? money(-t.cents, L.num) : '', `${t.description} ${t.ref}`, money(bal, L.num)] },
    { id: 'ledger-sgd-dr-cr', role: 'LEDGER', business: 'Harbourfront Bakery Pte Ltd (Fictional)', currency: 'SGD', date: 'DD-Mon-YYYY', num: 'COMMA', months: 1, start: '2026-04', count: 36, scale: 1.2,
        header: ['Posting Date', 'Doc No', 'Particulars', 'Dr (SGD)', 'Cr (SGD)'], cells: (t, _, L) => [dateAs(t.date, L.date), `GL-${t.ref.slice(0, 7)}`, t.description, t.cents > 0 ? money(t.cents, L.num) : '', t.cents < 0 ? money(-t.cents, L.num) : ''] },
    { id: 'lejar-bank-malay-dotdate', role: 'LEDGER', business: 'Bengkel Motor Sibu Enterprise (Rekaan)', currency: 'MYR', date: 'DD.MM.YYYY', num: 'COMMA', months: 1, start: '2026-02', count: 30, scale: 0.8, malay: true,
        header: ['Tarikh Pos', 'Rujukan', 'Perihal', 'Debit', 'Kredit'], cells: (t, _, L) => [dateAs(t.date, L.date), `RJ-${t.ref.slice(0, 6)}`, t.description, t.cents > 0 ? money(t.cents, L.num) : '', t.cents < 0 ? money(-t.cents, L.num) : ''] },
    { id: 'ledger-usd-signed', role: 'LEDGER', business: 'Coral Bay Logistics LLC (Fictional)', currency: 'USD', date: 'YYYY-MM-DD', num: 'PLAIN', months: 1, start: '2026-05', count: 40, scale: 0.7,
        header: ['Date', 'Journal', 'Memo', 'Amount (USD)'], cells: (t, _, L) => [dateAs(t.date, L.date), `J${t.ref.slice(0, 5)}`, t.description, money(t.cents, L.num)] },
];

function documentOf(L, seed) {
    const r = rng(seed), tx = transactions(r, L), opening = Math.round((20000 + r() * 80000) * L.scale) * 100;
    const [y, m] = L.start.split('-').map(Number), endM = (m - 1 + L.months - 1) % 12 + 1, endY = y + Math.floor((m - 1 + L.months - 1) / 12);
    const startIso = `${L.start}-01`, endIso = `${endY}-${String(endM).padStart(2, '0')}-${String(new Date(Date.UTC(endY, endM, 0)).getUTCDate()).padStart(2, '0')}`;
    const period = `${dateAs(startIso, L.date)} to ${dateAs(endIso, L.date)}`;
    let bal = opening; const rows = tx.map(t => { bal += t.cents; return L.cells(t, bal, L); });
    const id = `CUST-${Math.floor(r() * 900000 + 100000)}`, holder = L.role === 'BANK' ? ['Rimba Kitchen Enterprise (Fictional)', 'Sungai Hardware Trading (Fictional)', 'Dewan Catering Services (Fictional)'][seed % 3] : L.business;
    const ins = tx.filter(t => t.cents > 0).reduce((n, t) => n + t.cents, 0), outs = -tx.filter(t => t.cents < 0).reduce((n, t) => n + t.cents, 0);
    const pre = L.role === 'BANK' && L.lang === 'id'
        ? [[`${L.bank} - Rekening Koran`], ['Nama nasabah', holder], ['ID nasabah', id], ['Periode', period], ['Mata uang', L.currency], ['Saldo awal', money(opening, L.num, L.prefix)]]
        : L.role === 'BANK'
        ? (L.malay ? [[`${L.bank} - Penyata Akaun Semasa`], ['Pemegang akaun', holder], ['ID pelanggan', id], ['Tempoh penyata', period], ['Mata wang', L.currency], ['Baki awal', money(opening, L.num, L.prefix)]]
            : [[`${L.bank} - Current Account Statement`], ['Account holder', holder], ['Customer ID', id], ['Statement period', period], ['Currency', L.currency], ['Opening balance', money(opening, L.num, L.prefix)]])
        : (L.malay ? [[`${holder} - Lejar Am`], ['Kod entiti', id], ['Akaun', '1010 Tunai di Bank - Akaun Semasa'], ['Tempoh', period], ['Mata wang', L.currency]]
            : [[`${holder} - General Ledger Detail`], ['Entity code', id], ['Account', '1010 Cash at Bank - Current Account'], ['Period', period], ['Currency', L.currency]]);
    const foot = L.role === 'BANK' && L.lang === 'id'
        ? [['Total debet', money(outs, L.num)], ['Total kredit', money(ins, L.num)], ['Saldo akhir', money(bal, L.num)]]
        : L.role === 'BANK'
        ? (L.malay ? [['Jumlah debit', money(outs, L.num)], ['Jumlah kredit', money(ins, L.num)], ['Baki akhir', money(bal, L.num)]] : [['Total withdrawals', money(outs, L.num, L.prefix)], ['Total deposits', money(ins, L.num, L.prefix)], ['Closing balance', money(bal, L.num, L.prefix)]])
        : (L.malay ? [['Jumlah debit', money(ins, L.num)], ['Jumlah kredit', money(outs, L.num)]] : [['Total debits', money(ins, L.num)], ['Total credits', money(outs, L.num)]]);
    return { id: `${L.id}-${seed}`, layout: L, pre, header: L.header, rows, foot, truth: { role: L.role === 'BANK' ? 'BANK_STATEMENT' : 'GENERAL_LEDGER', currency: L.currency, transactions: tx.map(t => ({ date: t.date, cents: String(t.cents) })) } };
}

// ---- Writers.
const csvCell = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const csv = doc => [...doc.pre, [], doc.header, ...doc.rows, [], ...doc.foot].map(r => r.map(csvCell).join(',')).join('\n') + '\n';
function xlsx(doc) {
    const ns = 'http://schemas.openxmlformats.org', rel = `${ns}/officeDocument/2006/relationships`, esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const col = i => String.fromCharCode(65 + i);
    const lines = [...doc.pre, [], doc.header, ...doc.rows, [], ...doc.foot];
    // Figures are stored as numbers where the layout prints plain digits, as an export would; text stays text.
    const cellXml = (v, ref) => /^-?\d+(\.\d+)?$/.test(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
    const sheet = `<worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetData>${lines.map((r, y) => `<row r="${y + 1}">${r.map((v, x) => v ? cellXml(v, `${col(x)}${y + 1}`) : '').join('')}</row>`).join('')}</sheetData></worksheet>`;
    const files = {
        '[Content_Types].xml': `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
        '_rels/.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
        'xl/workbook.xml': `<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets><sheet name="Statement" sheetId="1" r:id="rId1"/></sheets></workbook>`,
        'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
        'xl/worksheets/sheet1.xml': sheet,
    };
    return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([n, t]) => [n, [strToU8(t), { mtime: new Date('2026-05-01T00:00:00') }]]))));
}
const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function html(doc, { scan = false, rows = doc.rows, first = true, last = true, page = 0, pages = 0 } = {}) {
    const numeric = doc.header.map((h, i) => /Debit|Credit|Withdraw|Deposit|Balance|Amount|Kredit|Baki|Movement|Amt|Money|Betrag|Saldo|Debet|Dr \(|Cr \(/i.test(h) || i === doc.header.length - 1 && doc.layout.role === 'BANK');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
        @page { size: A4 landscape; margin: 14mm 12mm 16mm }
        body { font: ${scan ? '30px' : '9.5pt'}/1.35 Arial, Helvetica, sans-serif; color: #1c1c22; margin: 0; ${scan ? 'background:#f4f1ea; padding: 80px 90px; width: 3328px; height: 2320px; box-sizing: border-box; position: relative; overflow: hidden' : ''} }
        ${scan ? `.p { transform: rotate(${page % 2 ? -0.2 : 0.25}deg); filter: contrast(.96) }` : ''}
        h1 { font-size: ${scan ? '42px' : '15pt'}; margin: 0 0 ${scan ? '18px' : '8px'} } .pre div, .foot div { margin: 2px 0 } .pre span, .foot span { display: inline-block; min-width: ${scan ? '380px' : '150px'} }
        table { border-collapse: collapse; margin-top: ${scan ? '24px' : '10px'}; width: 100% } thead { display: table-header-group }
        th { text-align: left; font-weight: 700; border-bottom: 1px solid #555; padding: ${scan ? '8px 28px 8px 0' : '3px 12px 3px 0'}; white-space: nowrap } th.n, td.n { text-align: right }
        td { padding: ${scan ? '4px 28px 4px 0' : '2px 12px 2px 0'}; vertical-align: top } td.d { max-width: ${scan ? '1000px' : '260px'} }
        .foot { margin-top: ${scan ? '36px' : '14px'} } .wm { position: fixed; top: 40%; left: 20%; font-size: 64pt; color: rgba(180,0,0,.08); transform: rotate(-30deg); white-space: nowrap }
        .pg { position: absolute; bottom: 40px; left: 0; right: 0; text-align: center; font-size: 25px }
    </style></head><body><div class="p">
        ${doc.layout.watermark && !scan ? `<div class="wm">${esc(doc.layout.watermark)}</div>` : ''}
        ${first ? `<h1>${esc(doc.pre[0][0])}</h1><div class="pre">${doc.pre.slice(1).map(l => `<div>${l.map(c => `<span>${esc(c)}</span>`).join('')}</div>`).join('')}</div>` : ''}
        <table><thead><tr>${doc.header.map((h, i) => `<th class="${numeric[i] ? 'n' : ''}">${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${numeric[i] ? 'n' : /Desc|Particular|Narration|Butiran|Keterangan|Details/i.test(doc.header[i]) ? 'd' : ''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>
        ${last ? `<div class="foot">${doc.foot.map(l => `<div>${l.map(c => `<span>${esc(c)}</span>`).join('')}</div>`).join('')}</div>` : ''}
    </div>${scan && pages > 1 ? `<div class="pg">Page ${page + 1} of ${pages}</div>` : ''}</body></html>`;
}

// ---- Chrome over the DevTools protocol (text PDFs via printToPDF, scans via screenshots).
async function chrome() {
    const profile = mkdtempSync(join(tmpdir(), 'fg-corpus-'));
    const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
    const portFile = join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 100 && !existsSync(portFile); i++) await new Promise(r => setTimeout(r, 100));
    const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`); await new Promise(r => ws.addEventListener('open', r));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.rej(Error(JSON.stringify(m.error))); else p.res(m.result); } });
    const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const s = (m, p) => send(m, p, sessionId);
    const load = async content => { const f = join(profile, `p${++id}.html`); writeFileSync(f, content); await s('Page.navigate', { url: `file://${f}` }); await new Promise(r => setTimeout(r, 350)); };
    return {
        async pdf(content) {
            await load(content);
            const r = await s('Page.printToPDF', { landscape: true, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' });
            return Buffer.from(r.data, 'base64');
        },
        async jpeg(content, width, height) {
            await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
            await load(content);
            return Buffer.from((await s('Page.captureScreenshot', { format: 'jpeg', quality: 92 })).data, 'base64');
        },
        close() { ws.close(); proc.kill(); },
    };
}

const docs = HELD_OUT ? HELD_OUT_LAYOUTS.map((L, i) => documentOf(L, 201 + i)) : LAYOUTS.flatMap((L, i) => [documentOf(L, 101 + i)]);
const manifest = [];
const browser = CHROME && existsSync(CHROME) ? await chrome() : null;
if (!browser) console.warn('CHROME not set: writing CSV and XLSX only.');
for (const [i, doc] of docs.entries()) {
    const write = (name, bytes, format) => { writeFileSync(join(OUT, name), bytes); manifest.push({ file: name, format, truth: `${doc.id}.truth.json`, layout: doc.layout.id }); };
    writeFileSync(join(OUT, `${doc.id}.truth.json`), JSON.stringify(doc.truth, null, 1));
    write(`${doc.id}.csv`, csv(doc), 'CSV');
    write(`${doc.id}.xlsx`, xlsx(doc), 'XLSX');
    if (!browser) continue;
    write(`${doc.id}.pdf`, await browser.pdf(html(doc)), 'PDF (text)');
    // Scans for every other layout: pages of about 28 rows, stored as JPEGs in an image-only PDF; one short layout also as a single JPEG.
    if (i % 2 === 0) {
        const per = 28, chunks = Array.from({ length: Math.ceil(doc.rows.length / per) }, (_, k) => doc.rows.slice(k * per, k * per + per));
        const pdf = await PDFDocument.create({ updateMetadata: false });
        for (const [k, rows] of chunks.entries()) {
            const jpg = await browser.jpeg(html(doc, { scan: true, rows, first: k === 0, last: k === chunks.length - 1, page: k, pages: chunks.length }), 3508, 2480);
            const img = await pdf.embedJpg(jpg), pg = pdf.addPage([842, 595]); pg.drawImage(img, { x: 0, y: 0, width: 842, height: 595 });
        }
        write(`${doc.id}-scan.pdf`, Buffer.from(await pdf.save({ useObjectStreams: false })), 'PDF (scanned)');
    }
    if (doc.rows.length <= 32) write(`${doc.id}-photo.jpg`, await browser.jpeg(html(doc, { scan: true }), 3508, 2480), 'Image (JPEG)');
}
browser?.close();
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ generator: 'fingence-statement-corpus-v1', set: HELD_OUT ? 'HELD_OUT' : 'DEVELOPMENT', origin: 'FICTIONAL_SYNTHETIC', documents: manifest }, null, 1));
console.log(`Wrote ${manifest.length} documents for ${docs.length} statements to ${OUT}`);
