/**
 * Deterministic acceptance gates for a model's layout proposal. Every check is recomputed from the
 * ORIGINAL bytes; the model's confidence or rationale is never an input. A proposal is accepted only
 * when all gates pass, and is then materialized into the Phase 1 canonical CSV layout so the rest of
 * the pipeline (normalizer, second parser, matcher, analytics) runs unchanged.
 */
import { parseProposal, type LayoutProposal } from './contracts';
import { NUMBER_FORMAT_LIST, MALAY_MONTH_NAMES, MONTH_NAMES, SWAPPED, cents, parseAmount, parseDate, type DateFormat } from './formats';
import { cashAccountAgreement, headingAgreement, roleAgreement, signedAgreement, tokenAgreement, type Agreement, type Meaning } from './lexicon';
import type { Table } from './evidence';

export type GateCheck = { id: string; label: string; passed: boolean; detail: string };
export type FieldMapping = { field: string; column: number; heading: string; agreement: Agreement | null };
export type VerifiedInterpretation = {
    decision: 'AUTO_ACCEPTED' | 'QUARANTINED';
    role: 'BANK_STATEMENT' | 'GENERAL_LEDGER' | null;
    summary: string;
    checks: GateCheck[];
    mapping: FieldMapping[];
    disclosures: string[];
    /** Canonical CSV in the Phase 1 layout, with each canonical row's source line (0-based). */
    canonical: { bytes: Uint8Array; rows: number; lineage: number[]; net: string; period: string; businessId: string } | null;
    /** Stable description of the accepted semantics (rationale excluded), hashed into the processing ID. */
    mappingKey: string | null;
};

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Headings that name a record identifier (not a reference or cheque number, which are separate fields). */
const ID_HEADING = /^\s*(?:(?:txn|transaction|trans|entry|voucher|journal|jv|record|line|posting)(?:\s*(?:id|no\.?|number|#))?|id|id transaksi|no\.?\s*(?:baucar|rekod|transaksi|kemasukan))\s*$/i;
const ACCOUNT_HEADING = /^\s*(account|acct|akaun|gl account|account code|account no\.?|kod akaun)\b/i;
const TOTAL_LINE = /\b(totals?|jumlah)\b/i;
const BALANCE_LINE = /\b(opening|closing|brought forward|carried forward|b\/f|c\/f|baki awal|baki akhir|baki dibawa)\b/i;
const csvCell = (v: string) => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const csv = (header: string[], rows: Record<string, string>[]) => [header.join(','), ...rows.map(r => header.map(h => csvCell(r[h] ?? '')).join(','))].join('\n') + '\n';
export const CANONICAL_BANK_HEADER = ['BankTransactionID', 'BusinessID', 'BusinessName', 'AccountNumber', 'Currency', 'ValueDate', 'StatementMonth', 'BankReference', 'BankDescription', 'BankDirection', 'BankAmountMYR', 'SignedCashMovementMYR', 'Counterparty', 'SourceTransactionID'];
export const CANONICAL_LEDGER_HEADER = ['LedgerEntryID', 'BusinessID', 'PostingDate', 'CashAccount', 'Currency', 'LedgerReference', 'LedgerMemo', 'Counterparty', 'CashAccountDebitMYR', 'CashAccountCreditMYR', 'SignedCashMovementMYR', 'CategoryLabel'];
export const COUNTERPARTY_NOT_STATED = 'Not stated in source';

const REPRESENTATION_FIELDS = {
    SIGNED_AMOUNT: ['amount'], AMOUNT_AND_DIRECTION: ['amount', 'direction'], SPLIT_IN_OUT: ['moneyIn', 'moneyOut'], DEBIT_CREDIT: ['debit', 'credit'],
} as const;
const MONEY_FIELDS = ['amount', 'direction', 'moneyIn', 'moneyOut', 'debit', 'credit'] as const;

/** Day/month-swapped reading of a numeric date, or null when the format has no such reading. */
function swappedReading(literal: string, format: DateFormat): string | null {
    if (SWAPPED[format]) return parseDate(literal, SWAPPED[format]!);
    const m = format === 'DD-MM-YYYY' ? /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(literal.trim()) : format === 'DD.MM.YYYY' ? /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(literal.trim()) : null;
    return m ? parseDate(`${m[2]}/${m[1]}/${m[3]}`, 'DD/MM/YYYY') : null;
}
function lineText(table: Table, line: number) { return (table.rows[line] ?? []).join(' '); }
const ISO_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
/** An OCR'd currency code with one letter in the wrong case ("UsD"), found case-insensitively on the cited line. */
function ocrCurrencyCode(table: Table, e: { line: number; literal: string } | null | undefined) {
    if (!e?.literal.trim()) return null;
    const text = lineText(table, e.line), at = text.toLowerCase().indexOf(e.literal.trim().toLowerCase());
    if (at < 0) return null;
    const read = text.slice(at, at + e.literal.trim().length);
    const codes = [...read.matchAll(/\b[A-Za-z]{3}\b/g)].map(m => m[0])
        .filter(t => (t.match(/[a-z]/g)?.length ?? 0) <= 1 && ISO_CURRENCIES.has(t.toUpperCase()));
    return codes.length === 1 ? { code: codes[0].toUpperCase(), read: codes[0], line: e.line } : null;
}
function periodMentioned(literal: string, period: string) {
    const [y, m] = period.split('-'), text = literal.toLowerCase();
    const names = [MONTH_NAMES[+m - 1], MONTH_NAMES[+m - 1].slice(0, 3), MALAY_MONTH_NAMES[+m - 1]];
    return [period, ...names.flatMap(n => [`${n} ${y}`, `${n}-${y}`]), `/${m}/${y}`, `-${m}-${y}`, `.${m}.${y}`, `${m}/${y}`, `/${+m}/${y}`]
        .some(s => text.includes(s.toLowerCase()));
}

/**
 * Judges a proposal from the document's bytes alone. The file name is deliberately NOT an input: it is metadata
 * anyone can change, so it may guide a model's proposal (it is in the evidence) but never establishes a role.
 */
/**
 * `extracted`: the table was assembled from positioned words (PDF text layer or OCR) and needs its own arithmetic.
 * `scope`: what one document may cover. The Phase 1 pipeline reconciles one month in MYR (the default); the
 * ingestion layer accepts consecutive or gapped months and any currency the document states verbatim.
 */
export type GateOptions = { extracted?: 'PDF_TEXT' | 'OCR'; scope?: { months: 'ONE' | 'MANY'; currencies: readonly string[] | 'ANY' } };
const PHASE1_SCOPE: NonNullable<GateOptions['scope']> = { months: 'ONE', currencies: ['MYR'] };
export function verifyProposal(table: Table, raw: unknown, options: GateOptions = {}): VerifiedInterpretation {
    const scopeRule = options.scope ?? PHASE1_SCOPE;
    const checks: GateCheck[] = [], disclosures: string[] = [], mapping: FieldMapping[] = [];
    const result = (summary: string): VerifiedInterpretation => ({ decision: 'QUARANTINED', role: null, summary, checks, mapping, disclosures, canonical: null, mappingKey: null });
    const gate = (id: string, label: string, passed: boolean, detail: string) => { checks.push({ id, label, passed, detail }); return passed; };

    const parsed = parseProposal(raw);
    gate('schema', 'Proposal matches the strict interpretation schema', parsed.success, parsed.success ? (parsed.version === 'v2' ? 'Valid' : 'Valid (legacy v1 layout)') : parsed.issues.join('; '));
    if (!parsed.success) return result('The model response was not a valid interpretation proposal.');
    const p: LayoutProposal = parsed.data, c = p.columns, ledger = p.role === 'GENERAL_LEDGER';
    if (!gate('role', 'Document is a supported bank statement or cash-account ledger', p.role !== 'UNSUPPORTED', p.role === 'UNSUPPORTED' ? `The model abstained: ${p.unresolved.join('; ') || p.rationale || 'unsupported document'}` : p.role)) return result('The model reported that this is not a supported financial document.');

    // 1. Table structure.
    const header = table.rows[p.headerLine] ?? [], width = header.length;
    if (!gate('structure', 'Header row exists with at least three named columns', width >= 3 && header.filter(Boolean).length >= 3, `Line ${p.headerLine + 1}: ${header.slice(0, 8).join(' | ') || 'missing'}`)) return result('The proposed header row is not a table header.');
    for (const [field, column] of Object.entries(c)) if (column !== null) mapping.push({ field, column, heading: header[column] ?? '(out of range)', agreement: null });

    // 2. Mapping integrity for the declared role and representation.
    const allowed = ledger ? ['SIGNED_AMOUNT', 'AMOUNT_AND_DIRECTION', 'DEBIT_CREDIT'] : ['SIGNED_AMOUNT', 'AMOUNT_AND_DIRECTION', 'SPLIT_IN_OUT'];
    const rep = p.representation, repFields: readonly string[] = rep ? REPRESENTATION_FIELDS[rep] : [];
    const required = ['date', 'description', ...repFields] as (keyof typeof c)[];
    const missing = required.filter(f => c[f] === null);
    const stray = MONEY_FIELDS.filter(f => c[f] !== null && !repFields.includes(f));
    const indices = mapping.map(m => m.column), outOfRange = indices.filter(i => i >= width), duplicate = indices.filter((v, i) => indices.indexOf(v) !== i);
    const integrity = !!rep && allowed.includes(rep) && !missing.length && !stray.length && !outOfRange.length && !duplicate.length && !!p.dateFormat && !!p.numberFormat;
    if (!gate('mapping', 'Required fields mapped to distinct existing columns', integrity, integrity ? `${mapping.length} fields mapped; ${rep}`
        : [!rep || !allowed.includes(rep) ? `representation ${rep ?? 'missing'} not valid for ${p.role}` : '', missing.length ? `missing ${missing.join(', ')}` : '', stray.length ? `conflicting ${stray.join(', ')}` : '', outOfRange.length ? 'column out of range' : '', duplicate.length ? 'one column used twice' : '', !p.dateFormat || !p.numberFormat ? 'date or number format unresolved' : ''].filter(Boolean).join('; '))) return result('The proposed mapping is incomplete or inconsistent.');
    const dateFormat = p.dateFormat!, numberFormat = p.numberFormat!;
    // The header must be headings, not a transaction, and no transaction may sit above it (it would be silently dropped).
    const looksLikeTransaction = (row: string[]) => row.length === width && !!parseDate((row[c.date!] ?? '').trim(), dateFormat);
    const headerIsData = looksLikeTransaction(header) || repFields.some(f => f !== 'direction' && typeof parseAmount((header[c[f as keyof typeof c]!] ?? ''), numberFormat) === 'bigint');
    const dataAbove = table.rows.slice(0, p.headerLine).findIndex(looksLikeTransaction);
    if (!gate('header', 'Header row holds headings and no transaction lies above it', !headerIsData && dataAbove < 0, headerIsData ? `Line ${p.headerLine + 1} is a transaction row, not headings` : dataAbove >= 0 ? `Line ${dataAbove + 1} above the header is a transaction` : `Line ${p.headerLine + 1}`)) return result('The proposed header row is not the table header.');

    // 3. Transaction lines: equal-width rows with a date; balance-only lines at the edges are excluded and disclosed.
    const cell = (row: string[], f: keyof typeof c) => c[f] === null ? '' : (row[c[f]!] ?? '').trim();
    const candidates = table.rows.map((row, line) => ({ row, line })).slice(p.headerLine + 1).filter(({ row }) => row.some(Boolean));
    // A totals or balance-forward line ("Total withdrawals", "Jumlah", "Balance carried forward") whose date cell holds no
    // date is not a transaction, wherever it sits; it is excluded and disclosed. A line WITH a valid date never is.
    const footerLike = (row: string[]) => !parseDate(cell(row, 'date'), dateFormat) && (TOTAL_LINE.test(row.join(' ')) || BALANCE_LINE.test(row.join(' ')));
    const isTxn = ({ row }: { row: string[] }) => row.length === width && !!cell(row, 'date') && !footerLike(row) && !(repFields.every(f => !cell(row, f as keyof typeof c)) && BALANCE_LINE.test(cell(row, 'description')));
    const first = candidates.findIndex(isTxn), last = candidates.findLastIndex(isTxn);
    const inside = first < 0 ? [] : candidates.slice(first, last + 1);
    const forwarded = inside.filter(r => !isTxn(r) && footerLike(r.row)), body = inside.filter(r => !forwarded.includes(r));
    if (forwarded.length) disclosures.push(`${forwarded.length} balance or total line${forwarded.length === 1 ? '' : 's'} between transactions excluded: ${forwarded.slice(0, 2).map(r => `line ${r.line + 1} "${r.row.filter(Boolean).join(' ').slice(0, 50)}"`).join('; ')}`);
    const interleaved = body.filter(r => !isTxn(r));
    const excluded = [...candidates.slice(0, Math.max(first, 0)), ...(first < 0 ? [] : candidates.slice(last + 1))];
    if (excluded.length) disclosures.push(`${excluded.length} non-transaction line${excluded.length === 1 ? '' : 's'} excluded: ${excluded.slice(0, 3).map(r => `line ${r.line + 1} "${r.row.filter(Boolean).join(' ').slice(0, 50)}"`).join('; ')}`);
    // An excluded line carrying both a date and an amount may be a malformed transaction: never drop it silently.
    const suspicious = excluded.find(({ row }) => row.some(v => parseDate(v, dateFormat)) && row.some(v => /\d/.test(v) && typeof parseAmount(v, numberFormat) === 'bigint' && !parseDate(v, dateFormat)) && !BALANCE_LINE.test(row.join(' ')));
    if (!gate('excluded', 'No transaction-like line is excluded', !suspicious, suspicious ? `line ${suspicious.line + 1} has a date and an amount but does not fit the table` : `${excluded.length} non-transaction lines`)) return result('A line that looks like a transaction does not fit the table.');
    if (!gate('lines', 'Transaction lines form one contiguous table', body.length > 0 && !interleaved.length && body.length <= 5000, body.length ? `${body.length} transaction lines${interleaved.length ? `; ${interleaved.length} interleaved non-transaction lines (first: line ${interleaved[0].line + 1})` : ''}${excluded.length ? `; ${excluded.length} header/footer lines excluded` : ''}` : 'No dated rows under the header')) return result('Transaction lines could not be isolated.');

    // 4. Dates: every value parses, one month, and the alternative day/month reading is refuted.
    const dates = body.map(r => parseDate(cell(r.row, 'date'), dateFormat));
    const badDate = dates.findIndex(d => d === null);
    if (!gate('dates', `Every date parses as ${dateFormat}`, badDate < 0, badDate < 0 ? `${dates.length} dates` : `line ${body[badDate].line + 1}: "${cell(body[badDate].row, 'date')}"`)) return result('Dates do not follow the proposed format.');
    const months = [...new Set(dates.map(d => d!.slice(0, 7)))].sort();
    const many = scopeRule.months === 'MANY';
    if (!gate('period', many ? 'Transactions fall within the stated months' : 'All transactions fall within one month', many || months.length === 1, months.length > 3 ? `${months.length} months, ${months[0]} to ${months.at(-1)}` : months.join(', '))) return result('The document spans more than one month.');
    // One month keeps its YYYY-MM identity (and the Phase 1 processing IDs); several months are named by their range.
    const period = months.length === 1 ? months[0] : `${months[0]}/${months.at(-1)}`;
    const alternative = body.map(r => swappedReading(cell(r.row, 'date'), dateFormat));
    const alternativeViable = alternative.every(Boolean) && alternative.some((d, i) => d !== dates[i]);
    const alternativeMonths = new Set(alternative.map(d => d?.slice(0, 7)));
    const ordered = (ds: (string | null)[]) => ds.every((d, i) => i === 0 || d! >= ds[i - 1]!);
    // Several months: the swapped reading is refuted when it breaks the statement's date order and the declared one keeps it.
    const refuted = !alternativeViable || (many ? ordered(dates) && !ordered(alternative) : alternativeMonths.size > 1);
    if (!gate('date-order', 'Day/month order is unambiguous', refuted, !alternativeViable ? 'The swapped day/month reading is invalid for at least one date' : refuted ? (many ? 'The swapped reading would put the transactions out of date order' : `The swapped reading would span ${alternativeMonths.size} months, which a one-month statement cannot`) : many ? 'Both readings keep the transactions in date order' : 'Both readings are valid one-month statements')) return result('The date order is ambiguous.');

    // 5. Amounts and direction under the declared representation.
    const tokens = { inflow: p.directionTokens.inflow.map(t => t.trim().toUpperCase()), outflow: p.directionTokens.outflow.map(t => t.trim().toUpperCase()) };
    const signed: bigint[] = [], problems: string[] = [], zeroLines: number[] = [];
    for (const { row, line } of body) {
        const value = (f: keyof typeof c) => parseAmount(cell(row, f), numberFormat);
        if (rep === 'SIGNED_AMOUNT') {
            const a = value('amount');
            if (a === null || a === undefined) problems.push(`line ${line + 1}: amount "${cell(row, 'amount')}"`); else signed.push(a);
        } else if (rep === 'AMOUNT_AND_DIRECTION') {
            const a = value('amount'), t = cell(row, 'direction').toUpperCase();
            if (a === null || a === undefined || a < 0n) problems.push(`line ${line + 1}: amount "${cell(row, 'amount')}"`);
            else if (tokens.inflow.includes(t)) signed.push(a); else if (tokens.outflow.includes(t)) signed.push(-a);
            else problems.push(`line ${line + 1}: direction "${cell(row, 'direction')}" not covered by the proposed tokens`);
        } else {
            const [inField, outField] = rep === 'SPLIT_IN_OUT' ? ['moneyIn', 'moneyOut'] as const : ['debit', 'credit'] as const;
            const a = value(inField), b = value(outField);
            const one = (a !== undefined && a !== 0n) !== (b !== undefined && b !== 0n);
            // A line with neither side (a failed or reversed instruction printed for the record) moves no cash; it is
            // admitted only when a running balance exists, whose unchanged value the balance gate then has to confirm.
            const none = a === undefined && b === undefined && c.balance !== null && !!cell(row, 'balance');
            if (a === null || b === null || (a ?? 0n) < 0n || (b ?? 0n) < 0n || (!one && !none)) problems.push(`line ${line + 1}: "${cell(row, inField)}" / "${cell(row, outField)}" ${one ? 'not valid amounts' : 'must have exactly one non-zero side'}`);
            else { signed.push((a ?? 0n) - (b ?? 0n)); if (none) zeroLines.push(line + 1); }
        }
    }
    if (zeroLines.length) disclosures.push(`${zeroLines.length} line${zeroLines.length === 1 ? '' : 's'} with no amount on either side read as no cash movement, confirmed by the running balance (line ${zeroLines.slice(0, 3).join(', ')}).`);
    const overlap = tokens.inflow.filter(t => tokens.outflow.includes(t));
    if (!gate('amounts', `Every amount parses as ${numberFormat} under ${rep}`, !problems.length && !overlap.length, problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'}; ${problems.slice(0, 2).join('; ')}` : overlap.length ? `token ${overlap[0]} is both inflow and outflow` : `${signed.length} amounts, exact cents`)) return result('Amounts do not follow the proposed representation.');
    const moneyLiterals = body.flatMap(({ row }) => [...repFields.filter(f => f !== 'direction'), ...(c.balance !== null ? ['balance'] : [])].map(f => cell(row, f as keyof typeof c)).filter(Boolean));
    const ambiguousFormats = NUMBER_FORMAT_LIST.filter(f => f !== numberFormat && moneyLiterals.every(v => typeof parseAmount(v, f) === 'bigint') && moneyLiterals.some(v => parseAmount(v, f) !== parseAmount(v, numberFormat)));

    // 6. Running balance: an independent arithmetic witness for amounts and direction.
    let balanceStatus: 'ABSENT' | 'PASSED' | 'FAILED' = 'ABSENT', balanceDetail = 'No balance column';
    if (c.balance !== null) {
        const balances = body.map(r => parseAmount(cell(r.row, 'balance'), numberFormat));
        const steps = balances.slice(1).map((b, i) => typeof b === 'bigint' && typeof balances[i] === 'bigint' ? b - balances[i]! === signed[i + 1] : false);
        const failedStep = steps.indexOf(false);
        balanceStatus = balances.length >= 3 && failedStep < 0 ? 'PASSED' : 'FAILED';
        balanceDetail = failedStep < 0 ? `${steps.length} of ${steps.length} consecutive balance changes equal the signed amounts` : `line ${body[failedStep + 1].line + 1}: balance change ≠ signed amount (${steps.filter(Boolean).length} of ${steps.length} agree)`;
        gate('balance', 'Running balance agrees with every signed amount', balanceStatus === 'PASSED', balanceDetail);
        if (balanceStatus === 'FAILED') return result('The running balance contradicts the proposed amounts or directions.');
        const m = mapping.find(x => x.field === 'balance'); if (m) m.agreement = headingAgreement(m.heading, 'BALANCE');
    }
    if (!gate('number-format', 'Number format is unambiguous', !ambiguousFormats.length || balanceStatus === 'PASSED', ambiguousFormats.length ? `${ambiguousFormats.join(', ')} would also read every amount${balanceStatus === 'PASSED' ? '; resolved by the running balance' : ''}` : 'No other format reads these amounts')) return result('The number format is ambiguous.');

    // 6b. A table read from a PDF's text layer or by OCR was assembled from positioned words, and OCR can misread a
    // digit: it needs its own arithmetic witness (the running balance, or the totals the document states), and its
    // transactions must be in date order. A stated total that disagrees always fails.
    if (options.extracted) {
        const back = dates.findIndex((d, i) => i > 0 && d! < dates[i - 1]!);
        if (!gate('date-sequence', 'Transactions are in date order', back < 0, back < 0 ? `${dates.length} dates in order` : `line ${body[back].line + 1} is dated before the line above it`)) return result('The extracted transactions are not in date order.');
        const inflow = signed.filter(v => v > 0n).reduce((a, b) => a + b, 0n), outflow = signed.filter(v => v < 0n).reduce((a, b) => a - b, 0n);
        const totalLines = excluded.filter(({ row }) => TOTAL_LINE.test(row.join(' ')) && !BALANCE_LINE.test(row.join(' ')));
        const stated = totalLines.flatMap(({ row }) => row.map(v => parseAmount(v.trim(), numberFormat)).filter((v): v is bigint => typeof v === 'bigint').map(v => v < 0n ? -v : v));
        const totals = !totalLines.length ? 'ABSENT' : stated.includes(inflow) && stated.includes(outflow) ? 'PASSED' : 'FAILED';
        const show = (v: bigint) => cents(v);
        const anchored = totals !== 'FAILED' && (balanceStatus === 'PASSED' || totals === 'PASSED');
        if (!gate('anchor', `Amounts read by ${options.extracted === 'OCR' ? 'OCR' : 'PDF text extraction'} are confirmed arithmetically`, anchored,
            totals === 'FAILED' ? `stated totals (${stated.map(show).join(', ') || 'none readable'}) do not equal money in ${show(inflow)} and money out ${show(outflow)}`
                : totals === 'PASSED' ? `stated totals equal money in ${show(inflow)} and money out ${show(outflow)}${balanceStatus === 'PASSED' ? '; running balance also agrees' : ''}`
                    : balanceStatus === 'PASSED' ? 'running balance agrees with every amount' : 'no running balance and no stated totals: amounts cannot be confirmed')) return result('Extracted amounts could not be confirmed by the document\'s own arithmetic.');
    }

    // 7. Sign confirmation: heading/token vocabulary or the running balance must confirm direction; contradictions always fail.
    const meanings: [keyof typeof c, Meaning][] = rep === 'SPLIT_IN_OUT' ? [['moneyIn', 'IN'], ['moneyOut', 'OUT']] : rep === 'DEBIT_CREDIT' ? [['debit', 'DEBIT'], ['credit', 'CREDIT']] : [];
    const agreements: Agreement[] = [];
    for (const [field, meaning] of meanings) { const m = mapping.find(x => x.field === field)!; m.agreement = headingAgreement(m.heading, meaning); agreements.push(m.agreement); }
    if (rep === 'AMOUNT_AND_DIRECTION') {
        const t = [tokenAgreement(tokens.inflow, 'IN', ledger), tokenAgreement(tokens.outflow, 'OUT', ledger)];
        agreements.push(...t);
        const m = mapping.find(x => x.field === 'direction')!; m.agreement = t.every(a => a === 'AGREES') ? 'AGREES' : t.includes('CONTRADICTS') ? 'CONTRADICTS' : 'OPAQUE';
    }
    // A signed column's convention (+ = cash in) is not assumed: card-style exports print withdrawals as positive.
    if (rep === 'SIGNED_AMOUNT') { const m = mapping.find(x => x.field === 'amount')!; m.agreement = signedAgreement(m.heading); agreements.push(m.agreement); }
    const contradiction = agreements.includes('CONTRADICTS'), vocabulary = agreements.length > 0 && agreements.every(a => a === 'AGREES');
    const signed_ok = !contradiction && (vocabulary || balanceStatus === 'PASSED');
    if (!gate('direction', 'Cash direction independently confirmed', signed_ok,
        contradiction ? `A heading or token names the opposite side${balanceStatus === 'PASSED' ? ' although the running balance agrees: the document is internally inconsistent' : ''}`
            : vocabulary ? `Headings/tokens agree${balanceStatus === 'PASSED' ? ' and the running balance agrees' : ''}` : balanceStatus === 'PASSED' ? 'Opaque headings; confirmed by the running balance'
                : rep === 'SIGNED_AMOUNT' ? 'The heading does not state which sign is cash in, and there is no running balance' : 'Opaque headings and no running balance: direction cannot be confirmed')) return result('Cash direction could not be confirmed independently.');

    // 8. Identity and text fields. Record identity must not depend on whether the model noticed the ID column: an
    // unmapped column whose heading names an identifier and whose every value is a unique identifier is adopted, so
    // reprocessing the same document gives the same canonical rows (and processing ID) whichever proposal was made.
    const columnValues = (i: number) => body.map(r => (r.row[i] ?? '').trim());
    const evidentIds = c.recordId !== null ? [] : header.map((h, i) => i).filter(i => !indices.includes(i) && ID_HEADING.test(header[i] ?? ''))
        .filter(i => { const v = columnValues(i); return v.every(x => ID.test(x)) && new Set(v).size === v.length; });
    const recordId = c.recordId ?? (evidentIds.length === 1 ? evidentIds[0] : null);
    if (c.recordId === null && recordId !== null) {
        mapping.push({ field: 'recordId', column: recordId, heading: header[recordId], agreement: null });
        disclosures.push(`Record ID column "${header[recordId]}" was not in the proposal; adopted because its heading names an identifier and all ${body.length} values are unique.`);
    }
    const ids = recordId !== null ? columnValues(recordId) : body.map(r => `L${r.line + 1}`);
    if (recordId === null) disclosures.push(evidentIds.length > 1 ? `${evidentIds.length} columns could be the record ID (${evidentIds.map(i => `"${header[i]}"`).join(', ')}); IDs are derived from source line numbers (L<line>).` : 'No record ID column; IDs are derived from source line numbers (L<line>).');
    if (!gate('ids', 'Record identifiers are present and unique', ids.every(i => ID.test(i)) && new Set(ids).size === ids.length, recordId === null ? `${ids.length} line-derived IDs` : `${new Set(ids).size} unique of ${ids.length}${c.recordId === null ? ` in adopted column "${header[recordId]}"` : ''}`)) return result('Record identifiers are missing or duplicated.');
    const references = body.map(r => cell(r.row, 'reference')), descriptions = body.map(r => cell(r.row, 'description'));
    // A mapped bank reference column must be filled on every line; a statement without one keeps empty references.
    const textOk = ledger ? references.every(v => v.length <= 64) && descriptions.every(v => v.length <= 300) : references.every(v => (c.reference === null || v) && v.length <= 64) && descriptions.every(v => v && v.length <= 300);
    if (!gate('text', 'References and descriptions are usable', textOk, `${references.filter(Boolean).length} references, ${descriptions.filter(Boolean).length} descriptions`)) return result('References or descriptions are missing.');
    const counterparties = body.map(r => cell(r.row, 'counterparty').slice(0, 120));
    const notStated = counterparties.filter(v => !v).length;
    if (notStated) disclosures.push(`${notStated} rows have no counterparty; recorded as "${COUNTERPARTY_NOT_STATED}".`);

    // 9. Role: whose books these are decides what Debit/Credit and DR/CR mean, so the document's own content
    // (preamble and headings, never transaction cells or the file name) must say so.
    const preamble = table.rows.slice(0, p.headerLine).map(r => r.join(' ')).join(' \n ');
    const roleText = [preamble, header.join(' ')].join(' \n ');
    const roleSeen = roleAgreement(roleText, p.role as 'BANK_STATEMENT' | 'GENERAL_LEDGER');
    if (!gate('role-evidence', `The document itself reads as a ${ledger ? 'ledger' : 'bank statement'}`, roleSeen === 'AGREES',
        roleSeen === 'AGREES' ? 'Title or headings agree' : roleSeen === 'CONTRADICTS' ? `The document reads as a ${ledger ? 'bank statement' : 'ledger'}` : 'Title and headings do not say, or say both')) return result('The document does not confirm the proposed role.');

    // 10. Scope: every value comes from a column with one value, or a literal found verbatim on the cited line.
    const fromColumn = (f: keyof typeof c) => { if (c[f] === null) return null; const values = [...new Set(body.map(r => cell(r.row, f)))]; return values.length === 1 && values[0] ? values[0] : undefined; };
    const fromEvidence = (e: LayoutProposal['scope']['businessId']) => e && lineText(table, e.line).includes(e.literal) ? e.literal.trim() : e ? undefined : null;
    const scopeValue = (f: 'businessId' | 'businessName' | 'currency') => { const col = fromColumn(f); return col !== null ? col : fromEvidence(p.scope[f]); };
    const businessId = scopeValue('businessId'), currencyLiteral = scopeValue('currency'), businessName = scopeValue('businessName');
    const strictCurrency = currencyLiteral ? /\b(MYR|RM)\b/i.test(currencyLiteral) ? 'MYR' : /\b([A-Z]{3})\b/.exec(currencyLiteral)?.[1] ?? (/^(Rs\.?|₹)$/i.test(currencyLiteral) ? 'INR' : undefined) : currencyLiteral;
    // OCR misreads a letter's case ("UsD"). For an OCR table only, a cited currency the strict reading rejects is
    // read from the document's own text on the cited line: exactly one three-letter ISO 4217 code with at most one
    // letter in the wrong case. Disclosed; any other doubt stays quarantined.
    const ocrCurrency = strictCurrency === undefined && options.extracted === 'OCR' && c.currency === null ? ocrCurrencyCode(table, p.scope.currency) : null;
    if (ocrCurrency) disclosures.push(`Currency "${ocrCurrency.read}" on line ${ocrCurrency.line + 1} was read by OCR with a letter in the wrong case; taken as ${ocrCurrency.code}.`);
    const currency = ocrCurrency?.code ?? strictCurrency;
    const periodEvidence = p.scope.statementPeriod, periodLiteral = fromEvidence(periodEvidence);
    const scopeProblems = [
        businessId === null ? 'business ID not stated' : businessId === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/.test(businessId) ? 'business ID evidence not found verbatim or not an identifier' : '',
        currency === null ? 'currency not stated' : currency === undefined ? 'currency evidence not found verbatim' : scopeRule.currencies !== 'ANY' && !scopeRule.currencies.includes(currency) ? `currency ${currency} is not supported (${scopeRule.currencies.join(', ')} only)` : '',
        businessName === undefined ? 'business name evidence not found verbatim' : '',
        periodLiteral === undefined ? 'statement period evidence not found verbatim' : periodLiteral && !(periodMentioned(periodLiteral, months[0]) && periodMentioned(periodLiteral, months.at(-1)!)) ? `stated period "${periodLiteral}" does not match ${period}` : '',
    ].filter(Boolean);
    if (!gate('scope', 'Business, currency and period come from the document', !scopeProblems.length, scopeProblems.length ? scopeProblems.join('; ') : `${businessId} · ${period} · ${currency}${periodLiteral ? ` · stated "${periodLiteral}"` : ''}`)) return result('Business, currency or period could not be established from the document.');
    // 11. Ledger account identity: one account, and the document names it as cash or bank. An account column the
    // model left unmapped still counts, and without one an "Account" line or the headings must name a cash account.
    if (ledger) {
        const unmapped = header.findIndex((h, i) => !indices.includes(i) && ACCOUNT_HEADING.test(h));
        const column = c.account ?? (unmapped >= 0 ? unmapped : null);
        const accountLines = table.rows.slice(0, p.headerLine).filter(r => ACCOUNT_HEADING.test(r[0] ?? '')).map(r => r.filter(Boolean).join(' '));
        const named = column !== null ? [...new Set(body.map(r => (r.row[column] ?? '').trim()))] : accountLines.length ? accountLines : [];
        const fallback = column === null && !named.length ? cashAccountAgreement([preamble, ...repFields.map(f => header[c[f as keyof typeof c]!] ?? '')].join(' \n ')) : null;
        const verdict = named.length === 1 ? cashAccountAgreement(named[0]) : named.length > 1 ? 'MIXED' : fallback === 'AGREES' ? 'AGREES' : 'OPAQUE';
        if (!gate('account', 'Ledger covers one cash or bank account', verdict === 'AGREES',
            verdict === 'MIXED' ? `${named.length} accounts${column !== null && c.account === null ? ` in unmapped column "${header[column]}"` : ''}: ${named.slice(0, 3).join(', ')}`
                : verdict === 'CONTRADICTS' ? `"${named[0]}" is not a cash or bank account` : verdict === 'AGREES' ? (named[0] ?? 'Headings name a cash movement') : named.length ? `"${named[0]}" is not named as a cash or bank account` : 'The document does not name the account')) return result('The ledger is not evidenced as a single cash-account ledger.');
        disclosures.push(`Cash account ${named.length ? `"${named[0]}"` : 'named by the headings'} recorded as 1000-BANK.`);
    }

    // 12. Materialize the Phase 1 canonical layout.
    const net = signed.reduce((n, v) => n + v, 0n);
    const rows = body.map((r, i): Record<string, string> => {
        const s = signed[i], abs = s < 0n ? -s : s;
        return ledger
            ? { LedgerEntryID: ids[i], BusinessID: businessId!, PostingDate: dates[i]!, CashAccount: '1000-BANK', Currency: currency!, LedgerReference: references[i], LedgerMemo: descriptions[i], Counterparty: counterparties[i] || COUNTERPARTY_NOT_STATED, CashAccountDebitMYR: cents(s > 0n ? s : 0n), CashAccountCreditMYR: cents(s < 0n ? -s : 0n), SignedCashMovementMYR: cents(s), CategoryLabel: '' }
            : { BankTransactionID: ids[i], BusinessID: businessId!, BusinessName: (businessName ?? businessId!).slice(0, 120), AccountNumber: '', Currency: currency!, ValueDate: dates[i]!, StatementMonth: dates[i]!.slice(0, 7), BankReference: references[i], BankDescription: descriptions[i], BankDirection: s < 0n ? 'Debit' : 'Credit', BankAmountMYR: cents(abs), SignedCashMovementMYR: cents(s), Counterparty: counterparties[i] || COUNTERPARTY_NOT_STATED, SourceTransactionID: '' };
    });
    const bytes = new TextEncoder().encode(csv(ledger ? CANONICAL_LEDGER_HEADER : CANONICAL_BANK_HEADER, rows));
    const mappingKey = JSON.stringify({ role: p.role, headerLine: p.headerLine, columns: { ...c, recordId }, representation: rep, tokens: { inflow: [...tokens.inflow].sort(), outflow: [...tokens.outflow].sort() }, dateFormat, numberFormat, businessId, currency, period });
    return {
        decision: 'AUTO_ACCEPTED', role: p.role as 'BANK_STATEMENT' | 'GENERAL_LEDGER', checks, mapping, disclosures, mappingKey,
        summary: `${ledger ? 'Cash-account ledger' : 'Bank statement'}: ${body.length} transactions, ${businessId} · ${period} · ${currency}, net ${cents(net)}; ${checks.length} independent checks passed.`,
        canonical: { bytes, rows: body.length, lineage: body.map(r => r.line), net: cents(net), period, businessId: businessId! },
    };
}

/** Gate failures that a misread figure can cause; any other failure is never retried with alternative readings. */
const READING_GATES = new Set(['amounts', 'dates', 'period', 'balance', 'anchor', 'date-sequence', 'number-format']);
/**
 * For a table read by OCR: when the proposal fails only on figures, the second OCR pass's readings of disputed cells
 * are tried, one cell and then two cells at a time. The result is accepted only when exactly one such choice makes
 * every gate pass; the choice is disclosed. A cell both passes read alike is never changed.
 */
export function verifyWithDisputes(table: Table, raw: unknown, disputes: { line: number; column: number; readings: string[] }[], options: GateOptions = {}): VerifiedInterpretation {
    const first = verifyProposal(table, raw, options);
    const failed = first.checks.filter(k => !k.passed).map(k => k.id);
    if (first.decision === 'AUTO_ACCEPTED' || !disputes.length || !failed.length || !failed.every(id => READING_GATES.has(id))) return first;
    const options1 = disputes.slice(0, 60).flatMap(d => d.readings.map(reading => ({ ...d, reading, was: table.rows[d.line]?.[d.column] ?? '' })));
    const attempt = (choice: typeof options1) => {
        if (new Set(choice.map(c => `${c.line}:${c.column}`)).size !== choice.length) return null;
        const rows = table.rows.map(r => [...r]);
        for (const c of choice) if (rows[c.line]) rows[c.line][c.column] = c.reading;
        const v = verifyProposal({ ...table, rows }, raw, options);
        return v.decision === 'AUTO_ACCEPTED' ? { v, choice } : null;
    };
    let found = options1.map(c => attempt([c])).filter(Boolean);
    if (!found.length) found = options1.flatMap((a, i) => options1.slice(i + 1).map(b => attempt([a, b]))).filter(Boolean);
    const tried = `${disputes.length} cell${disputes.length === 1 ? '' : 's'} read differently by the two OCR passes`;
    if (found.length !== 1) {
        first.disclosures.push(`${tried}: ${found.length ? `${found.length} different choices satisfy the checks, so none is taken` : 'no alternative reading satisfies the checks'}.`);
        return first;
    }
    const { v, choice } = found[0]!;
    v.checks.push({ id: 'ocr-readings', label: 'Disputed OCR readings resolved by the document\'s arithmetic', passed: true, detail: choice.map(c => `line ${c.line + 1}: "${c.reading}" not "${c.was}"`).join('; ') });
    v.disclosures.push(`${tried}; exactly one choice satisfies every check: ${choice.map(c => `line ${c.line + 1} read as "${c.reading}" (the other pass read "${c.was}")`).join('; ')}.`);
    return v;
}
