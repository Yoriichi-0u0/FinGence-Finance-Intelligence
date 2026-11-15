/**
 * The rule reader: FinGence's own reading of an unfamiliar layout, with no model. It PROPOSES a layout from the
 * document's headings and labels (the multilingual vocabulary in `lexicon.ts`) and from the shape of its values, in
 * the same form a model's proposal takes, and that proposal is untrusted in exactly the same way: it is accepted only
 * when every gate in `gates.ts` re-derives it from the original bytes. The reader makes ONE proposal and never
 * searches for a layout that happens to pass. When the vocabulary does not cover a document, it abstains and the
 * caller may ask the model instead.
 */
import { DATE_FORMATS, type ModelProposal } from './contracts';
import { guessHeaderLine, type Table } from './evidence';
import { NUMBER_FORMAT_LIST, parseAmount, parseDate, type DateFormat, type NumberFormat } from './formats';
import { ACCOUNT_HEADING, ID, ID_HEADING } from './gates';
import { containsTerm, headingMeanings, roleAgreement, tokenSide, type Meaning } from './lexicon';

export const RULES_VERSION = 'fingence-layout-rules-v1';

// Headings of the text fields (English, Malay, Indonesian, German: the languages the sign vocabulary covers).
const DESCRIPTION = ['description', 'particulars', 'narration', 'details', 'transaction details', 'transaction description', 'memo', 'remarks', 'keterangan', 'butiran', 'perihal', 'uraian', 'catatan', 'verwendungszweck', 'buchungstext', 'beschreibung'];
const REFERENCE = ['reference', 'ref', 'ref no', 'reference no', 'reference number', 'cheque no', 'cheque number', 'chq no', 'chq ref no', 'rujukan', 'no rujukan', 'nombor rujukan', 'referensi', 'no referensi', 'nomor referensi', 'referenz', 'belegnummer'];
const COUNTERPARTY = ['payee', 'payer', 'payee payer', 'counterparty', 'party', 'beneficiary', 'pihak', 'penerima', 'pembayar', 'empfänger', 'auftraggeber'];
/** An amount column whose heading names no side: it needs a direction column, a stated sign convention or a running balance. */
const AMOUNT = ['amount', 'amt', 'transaction amount', 'jumlah', 'amaun', 'nilai', 'nominal', 'betrag'];
// Labels of the lines above the table that state whose document this is.
const BUSINESS_ID = ['business', 'entity', 'customer', 'company', 'pelanggan', 'syarikat', 'entiti', 'nasabah', 'perusahaan', 'customer id', 'customer no', 'customer number', 'client id', 'business id', 'entity code', 'entity id', 'company id', 'company code', 'cif', 'cif no', 'id pelanggan', 'no pelanggan', 'nombor pelanggan', 'kod entiti', 'kod syarikat', 'id perniagaan', 'kode nasabah', 'nomor nasabah', 'id nasabah', 'kode entitas', 'kundennummer'];
const HOLDER = ['business', 'entity', 'customer', 'company', 'pelanggan', 'syarikat', 'entiti', 'nasabah', 'perusahaan', 'account holder', 'account name', 'customer name', 'company name', 'business name', 'entity name', 'pemegang akaun', 'nama akaun', 'nama pelanggan', 'nama syarikat', 'nama nasabah', 'pemilik rekening', 'nama perusahaan', 'kontoinhaber'];
const PERIOD = ['statement period', 'period', 'tempoh penyata', 'tempoh', 'periode', 'periode laporan', 'zeitraum'];
const CURRENCY = ['currency', 'mata wang', 'matawang', 'mata uang', 'währung'];

export type RuleReading = { proposal: ModelProposal; notes: string[] } | { proposal: null; reason: string };
type Evidence = { line: number; literal: string } | null;

