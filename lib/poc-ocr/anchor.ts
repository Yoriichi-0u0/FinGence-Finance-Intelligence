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
 */
export const COLUMN_NAMES = ['Date', 'Reference', 'Description', 'Debit', 'Credit', 'Balance', 'Amount'] as const;
export const SUMMARY_LABELS = ['Opening balance', 'Total debits', 'Total credits', 'Closing balance', 'Number of transactions'] as const;
const MONEY = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;
export const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
export const columnName = (heading: string) => COLUMN_NAMES.find(c => norm(heading).toLowerCase().startsWith(c.toLowerCase())) ?? null;

type Located = { region: AnchorRegion; index: number };
type Outcome = { column: string; text: string; at: Located | null; reason?: UnanchoredCell['reason'] };
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
    used = new Set<number>(); headers: { column: string; at: Located }[] = []; headersComplete = false; slope = 0;
    constructor(readonly name: AnchorSet['reader'], readonly regions: AnchorRegion[]) {}
    find(text: string) { return this.regions.map((region, index) => ({ region, index })).filter(c => !this.used.has(c.index) && norm(c.region.text) === norm(text)); }
    sameRow(a: Located, b: Located, tolerance: number) {
        if (a.region.rowKey && b.region.rowKey) return a.region.rowKey === b.region.rowKey;
        const ya = centerY(a.region.box) - this.slope * centerX(a.region.box), yb = centerY(b.region.box) - this.slope * centerX(b.region.box);
        return Math.abs(ya - yb) <= tolerance;
    }
    nearestColumn(at: Located) {
        return this.headers.reduce<{ column: string; d: number } | null>((best, h) => {
            const d = Math.abs(centerX(h.at.region.box) - centerX(at.region.box));
            return !best || d < best.d ? { column: h.column, d } : best;
        }, null)?.column ?? null;
    }
    /** Column headings: each must match exactly one region; column checks need all of them. */
    anchorHeaders(named: { column: string; text: string }[]): Outcome[] {
        const out = named.map(({ column, text }) => { const m = this.find(text); return { column, text, at: m.length === 1 ? m[0] : null, reason: m.length > 1 ? 'AMBIGUOUS_MATCH' as const : 'NO_INDEPENDENT_MATCH' as const }; });
        this.headers = out.filter(o => o.at).map(o => ({ column: o.column, at: o.at! }));
        this.headersComplete = this.headers.length === named.length;
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
            if (column === keyColumn) { outcomes.push({ column, text, at: key }); continue; }
            const candidates = this.find(text).filter(c => !taken.has(c.index) && c.index !== key.index && this.sameRow(c, key, tolerance));
            if (candidates.length !== 1) { outcomes.push({ column, text, at: null, reason: candidates.length ? 'AMBIGUOUS_MATCH' : 'NO_INDEPENDENT_MATCH' }); continue; }
            if (checkColumns && !this.headersComplete) { outcomes.push({ column, text, at: null, reason: 'HEADER_UNANCHORED' }); continue; }
            if (checkColumns && this.nearestColumn(candidates[0]) !== column) { outcomes.push({ column, text, at: null, reason: 'COLUMN_MISMATCH' }); continue; }
            taken.add(candidates[0].index); outcomes.push({ column, text, at: candidates[0] });
        }
        // A blank money cell is only evidence of absence if no independent money region sits under that heading in this row.
        if (key && checkColumns && this.headersComplete && row.kind === 'TRANSACTION') for (const column of ['Debit', 'Credit'] as const) {
            if (!(column in row.cells) || row.cells[column]) continue;
            if (this.regions.some((region, index) => !this.used.has(index) && !taken.has(index) && MONEY.test(norm(region.text)) && this.sameRow({ region, index }, key, tolerance) && this.nearestColumn({ region, index }) === column)) conflicts.push(column);
        }
        return { outcomes, conflicts };
    }
}

