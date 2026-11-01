import {
    OCR_EVIDENCE_VERSION, type AnchorRegion, type AnchorSet, type OcrEvidence, type OcrEvidenceItem, type OcrProposal, type OcrRow,
    type RowKind, type UnanchoredCell,
} from './contracts';

/**
 * Turn a Xiaomi-OCR-0 transcription into provisional, coordinate-anchored evidence.
 * Every populated cell must equal (exactly, after whitespace normalization) one unused text region of an
 * independent reader on the same page, in the same source row and under the same anchored column heading.
 * The box is that reader's box. A row is confirmed by one reader at a time, so all of its coordinates share
 * one coordinate system; the readers are tried in the order given. Anything else is listed as unanchored and
 * keeps `box: null`; no coordinate is invented. The model's text is never repaired, re-cased or fuzzy-matched.
 *
 * Two optional methods (both off by default, so the strict 0.1 behaviour stays reproducible):
 * - `headingGroups`: a reader that prints adjacent headings as one region (`Credit (MYR) Balance (MYR)`) anchors
 *   them as a group. Cells under a group are assigned to a column only by that reader's own geometry: the edges
 *   of its regions under the group must form one cluster per column, clearly separated. Otherwise the cells stay
 *   unresolved (`COLUMN_GROUP_UNRESOLVED`). Boxes are still the reader's whole regions; nothing is split or interpolated.
 * - `crossReaderCells`: when no single reader confirms a whole row, each cell may be confirmed by a different
 *   reader, provided that reader anchored the same row key itself. Each item keeps its own reader's box and
 *   coordinate system, and any column conflict seen by any reader still blocks the row.
 * - `moneySeparators`: a canonical money cell (`36,956.19`) may also be confirmed by a money-shaped region whose
 *   digits are identical and whose grouping/decimal separators differ (`36.956.19`). With two mandatory decimals the
 *   value in cents is unchanged, so the monetary check stays exact. Never applied to dates, references or text.
 */
export type AnchorOptions = { headingGroups?: boolean; crossReaderCells?: boolean; moneySeparators?: boolean };
export const COLUMN_NAMES = ['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance', 'Amount'] as const;
export const SUMMARY_LABELS = ['Opening balance', 'Total debits', 'Total credits', 'Closing balance', 'Number of transactions'] as const;
const MONEY = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;
/** Money as an independent reader may print it: either separator in any position, two decimals. Used to stay conservative. */
export const READER_MONEY = /^\d{1,3}(?:[.,]\d{3})*[.,]\d{2}$/;
const moneyDigits = (s: string) => norm(s).replace(/[.,]/g, '');
export const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
export const columnName = (heading: string) => COLUMN_NAMES.find(c => norm(heading).toLowerCase().startsWith(c.toLowerCase())) ?? null;

type Located = { region: AnchorRegion; index: number; separatorsDiffer?: boolean };
type Via = 'heading-group' | 'column-bands' | 'money-separator';
type Outcome = { column: string; text: string; at: Located | null; reason?: UnanchoredCell['reason']; reader?: PageReader; via?: Via[] };
type Heading = { columns: string[]; at: Located };
const MONEY_COLUMNS = new Set(['Debit', 'Credit', 'Balance', 'Amount']);
const centerX = (b: AnchorRegion['box']) => (b[0] + b[2]) / 2;
const centerY = (b: AnchorRegion['box']) => (b[1] + b[3]) / 2;

/** Page skew estimated from the anchored header line, so rows are compared along the printed baseline. */
function slopeOf(headers: Located[]) {
    if (headers.length < 2) return 0;
    const xs = headers.map(h => centerX(h.region.box)), ys = headers.map(h => centerY(h.region.box));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const den = xs.reduce((n, x) => n + (x - mx) ** 2, 0);
    return den ? xs.reduce((n, x, i) => n + (x - mx) * (ys[i] - my), 0) / den : 0;
}

function classify(cells: Record<string, string>): RowKind {
    if (cells.Date === 'Date' && cells.Reference === 'Reference') return 'HEADER';
    if (/^Balance (?:brought|carried) forward/.test(cells.Description ?? '')) return 'BALANCE_FORWARD';
    if (cells.Reference) return 'TRANSACTION';
    return 'OTHER';
}