/** The share of a column's non-empty values a parser reads; a format "fits" at nine in ten with at least three read. */
function fit<T>(values: string[], parse: (v: string) => T | null | undefined) {
    const read = values.filter(v => { const r = parse(v); return r !== null && r !== undefined; }).length;
    return values.length >= 3 && read >= 3 && read / values.length >= 0.9;
}
/** What follows a label on its own line, exactly as the line states it (so it can be cited verbatim), or null. */
function stated(table: Table, upTo: number, labels: string[], accept: (literal: string) => boolean = () => true): Evidence {
    for (let line = 0; line < upTo; line++) {
        const row = table.rows[line] ?? [], cells = row.map(c => c.trim()).filter(Boolean);
        if (!cells.length) continue;
        // "Label | value" in two cells, or "Label: value" in one.
        const colon = cells.length === 1 ? cells[0].indexOf(':') : -1;
        const label = cells.length > 1 ? cells[0] : colon > 0 ? cells[0].slice(0, colon) : cells[0];
        if (!containsTerm(label, labels)) continue;
        const text = row.join(' '), start = cells.length > 1 ? text.indexOf(cells[0]) + cells[0].length : colon > 0 ? text.indexOf(cells[0]) + colon + 1 : -1;
        const literal = start < 0 ? '' : text.slice(start).replace(/^[\s:]+/, '').trimEnd();
        if (literal && accept(literal)) return { line, literal: literal.slice(0, 160).trimEnd() };
    }
    return null;
}