export function anchorOcrDocument(proposal: OcrProposal, anchorSets: AnchorSet[]): OcrEvidence {
    const items: OcrEvidenceItem[] = [], rows: OcrRow[] = [], unanchored: UnanchoredCell[] = [], warnings: string[] = [], texts: OcrEvidence['texts'] = [], unclaimed: OcrEvidence['unclaimed'] = [];
    if (!anchorSets.length || anchorSets.some(a => a.sourceSha256 !== proposal.sourceSha256)) throw new Error('ANCHOR_SOURCE_MISMATCH');
    for (const page of proposal.pages) {
        if (page.truncated) warnings.push(`Page ${page.page}: model output reached the token limit; transcription may be incomplete.`);
        const readers = anchorSets.map(a => new PageReader(a.reader, a.pages.find(p => p.page === page.page)?.regions ?? []));
        const commit = (row: OcrRow, reader: PageReader | null, outcomes: Outcome[], conflicts: string[]) => {
            for (const o of outcomes) {
                const id = `${proposal.sourceSha256}:ocr0:p${page.page}:${row.table}:r${row.index}:${o.column}`;
                items.push({
                    id, value: o.text, text: o.text, page: page.page, sheet: null, row: row.index, column: o.column, address: null,
                    box: o.at ? o.at.region.box : null, width: o.at ? o.at.region.width : null, height: o.at ? o.at.region.height : null,
                    coordinateSystem: o.at ? o.at.region.coordinateSystem : null, table: `p${page.page}:${row.table}`, header: row.kind === 'HEADER', confidence: null,
                    method: o.at && reader ? `xiaomi-ocr-0+${reader.name}-anchor` : 'xiaomi-ocr-0-unanchored',
                });
                row.itemIds.push(id);
                if (o.at && reader) reader.used.add(o.at.index); else unanchored.push({ itemId: id, page: page.page, column: o.column, text: o.text, reason: o.reason ?? 'NO_INDEPENDENT_MATCH' });
            }
            for (const column of conflicts) unanchored.push({ itemId: `${proposal.sourceSha256}:ocr0:p${page.page}:${row.table}:r${row.index}:${column}`, page: page.page, column, text: '', reason: 'COLUMN_CONFLICT' });
        };
        /** The first reader that confirms the whole row wins; otherwise the best reader's real partial anchors are kept and the rest listed. */
        const anchorRow = (row: OcrRow, keyColumn: string, checkColumns: boolean) => {
            const tries = readers.map(reader => ({ reader, ...reader.tryRow(row, keyColumn, checkColumns) }));
            const failures = (t: typeof tries[number]) => t.outcomes.filter(o => !o.at).length + t.conflicts.length;
            const best = tries.find(t => failures(t) === 0) ?? tries.reduce((a, b) => (failures(b) < failures(a) ? b : a));
            commit(row, best.reader, best.outcomes, best.conflicts);
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
                    commit(row, best.reader.headersComplete ? best.reader : null, best.outcomes.map(o => (best.reader.headersComplete ? o : { ...o, at: null })), []);
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
                else commit(row, null, Object.entries(cells).filter(([, text]) => text).map(([column, text]) => ({ column, text, at: null, reason: 'ROW_KEY_UNANCHORED' })), []);
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
        const seen = new Set<string>();
        for (const reader of readers) reader.regions.forEach((region, index) => {
            const text = norm(region.text);
            if (!reader.used.has(index) && text && !transcribed.has(text) && !seen.has(text)) { seen.add(text); unclaimed.push({ page: page.page, text }); }
        });
    }
    const coverage = unanchored.length || warnings.length || !rows.some(r => r.kind === 'HEADER') ? 'REGIONS_ONLY' : 'TABLE_ROWS';
    return {
        version: OCR_EVIDENCE_VERSION, sourceSha256: proposal.sourceSha256, filename: proposal.filename, receipt: proposal.receipt,
        anchorReaders: anchorSets.map(a => a.reader), items, rows, unanchored, texts, unclaimed, coverage, warnings,
    };
}