/** One independent reader's view of one page: its regions, what it has confirmed, and its column headings. */
class PageReader {
    used = new Set<number>(); headers: Heading[] = []; headersComplete = false; slope = 0;
    private bands = new Map<Heading, number[] | null>();
    constructor(readonly name: AnchorSet['reader'], readonly regions: AnchorRegion[], readonly options: AnchorOptions = {}) {}
    find(text: string): Located[] {
        const open = this.regions.map((region, index) => ({ region, index })).filter(c => !this.used.has(c.index));
        const exact = open.filter(c => norm(c.region.text) === norm(text));
        if (!this.options.moneySeparators || !MONEY.test(norm(text))) return exact;
        const digits = moneyDigits(text);
        return [...exact, ...open.filter(c => norm(c.region.text) !== norm(text) && READER_MONEY.test(norm(c.region.text)) && moneyDigits(c.region.text) === digits).map(c => ({ ...c, separatorsDiffer: true }))];
    }
    sameRow(a: Located, b: Located, tolerance: number) {
        if (a.region.rowKey && b.region.rowKey) return a.region.rowKey === b.region.rowKey;
        const ya = centerY(a.region.box) - this.slope * centerX(a.region.box), yb = centerY(b.region.box) - this.slope * centerX(b.region.box);
        return Math.abs(ya - yb) <= tolerance;
    }
    nearestHeading(at: Located) {
        return this.headers.reduce<{ h: Heading; d: number } | null>((best, h) => {
            const d = Math.abs(centerX(h.at.region.box) - centerX(at.region.box));
            return !best || d < best.d ? { h, d } : best;
        }, null)?.h ?? null;
    }
    /** The column a reader region sits under, by its nearest heading; under a heading group, by the reader's own column bands. */
    columnOf(at: Located): { column: string | null; via?: Via } {
        const h = this.nearestHeading(at);
        if (!h || h.columns.length === 1) return { column: h?.columns[0] ?? null };
        const bands = this.bandsFor(h);
        if (!bands) return { column: null };
        const x = this.edge(h, at.region.box);
        const i = bands.reduce((best, c, k) => (Math.abs(c - x) < Math.abs(bands[best] - x) ? k : best), 0);
        return { column: h.columns[i], via: 'column-bands' };
    }
    /** Right edges for right-aligned money columns, centres otherwise. */
    private edge(h: Heading, box: AnchorRegion['box']) { return h.columns.every(c => MONEY_COLUMNS.has(c)) ? box[2] : centerX(box); }
    /**
     * Column positions under a heading group, from this reader's regions only: below the heading line, nearest to the
     * group, and (for money columns) money-shaped. They must split into one cluster per column at the widest gaps, and
     * every gap must be at least three times the widest cluster and twice the median region height. Otherwise null.
     */
    private bandsFor(h: Heading) {
        if (this.bands.has(h)) return this.bands.get(h)!;
        const money = h.columns.every(c => MONEY_COLUMNS.has(c));
        const baseline = (b: AnchorRegion['box']) => centerY(b) - this.slope * centerX(b);
        const under = this.regions.map((region, index) => ({ region, index }))
            .filter(l => baseline(l.region.box) > baseline(h.at.region.box) && !this.headers.some(x => x.at.index === l.index) && this.nearestHeading(l) === h && (!money || READER_MONEY.test(norm(l.region.text))));
        const xs = under.map(l => this.edge(h, l.region.box)).sort((a, b) => a - b);
        let result: number[] | null = null;
        if (xs.length >= h.columns.length) {
            const cuts = xs.slice(1).map((x, i) => ({ gap: x - xs[i], at: i + 1 })).sort((a, b) => b.gap - a.gap).slice(0, h.columns.length - 1);
            const bounds = [0, ...cuts.map(c => c.at).sort((a, b) => a - b), xs.length];
            const clusters = bounds.slice(1).map((end, k) => xs.slice(bounds[k], end));
            const spread = Math.max(...clusters.map(c => c.at(-1)! - c[0]));
            const heights = under.map(l => l.region.box[3] - l.region.box[1]).sort((a, b) => a - b);
            const minGap = Math.min(...cuts.map(c => c.gap));
            if (minGap >= 3 * spread && minGap >= 2 * heights[Math.floor(heights.length / 2)]) result = clusters.map(c => c.reduce((a, b) => a + b, 0) / c.length);
        }
        this.bands.set(h, result);
        return result;
    }
    /** Column headings: each must match exactly one region; column checks need all of them. */
    anchorHeaders(named: { column: string; text: string }[]): Outcome[] {
        const found = named.map(({ text }) => this.find(text));
        const out: Outcome[] = named.map(({ column, text }, i) => ({ column, text, at: found[i].length === 1 ? found[i][0] : null, reason: found[i].length > 1 ? 'AMBIGUOUS_MATCH' : 'NO_INDEPENDENT_MATCH', reader: this }));
        this.headers = out.filter(o => o.at).map(o => ({ columns: [o.column], at: o.at! }));
        // Adjacent headings with no region of their own may share exactly one region whose text is their exact join.
        if (this.options.headingGroups) for (let i = 0; i < out.length; i++) {
            for (let j = out.length; j > i + 1; j--) {
                const run = out.slice(i, j);
                if (run.some((o, k) => o.at || found[i + k].length)) continue;
                const m = this.find(run.map(o => o.text).join(' '));
                if (m.length !== 1) continue;
                for (const o of run) { o.at = m[0]; o.via = ['heading-group']; }
                this.headers.push({ columns: run.map(o => o.column), at: m[0] });
                i = j - 1; break;
            }
        }
        this.headersComplete = out.every(o => o.at);
        this.slope = slopeOf(this.headers.map(h => h.at));
        for (const o of out) if (o.at) this.used.add(o.at.index);
        return out;
    }
    /** Dry run: anchor a row by its key cell, then every other populated cell inside that row and column. */
    tryRow(row: OcrRow, keyColumn: string, checkColumns: boolean): { outcomes: Outcome[]; conflicts: string[] } {
        const keyMatches = this.find(row.cells[keyColumn]);
        const key = keyMatches.length === 1 ? keyMatches[0] : null;
        const tolerance = key ? Math.max(4, 0.8 * (key.region.box[3] - key.region.box[1])) : 0;
        const taken = new Set<number>(), outcomes: Outcome[] = [], conflicts: string[] = [];
        for (const [column, text] of Object.entries(row.cells)) {
            if (!text) continue;
            if (!key) { outcomes.push({ column, text, at: null, reason: keyMatches.length > 1 ? 'AMBIGUOUS_MATCH' : 'ROW_KEY_UNANCHORED' }); continue; }
            if (column === keyColumn) { outcomes.push({ column, text, at: key, reader: this }); continue; }
            const candidates = this.find(text).filter(c => !taken.has(c.index) && c.index !== key.index && this.sameRow(c, key, tolerance));
            if (candidates.length !== 1) { outcomes.push({ column, text, at: null, reason: candidates.length ? 'AMBIGUOUS_MATCH' : 'NO_INDEPENDENT_MATCH' }); continue; }
            if (checkColumns && !this.headersComplete) { outcomes.push({ column, text, at: null, reason: 'HEADER_UNANCHORED' }); continue; }
            const placed = checkColumns ? this.columnOf(candidates[0]) : { column };
            if (checkColumns && placed.column === null) { outcomes.push({ column, text, at: null, reason: 'COLUMN_GROUP_UNRESOLVED' }); continue; }
            if (placed.column !== column) { outcomes.push({ column, text, at: null, reason: 'COLUMN_MISMATCH' }); continue; }
            const via: Via[] = [...(placed.via ? [placed.via] : []), ...(candidates[0].separatorsDiffer ? ['money-separator' as const] : [])];
            taken.add(candidates[0].index); outcomes.push({ column, text, at: candidates[0], reader: this, via });
        }
        // A blank money cell is only evidence of absence if no independent money region sits under that heading in this row.
        if (key && checkColumns && this.headersComplete && row.kind === 'TRANSACTION') for (const column of ['Debit', 'Credit'] as const) {
            if (!(column in row.cells) || row.cells[column]) continue;
            // A money region under a heading group whose column cannot be resolved also counts: absence is not proven.
            const under = (at: Located) => { const placed = this.columnOf(at).column; return (placed === column || placed === null) && !!this.nearestHeading(at)?.columns.includes(column); };
            if (this.regions.some((region, index) => !this.used.has(index) && !taken.has(index) && READER_MONEY.test(norm(region.text)) && this.sameRow({ region, index }, key, tolerance) && under({ region, index }))) conflicts.push(column);
        }
        return { outcomes, conflicts };
    }
}