export function proposeByRules(table: Table): RuleReading {
    const rows = table.rows;
    // 1. The header: the first line that names a date and a money or balance column; otherwise the first all-text line of the table's width.
    const named = (row: string[], meaning: Meaning) => row.some(h => headingMeanings(h).includes(meaning));
    const money: Meaning[] = ['IN', 'OUT', 'DEBIT', 'CREDIT', 'BALANCE', 'SIGNED'];
    const byWords = rows.slice(0, 200).findIndex(r => r.filter(Boolean).length >= 3 && named(r, 'DATE') && (money.some(m => named(r, m)) || r.some(h => containsTerm(h, AMOUNT))));
    const headerLine = byWords >= 0 ? byWords : guessHeaderLine(rows);
    const header = (rows[headerLine] ?? []).map(h => h.trim()), width = header.length;
    if (width < 3) return { proposal: null, reason: 'No table header was found.' };
    const below = rows.slice(headerLine + 1).filter(r => r.length === width);
    const column = (i: number) => below.map(r => (r[i] ?? '').trim()).filter(Boolean);
    const meanings = header.map(h => headingMeanings(h));

    // 2. The date column and its format: a heading that names a date, with values one format reads.
    const formatOf = (i: number) => DATE_FORMATS.filter(f => fit(column(i), v => parseDate(v, f)));
    const dateColumns = header.map((_, i) => i).filter(i => formatOf(i).length);
    const date = dateColumns.find(i => meanings[i].includes('DATE')) ?? dateColumns[0];
    if (date === undefined) return { proposal: null, reason: 'No column of dates was found under the header.' };
    const body = below.filter(r => formatOf(date).some(f => parseDate((r[date] ?? '').trim(), f)));
    const values = (i: number) => body.map(r => (r[i] ?? '').trim()).filter(Boolean);
    // Where two orders read every date (DD/MM and MM/DD), the one that keeps the statement in date order over the fewest months is proposed; the gates decide whether it is unambiguous.
    const spread = (f: DateFormat) => { const ds = values(date).map(v => parseDate(v, f)).filter((d): d is string => !!d); return { months: new Set(ds.map(d => d.slice(0, 7))).size, ordered: ds.every((d, i) => i === 0 || d >= ds[i - 1]) }; };
    const dateFormat = [...formatOf(date)].sort((a, b) => Number(spread(b).ordered) - Number(spread(a).ordered) || spread(a).months - spread(b).months)[0];

    // 3. Whose books: the document's own title and headings must say so (the same evidence the role gate asks for).
    const roleText = [rows.slice(0, headerLine).map(r => r.join(' ')).join(' \n '), header.join(' ')].join(' \n ');
    const role = roleAgreement(roleText, 'BANK_STATEMENT') === 'AGREES' ? 'BANK_STATEMENT' as const : roleAgreement(roleText, 'GENERAL_LEDGER') === 'AGREES' ? 'GENERAL_LEDGER' as const : null;
    if (!role) return { proposal: null, reason: 'The title and headings do not say, in words the rules know, whether this is a bank statement or a ledger.' };
    const ledger = role === 'GENERAL_LEDGER';

    // 4. Money columns, by what their headings name.
    const used = new Set<number>([date]);
    const take = (i: number | undefined) => { if (i !== undefined) used.add(i); return i; };
    const free = (i: number) => !used.has(i);
    const all = header.map((_, i) => i);
    const direction = take(all.find(i => free(i) && (() => { const distinct = [...new Set(values(i))]; return distinct.length >= 1 && distinct.length <= 6 && distinct.every(t => tokenSide(t) !== null) && values(i).length >= body.length * 0.9; })()));
    const balance = take(all.find(i => free(i) && meanings[i].includes('BALANCE')));
    const only = (i: number, own: Meaning, other: Meaning) => free(i) && meanings[i].includes(own) && !meanings[i].includes(other);
    const [inMeaning, outMeaning]: [Meaning, Meaning] = ledger ? ['DEBIT', 'CREDIT'] : ['IN', 'OUT'];
    const inColumn = direction === undefined ? all.find(i => only(i, inMeaning, outMeaning)) : undefined, outColumn = direction === undefined ? all.find(i => only(i, outMeaning, inMeaning)) : undefined;
    const amount = inColumn !== undefined && outColumn !== undefined ? undefined : all.find(i => free(i) && (meanings[i].includes('SIGNED') || containsTerm(header[i], AMOUNT)));
    let moneyMapping: Extract<ModelProposal['layout'], { role: 'BANK_STATEMENT' }>['money'] | Extract<ModelProposal['layout'], { role: 'GENERAL_LEDGER' }>['money'];
    const moneyColumns: number[] = [];
    if (inColumn !== undefined && outColumn !== undefined) {
        take(inColumn); take(outColumn); moneyColumns.push(inColumn, outColumn);
        moneyMapping = ledger ? { representation: 'DEBIT_CREDIT', debit: inColumn, credit: outColumn } : { representation: 'SPLIT_IN_OUT', moneyIn: inColumn, moneyOut: outColumn };
    } else if (amount !== undefined && direction !== undefined) {
        take(amount); moneyColumns.push(amount);
        // A direction literal is read for whose books these are: on a statement CR is cash in, in a cash ledger DR is.
        const literals = [...new Set(values(direction))], cashIn = (t: string) => (tokenSide(t) === 'IN') !== ledger;
        const inflowTokens = literals.filter(cashIn), outflowTokens = literals.filter(t => !cashIn(t));
        if (!inflowTokens.length || !outflowTokens.length) return { proposal: null, reason: 'The direction column names only one side.' };
        moneyMapping = { representation: 'AMOUNT_AND_DIRECTION', amount, direction, inflowTokens, outflowTokens };
    } else if (amount !== undefined) {
        take(amount); moneyColumns.push(amount);
        moneyMapping = { representation: 'SIGNED_AMOUNT', amount };
    } else return { proposal: null, reason: 'No amount columns were recognised by their headings.' };

    // 5. The number format every money figure is written in.
    const literals = [...moneyColumns, ...(balance !== undefined ? [balance] : [])].flatMap(values);
    const reads = NUMBER_FORMAT_LIST.filter(f => literals.length > 0 && literals.every(v => typeof parseAmount(v, f) === 'bigint'));
    const shaped: NumberFormat = literals.some(v => /,\d{1,2}\)?$/.test(v.trim()) && !/\.\d{1,2}\)?$/.test(v.trim())) ? 'DOT_THOUSANDS_COMMA_DECIMAL' : literals.some(v => /\d,\d{3}/.test(v)) ? 'COMMA_THOUSANDS_DOT_DECIMAL' : 'PLAIN';
    const numberFormat = reads.includes(shaped) ? shaped : reads[0] ?? null;
    if (!numberFormat) return { proposal: null, reason: 'The amounts are not all written in one number format the rules know.' };

    // 6. Text columns.
    const byHeading = (terms: string[]) => take(all.find(i => free(i) && containsTerm(header[i], terms)));
    const unique = (i: number) => { const v = body.map(r => (r[i] ?? '').trim()); return v.every(x => ID.test(x)) && new Set(v).size === v.length; };
    const recordId = take(all.find(i => free(i) && ID_HEADING.test(header[i]) && unique(i)));
    const account = ledger ? take(all.find(i => free(i) && ACCOUNT_HEADING.test(header[i]))) : undefined;
    const reference = byHeading(REFERENCE), counterparty = byHeading(COUNTERPARTY);
    const longest = () => all.filter(free).map(i => ({ i, length: values(i).reduce((n, v) => n + v.length, 0) / Math.max(1, values(i).length) })).sort((a, b) => b.length - a.length)[0]?.i;
    const description = byHeading(DESCRIPTION) ?? take(longest());
    if (description === undefined) return { proposal: null, reason: 'No description column was found.' };

    // 7. Whose document, in which currency and for which period: cited verbatim from the lines above the table.
    // An identifier is one token of letters and digits ("DEMO-001", "CUST-151856"); a name is anything else after a holder label.
    const identifier = (literal: string) => literal.split(/\s+/).find(t => /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/.test(t) && /\d/.test(t));
    const idLine = stated(table, headerLine, BUSINESS_ID, literal => !!identifier(literal));
    const businessId: Evidence = idLine ? { line: idLine.line, literal: identifier(idLine.literal)! } : null;
    const businessName = stated(table, headerLine, HOLDER, literal => !identifier(literal));
    const currencyLine = stated(table, headerLine, CURRENCY);
    const code = (text: string) => /\b(?:MYR|RM)\b/.exec(text)?.[0] ?? /\b[A-Z]{3}\b/.exec(text)?.[0];
    // Without a currency line, the code a money heading carries in brackets ("Debit (RM)", "Balance (USD)") is the statement of it.
    const inHeading = [...moneyColumns, ...(balance !== undefined ? [balance] : [])].map(i => /\(([A-Za-z]{2,3})\)/.exec(header[i])?.[1]).find(c => c && code(c));
    const currency: Evidence = currencyLine ? { line: currencyLine.line, literal: code(currencyLine.literal) ?? currencyLine.literal } : inHeading ? { line: headerLine, literal: inHeading } : null;
    const statementPeriod = stated(table, headerLine, PERIOD);

    const columns = { recordId: recordId ?? null, date, reference: reference ?? null, description, counterparty: counterparty ?? null, balance: balance ?? null, currency: null, businessId: null, businessName: null };
    const shared = { headerLine, dateFormat, numberFormat, scope: { businessId, businessName, currency, statementPeriod } };
    const unresolved = [!businessId ? 'No line states a business or customer identifier.' : '', !currency ? 'No line or heading states the currency.' : ''].filter(Boolean);
    const rationale = `Read by FinGence's layout rules (${RULES_VERSION}): headings on line ${headerLine + 1}, ${moneyMapping.representation}, ${dateFormat}, ${numberFormat}.`;
    const layout = ledger
        ? { role: 'GENERAL_LEDGER' as const, ...shared, columns: { ...columns, account: account ?? null }, money: moneyMapping as Extract<ModelProposal['layout'], { role: 'GENERAL_LEDGER' }>['money'] }
        : { role: 'BANK_STATEMENT' as const, ...shared, columns, money: moneyMapping as Extract<ModelProposal['layout'], { role: 'BANK_STATEMENT' }>['money'] };
    return { proposal: { layout, rationale, unresolved }, notes: [`Header on line ${headerLine + 1}; ${body.length} dated lines.`] };
}
