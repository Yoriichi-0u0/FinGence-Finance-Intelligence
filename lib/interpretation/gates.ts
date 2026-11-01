/**
 * Deterministic acceptance gates for a model's layout proposal. Every check is recomputed from the
 * ORIGINAL bytes; the model's confidence or rationale is never an input. A proposal is accepted only
 * when all gates pass, and is then materialized into the Phase 1 canonical CSV layout so the rest of
 * the pipeline (normalizer, second parser, matcher, analytics) runs unchanged.
 */
import { proposalSchema, type LayoutProposal } from './contracts';
import { NUMBER_FORMAT_LIST, MALAY_MONTH_NAMES, MONTH_NAMES, SWAPPED, cents, parseAmount, parseDate, type DateFormat } from './formats';
import { headingAgreement, tokenAgreement, type Agreement, type Meaning } from './lexicon';
import type { Table } from './evidence';

export type GateCheck = { id: string; label: string; passed: boolean; detail: string };
export type FieldMapping = { field: string; column: number; heading: string; agreement: Agreement | 'CONVENTION' | null };
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
function periodMentioned(literal: string, period: string) {
    const [y, m] = period.split('-'), text = literal.toLowerCase();
    const names = [MONTH_NAMES[+m - 1], MONTH_NAMES[+m - 1].slice(0, 3), MALAY_MONTH_NAMES[+m - 1]];
    return [period, ...names.flatMap(n => [`${n} ${y}`, `${n}-${y}`]), `/${m}/${y}`, `-${m}-${y}`, `.${m}.${y}`, `${m}/${y}`, `/${+m}/${y}`]
        .some(s => text.includes(s.toLowerCase()));
}