export function anchorOcrDocument(proposal: OcrProposal, anchorSets: AnchorSet[], options: AnchorOptions = {}): OcrEvidence {
    const items: OcrEvidenceItem[] = [], rows: OcrRow[] = [], unanchored: UnanchoredCell[] = [], warnings: string[] = [], texts: OcrEvidence['texts'] = [], unclaimed: OcrEvidence['unclaimed'] = [];
    if (!anchorSets.length || anchorSets.some(a => a.sourceSha256 !== proposal.sourceSha256)) throw new Error('ANCHOR_SOURCE_MISMATCH');
    for (const page of proposal.pages) {
        if (page.truncated) warnings.push(`Page ${page.page}: model output reached the token limit; transcription may be incomplete.`);
        const readers = anchorSets.map(a => new PageReader(a.reader, a.pages.find(p => p.page === page.page)?.regions ?? [], options));
        const commit = (row: OcrRow, outcomes: Outcome[], conflicts: string[]) => {
            for (const o of outcomes) {
                const reader = o.at ? o.reader ?? null : null;
                const id = `${proposal.sourceSha256}:ocr0:p${page.page}:${row.table}:r${row.index}:${o.column}`;
                items.push({
                    id, value: o.text, text: o.text, page: page.page, sheet: null, row: row.index, column: o.column, address: null,
                    box: o.at ? o.at.region.box : null, width: o.at ? o.at.region.width : null, height: o.at ? o.at.region.height : null,
                    coordinateSystem: o.at ? o.at.region.coordinateSystem : null, table: `p${page.page}:${row.table}`, header: row.kind === 'HEADER', confidence: null,
                    method: o.at && reader ? `xiaomi-ocr-0+${reader.name}-anchor${(o.via ?? []).map(v => `+${v}`).join('')}` : 'xiaomi-ocr-0-unanchored',
                });
                row.itemIds.push(id);
                if (o.at && reader) reader.used.add(o.at.index); else unanchored.push({ itemId: id, page: page.page, column: o.column, text: o.text, reason: o.reason ?? 'NO_INDEPENDENT_MATCH' });
            }
            for (const column of conflicts) unanchored.push({ itemId: `${proposal.sourceSha256}:ocr0:p${page.page}:${row.table}:r${row.index}:${column}`, page: page.page, column, text: '', reason: 'COLUMN_CONFLICT' });
        };
        /**
         * The first reader that confirms the whole row wins. Otherwise, with `crossReaderCells`, each cell takes the
         * first reader that confirmed it (every such reader anchored the row key itself) and every reader's column
         * conflicts are kept; without it, the best reader's real partial anchors are kept and the rest listed.
         */
        const anchorRow = (row: OcrRow, keyColumn: string, checkColumns: boolean) => {
            const tries = readers.map(reader => reader.tryRow(row, keyColumn, checkColumns));
            const failures = (t: typeof tries[number]) => t.outcomes.filter(o => !o.at).length + t.conflicts.length;
            const whole = tries.find(t => failures(t) === 0);
            if (whole || !options.crossReaderCells) {
                const best = whole ?? tries.reduce((a, b) => (failures(b) < failures(a) ? b : a));
                commit(row, best.outcomes, best.conflicts); return;
            }
            const outcomes = tries[0].outcomes.map((o, i) => tries.map(t => t.outcomes[i]).find(x => x.at) ?? o);
            commit(row, outcomes, [...new Set(tries.flatMap(t => t.conflicts))]);
        };

        page.tables.forEach((table, t) => {
            let headings: (string | null)[] | null = null;
            table.forEach((cellsIn, r) => {
                const named = cellsIn.map(c => columnName(c));
                if (named.includes('Date') && named.includes('Reference')) {
                    headings = named;
                    const heads = cellsIn.flatMap((text, i) => (named[i] ? [{ column: named[i]!, text: norm(text) }] : []));
                    const row: OcrRow = { page: page.page, table: `t${t}`, index: r + 1, kind: 'HEADER', cells: Object.fromEntries(heads.map(h => [h.column, h.text])), itemIds: [] };
                    const results = readers.map(reader => ({ reader, outcomes: reader.anchorHeaders(heads) }));
                    const best = results.find(x => x.reader.headersComplete) ?? results[0];
                    commit(row, best.outcomes.map(o => (best.reader.headersComplete ? o : { ...o, at: null })), []);
                    rows.push(row);
                    return;
                }
                if (!headings) {
                    // Two-cell label/value rows outside the transaction table, such as printed control totals.
                    const label = SUMMARY_LABELS.find(l => norm(cellsIn[0] ?? '') === l);
                    if (label && cellsIn.length >= 2) {
                        const row: OcrRow = { page: page.page, table: `t${t}`, index: r + 1, kind: 'SUMMARY', cells: { Label: label, Value: norm(cellsIn.filter(Boolean).at(-1)!) }, itemIds: [] };
                        anchorRow(row, 'Label', false); rows.push(row);
                    }
                    return;
                }
                const current: (string | null)[] = headings;
                const cells: Record<string, string> = {};
                current.forEach((h, i) => { if (h) cells[h] = norm(cellsIn[i] ?? ''); });
                if (cellsIn.length !== current.length) warnings.push(`Page ${page.page} table ${t} row ${r + 1}: ${cellsIn.length} cells under ${current.length} headings.`);
                // A summary label printed inside the table grid keeps its label/value meaning.
                const label = SUMMARY_LABELS.find(l => Object.values(cells).includes(l));
                const kind: RowKind = label ? 'SUMMARY' : classify(cells);
                const row: OcrRow = { page: page.page, table: `t${t}`, index: r + 1, kind, cells: label ? { Label: label, Value: Object.values(cells).filter(v => v && v !== label).at(-1) ?? '' } : cells, itemIds: [] };
                if (kind === 'SUMMARY') anchorRow(row, 'Label', false);
                else if (kind === 'TRANSACTION') anchorRow(row, 'Reference', true);
                else if (kind === 'BALANCE_FORWARD') anchorRow(row, 'Description', true);
                else commit(row, Object.entries(cells).filter(([, text]) => text).map(([column, text]) => ({ column, text, at: null, reason: 'ROW_KEY_UNANCHORED' })), []);
                rows.push(row);
            });
        });
        for (const line of page.texts) {
            texts.push({ page: page.page, text: line });
            const m = new RegExp(`^(${SUMMARY_LABELS.join('|')})\\s*[:|]?\\s*(\\S+)$`).exec(norm(line));
            if (!m) continue;
            const row: OcrRow = { page: page.page, table: 'text', index: rows.length + 1, kind: 'SUMMARY', cells: { Label: m[1], Value: m[2] }, itemIds: [] };
            anchorRow(row, 'Label', false); rows.push(row);
        }
        // Content the model never transcribed at all (not merely transcribed but unanchorable), from every reader.
        const transcribed = new Set([...page.tables.flat(2), ...page.texts, ...page.texts.flatMap(t => t.split(/\s+/))].map(norm));
        // A reader's differently-separated amount is the same printed value when its digits equal a transcribed amount.
        const transcribedMoney = new Set([...transcribed].filter(t => READER_MONEY.test(t)).map(moneyDigits));
        const seen = new Set<string>();
        for (const reader of readers) reader.regions.forEach((region, index) => {
            const text = norm(region.text);
            if (!reader.used.has(index) && text && !transcribed.has(text) && !(READER_MONEY.test(text) && transcribedMoney.has(moneyDigits(text))) && !seen.has(text)) { seen.add(text); unclaimed.push({ page: page.page, text }); }
        });
    }
    const coverage = unanchored.length || warnings.length || !rows.some(r => r.kind === 'HEADER') ? 'REGIONS_ONLY' : 'TABLE_ROWS';
    return {
        version: OCR_EVIDENCE_VERSION, sourceSha256: proposal.sourceSha256, filename: proposal.filename, receipt: proposal.receipt,
        anchorReaders: anchorSets.map(a => a.reader), items, rows, unanchored, texts, unclaimed, coverage, warnings,
    };
}