export function verifyProposal(table: Table, raw: unknown): VerifiedInterpretation {
    const checks: GateCheck[] = [], disclosures: string[] = [], mapping: FieldMapping[] = [];
    const result = (summary: string): VerifiedInterpretation => ({ decision: 'QUARANTINED', role: null, summary, checks, mapping, disclosures, canonical: null, mappingKey: null });
    const gate = (id: string, label: string, passed: boolean, detail: string) => { checks.push({ id, label, passed, detail }); return passed; };

    const parsed = proposalSchema.safeParse(raw);
    if (!gate('schema', 'Proposal matches the strict interpretation schema', parsed.success, parsed.success ? 'Valid' : parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; '))) return result('The model response was not a valid interpretation proposal.');
    const p: LayoutProposal = parsed.data!, c = p.columns, ledger = p.role === 'GENERAL_LEDGER';
    if (!gate('role', 'Document is a supported bank statement or cash-account ledger', p.role !== 'UNSUPPORTED', p.role === 'UNSUPPORTED' ? `The model abstained: ${p.unresolved.join('; ') || p.rationale || 'unsupported document'}` : p.role)) return result('The model reported that this is not a supported financial document.');

    // 1. Table structure.
    const header = table.rows[p.headerLine] ?? [], width = header.length;
    if (!gate('structure', 'Header row exists with at least three named columns', width >= 3 && header.filter(Boolean).length >= 3, `Line ${p.headerLine + 1}: ${header.slice(0, 8).join(' | ') || 'missing'}`)) return result('The proposed header row is not a table header.');
    for (const [field, column] of Object.entries(c)) if (column !== null) mapping.push({ field, column, heading: header[column] ?? '(out of range)', agreement: null });

    // 2. Mapping integrity for the declared role and representation.
    const allowed = ledger ? ['SIGNED_AMOUNT', 'AMOUNT_AND_DIRECTION', 'DEBIT_CREDIT'] : ['SIGNED_AMOUNT', 'AMOUNT_AND_DIRECTION', 'SPLIT_IN_OUT'];
    const rep = p.representation, repFields: readonly string[] = rep ? REPRESENTATION_FIELDS[rep] : [];
    const required = ['date', 'description', 'reference', ...repFields] as (keyof typeof c)[];
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
    const isTxn = ({ row }: { row: string[] }) => row.length === width && !!cell(row, 'date') && !(repFields.every(f => !cell(row, f as keyof typeof c)) && BALANCE_LINE.test(cell(row, 'description')));
    const first = candidates.findIndex(isTxn), last = candidates.findLastIndex(isTxn);
    const body = first < 0 ? [] : candidates.slice(first, last + 1);
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
    const months = [...new Set(dates.map(d => d!.slice(0, 7)))];
    if (!gate('period', 'All transactions fall within one month', months.length === 1, months.join(', '))) return result('The document spans more than one month.');
    const period = months[0];
    const alternative = body.map(r => swappedReading(cell(r.row, 'date'), dateFormat));
    const alternativeViable = alternative.every(Boolean) && alternative.some((d, i) => d !== dates[i]);
    const alternativeMonths = new Set(alternative.map(d => d?.slice(0, 7)));
    if (!gate('date-order', 'Day/month order is unambiguous', !alternativeViable || alternativeMonths.size > 1, !alternativeViable ? 'The swapped day/month reading is invalid for at least one date' : alternativeMonths.size > 1 ? `The swapped reading would span ${alternativeMonths.size} months, which a one-month statement cannot` : 'Both readings are valid one-month statements')) return result('The date order is ambiguous.');

    // 5. Amounts and direction under the declared representation.
    const tokens = { inflow: p.directionTokens.inflow.map(t => t.trim().toUpperCase()), outflow: p.directionTokens.outflow.map(t => t.trim().toUpperCase()) };
    const signed: bigint[] = [], problems: string[] = [];
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
            if (a === null || b === null || (a ?? 0n) < 0n || (b ?? 0n) < 0n || !one) problems.push(`line ${line + 1}: "${cell(row, inField)}" / "${cell(row, outField)}" ${one ? 'not valid amounts' : 'must have exactly one non-zero side'}`);
            else signed.push((a ?? 0n) - (b ?? 0n));
        }
    }
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

    // 7. Sign confirmation: heading/token vocabulary or the running balance must confirm direction; contradictions always fail.
    const meanings: [keyof typeof c, Meaning][] = rep === 'SPLIT_IN_OUT' ? [['moneyIn', 'IN'], ['moneyOut', 'OUT']] : rep === 'DEBIT_CREDIT' ? [['debit', 'DEBIT'], ['credit', 'CREDIT']] : [];
    const agreements: Agreement[] = [];
    for (const [field, meaning] of meanings) { const m = mapping.find(x => x.field === field)!; m.agreement = headingAgreement(m.heading, meaning); agreements.push(m.agreement); }
    if (rep === 'AMOUNT_AND_DIRECTION') {
        const t = [tokenAgreement(tokens.inflow, 'IN', ledger), tokenAgreement(tokens.outflow, 'OUT', ledger)];
        agreements.push(...t);
        const m = mapping.find(x => x.field === 'direction')!; m.agreement = t.every(a => a === 'AGREES') ? 'AGREES' : t.includes('CONTRADICTS') ? 'CONTRADICTS' : 'OPAQUE';
    }
    if (rep === 'SIGNED_AMOUNT') { const m = mapping.find(x => x.field === 'amount')!; m.agreement = 'CONVENTION'; }
    const contradiction = agreements.includes('CONTRADICTS'), vocabulary = agreements.length > 0 && agreements.every(a => a === 'AGREES');
    const signed_ok = !contradiction && (vocabulary || balanceStatus === 'PASSED' || rep === 'SIGNED_AMOUNT');
    if (!gate('direction', 'Cash direction independently confirmed', signed_ok,
        contradiction ? `A heading or token names the opposite side${balanceStatus === 'PASSED' ? ' although the running balance agrees: the document is internally inconsistent' : ''}`
            : vocabulary ? `Headings/tokens agree${balanceStatus === 'PASSED' ? ' and the running balance agrees' : ''}` : balanceStatus === 'PASSED' ? 'Opaque headings; confirmed by the running balance'
                : rep === 'SIGNED_AMOUNT' ? 'Signed amounts: negative = cash out (standard convention)' : 'Opaque headings and no running balance: direction cannot be confirmed')) return result('Cash direction could not be confirmed independently.');

    // 8. Identity and text fields.
    const ids = c.recordId !== null ? body.map(r => cell(r.row, 'recordId')) : body.map(r => `L${r.line + 1}`);
    if (c.recordId === null) disclosures.push('No record ID column; IDs are derived from source line numbers (L<line>).');
    if (!gate('ids', 'Record identifiers are present and unique', ids.every(i => ID.test(i)) && new Set(ids).size === ids.length, c.recordId === null ? `${ids.length} line-derived IDs` : `${new Set(ids).size} unique of ${ids.length}`)) return result('Record identifiers are missing or duplicated.');
    const references = body.map(r => cell(r.row, 'reference')), descriptions = body.map(r => cell(r.row, 'description'));
    const textOk = ledger ? references.every(v => v.length <= 64) && descriptions.every(v => v.length <= 300) : references.every(v => v && v.length <= 64) && descriptions.every(v => v && v.length <= 300);
    if (!gate('text', 'References and descriptions are usable', textOk, `${references.filter(Boolean).length} references, ${descriptions.filter(Boolean).length} descriptions`)) return result('References or descriptions are missing.');
    const counterparties = body.map(r => cell(r.row, 'counterparty').slice(0, 120));
    const notStated = counterparties.filter(v => !v).length;
    if (notStated) disclosures.push(`${notStated} rows have no counterparty; recorded as "${COUNTERPARTY_NOT_STATED}".`);

    // 9. Scope: every value comes from a column with one value, or a literal found verbatim on the cited line.
    const fromColumn = (f: keyof typeof c) => { if (c[f] === null) return null; const values = [...new Set(body.map(r => cell(r.row, f)))]; return values.length === 1 && values[0] ? values[0] : undefined; };
    const fromEvidence = (e: LayoutProposal['scope']['businessId']) => e && lineText(table, e.line).includes(e.literal) ? e.literal.trim() : e ? undefined : null;
    const scopeValue = (f: 'businessId' | 'businessName' | 'currency') => { const col = fromColumn(f); return col !== null ? col : fromEvidence(p.scope[f]); };
    const businessId = scopeValue('businessId'), currencyLiteral = scopeValue('currency'), businessName = scopeValue('businessName');
    const currency = currencyLiteral ? /\b(MYR|RM)\b/i.test(currencyLiteral) ? 'MYR' : /^[A-Z]{3}$/.test(currencyLiteral) ? currencyLiteral : undefined : currencyLiteral;
    const periodEvidence = p.scope.statementPeriod, periodLiteral = fromEvidence(periodEvidence);
    const scopeProblems = [
        businessId === null ? 'business ID not stated' : businessId === undefined || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/.test(businessId) ? 'business ID evidence not found verbatim or not an identifier' : '',
        currency === null ? 'currency not stated' : currency === undefined ? 'currency evidence not found verbatim' : currency !== 'MYR' ? `currency ${currency} is not supported (MYR only)` : '',
        businessName === undefined ? 'business name evidence not found verbatim' : '',
        periodLiteral === undefined ? 'statement period evidence not found verbatim' : periodLiteral && !periodMentioned(periodLiteral, period) ? `stated period "${periodLiteral}" does not match ${period}` : '',
    ].filter(Boolean);
    if (!gate('scope', 'Business, currency and period come from the document', !scopeProblems.length, scopeProblems.length ? scopeProblems.join('; ') : `${businessId} · ${period} · ${currency}${periodLiteral ? ` · stated "${periodLiteral}"` : ''}`)) return result('Business, currency or period could not be established from the document.');
    if (ledger && c.account !== null) {
        const accounts = [...new Set(body.map(r => cell(r.row, 'account')))];
        if (!gate('account', 'Ledger covers a single cash account', accounts.length === 1, accounts.slice(0, 3).join(', '))) return result('The ledger mixes accounts; only a single cash-account ledger is supported.');
        disclosures.push(`Cash account "${accounts[0]}" recorded as 1000-BANK.`);
    } else if (ledger) disclosures.push('No account column; the whole ledger is treated as the cash account, as its role states.');

    // 10. Materialize the Phase 1 canonical layout.
    const net = signed.reduce((n, v) => n + v, 0n);
    const rows = body.map((r, i): Record<string, string> => {
        const s = signed[i], abs = s < 0n ? -s : s;
        return ledger
            ? { LedgerEntryID: ids[i], BusinessID: businessId!, PostingDate: dates[i]!, CashAccount: '1000-BANK', Currency: 'MYR', LedgerReference: references[i], LedgerMemo: descriptions[i], Counterparty: counterparties[i] || COUNTERPARTY_NOT_STATED, CashAccountDebitMYR: cents(s > 0n ? s : 0n), CashAccountCreditMYR: cents(s < 0n ? -s : 0n), SignedCashMovementMYR: cents(s), CategoryLabel: '' }
            : { BankTransactionID: ids[i], BusinessID: businessId!, BusinessName: (businessName ?? businessId!).slice(0, 120), AccountNumber: '', Currency: 'MYR', ValueDate: dates[i]!, StatementMonth: period, BankReference: references[i], BankDescription: descriptions[i], BankDirection: s < 0n ? 'Debit' : 'Credit', BankAmountMYR: cents(abs), SignedCashMovementMYR: cents(s), Counterparty: counterparties[i] || COUNTERPARTY_NOT_STATED, SourceTransactionID: '' };
    });
    const bytes = new TextEncoder().encode(csv(ledger ? CANONICAL_LEDGER_HEADER : CANONICAL_BANK_HEADER, rows));
    const mappingKey = JSON.stringify({ role: p.role, headerLine: p.headerLine, columns: c, representation: rep, tokens: { inflow: [...tokens.inflow].sort(), outflow: [...tokens.outflow].sort() }, dateFormat, numberFormat, businessId, currency, period });
    return {
        decision: 'AUTO_ACCEPTED', role: p.role as 'BANK_STATEMENT' | 'GENERAL_LEDGER', checks, mapping, disclosures, mappingKey,
        summary: `${ledger ? 'Cash-account ledger' : 'Bank statement'}: ${body.length} transactions, ${businessId} · ${period} · MYR, net ${cents(net)}; ${checks.length} independent checks passed.`,
        canonical: { bytes, rows: body.length, lineage: body.map(r => r.line), net: cents(net), period, businessId: businessId! },
    };
}
