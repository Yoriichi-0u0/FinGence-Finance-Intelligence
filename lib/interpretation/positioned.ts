/**
 * Positioned words (from a PDF's text layer or from OCR) → a CSV-shaped table, deterministically, so the
 * same identification, AI layout interpretation and gates run on it as on a CSV. Geometry only places words
 * into rows and cells: it never edits a word, and a wrong placement can only make a gate fail.
 *
 * Lines are words sharing a baseline; a gap wider than a space starts a new cell. Blank vertical space
 * separates blocks. In a block that holds a table (a heading line followed by dated lines), every line is
 * aligned to the heading's columns, so an empty cell stays empty instead of shifting its neighbours left.
 */
/** `alternatives`: other readings of the same word (a second OCR pass that disagreed). */
export type Word = { text: string; x0: number; x1: number; y0: number; y1: number; page: number; confidence?: number; alternatives?: string[] };
/** A table cell whose words were read differently by two OCR passes; `readings` are the other full-cell texts. */
export type Dispute = { line: number; column: number; readings: string[] };
type Cell = { text: string; x0: number; x1: number; h: number; alts: string[] };
type Line = { page: number; y: number; height: number; cells: Cell[] };
/** Where a cell sits on its page, [x0, y0, x1, y1] in the words' coordinates (top-left origin); null for an empty cell. */
export type CellBox = [number, number, number, number] | null;
/** Per table line (the CSV line index): its page and one box per cell; null for a blank separator line. */
export type RowGeometry = { page: number; cells: CellBox[] } | null;
export type PositionedTable = { bytes: Uint8Array; rows: number; columns: number; notes: string[]; disputes: Dispute[]; geometry: RowGeometry[] };

const DATE_LIKE = /\d{1,4}[-/.\s][A-Za-z\d]{1,9}[-/.\s]\d{2,4}|^\d{8}$/;
const NUMERIC = /^\(?[-+]?(?:RM|MYR|Rs\.?|INR|₹|USD|US\$|\$|SGD|S\$|EUR|€|GBP|£)?\s?[\d.,]+\)?(?:\s?(?:MYR|INR|USD|SGD|EUR|GBP|CR|DR))?$/i;
/** Totals and balance lines are never the continuation of a transaction's text. */
const SUMMARY = /\b(totals?|jumlah|opening|closing|brought forward|carried forward|baki)\b/i;
const PAGE_MARK = /^(page|halaman|muka surat)\s*\d+(\s*(of|\/|dari|daripada)\s*\d+)?$/i;
const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const join = (a: string, b: string) => [a, b].filter(Boolean).join(' ');
const csvCell = (v: string) => /[",\n\r]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

function group(ws: Word[], height: number) {
    const grouped: Word[][] = [];
    for (const w of [...ws].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1) || a.x0 - b.x0)) {
        const yc = (w.y0 + w.y1) / 2, last = grouped.at(-1);
        if (last && Math.abs(yc - median(last.map(x => (x.y0 + x.y1) / 2))) <= height * 0.5) last.push(w); else grouped.push([w]);
    }
    return grouped;
}
/** Page skew (dy per dx) from the baselines of long lines: a tilted scan otherwise splits a wide line in two. */
function skew(grouped: Word[][]) {
    const slopes = grouped.filter(g => g.length >= 5).map(g => {
        const n = g.length, mx = g.reduce((a, w) => a + w.x0, 0) / n, my = g.reduce((a, w) => a + w.y1, 0) / n;
        const sxx = g.reduce((a, w) => a + (w.x0 - mx) ** 2, 0);
        return sxx ? g.reduce((a, w) => a + (w.x0 - mx) * (w.y1 - my), 0) / sxx : 0;
    });
    return slopes.length >= 3 ? median(slopes) : 0;
}
function lines(words: Word[]): Line[] {
    const out: Line[] = [];
    for (const page of [...new Set(words.map(w => w.page))].sort((a, b) => a - b)) {
        let ws = words.filter(w => w.page === page && w.text.trim());
        const height = median(ws.map(w => w.y1 - w.y0)) || 1;
        const tilt = skew(group(ws, height));
        if (Math.abs(tilt) > 0.0005) ws = ws.map(w => ({ ...w, y0: w.y0 - tilt * w.x0, y1: w.y1 - tilt * w.x0 }));
        const grouped = group(ws, height);
        for (const g of grouped) {
            const sorted = g.sort((a, b) => a.x0 - b.x0), cells: Cell[] = [];
            for (const w of sorted) {
                const last = cells.at(-1);
                // A gap wider than about one space (0.6 × the taller word's height) separates two cells.
                // An empty alternative means the word may not be there at all (an engine reading of near-zero confidence).
                const t = w.text.trim(), alts = [...new Set((w.alternatives ?? []).map(a => a.trim()).filter(a => a !== t))];
                if (last && w.x0 - last.x1 <= Math.max(last.h, w.y1 - w.y0) * 0.6) {
                    last.alts = [...last.alts.map(a => join(a, t)), ...alts.map(a => join(last.text, a))];
                    last.text = join(last.text, t); last.x1 = Math.max(last.x1, w.x1); last.h = Math.max(last.h, w.y1 - w.y0);
                } else cells.push({ text: t, x0: w.x0, x1: w.x1, h: w.y1 - w.y0, alts });
            }
            out.push({ page, y: median(g.map(w => (w.y0 + w.y1) / 2)), height, cells });
        }
    }
    return out;
}

const isHeading = (l: Line) => l.cells.length >= 3 && l.cells.every(c => !NUMERIC.test(c.text) && !DATE_LIKE.test(c.text));
const isDated = (l: Line) => l.cells.length >= 3 && l.cells.some(c => DATE_LIKE.test(c.text));
/** A dated line within the next three (a wrapped description may sit between the headings and the first transaction). */
const datedSoon = (block: Line[], from: number) => block.slice(from, from + 3).some(isDated);
/** `next` only continues headings of `top`: every one of its cells sits under one heading cell, and it has no figures. */
const wraps = (top: Line, next: Line) => next.cells.length >= 1 && next.cells.length < top.cells.length && next.cells.every(c => !DATE_LIKE.test(c.text) && !/\d/.test(c.text) && top.cells.some(h => c.x0 < h.x1 && c.x1 > h.x0));

/** `top` is a heading fragment above `heading` ("Transaction" over "ID"): several cells (a single one is a title or note), each over a heading cell. */
const prefixes = (top: Line, heading: Line, next: Line | undefined) => top.cells.length >= 2 && wraps(heading, top) && (!next || heading.y - top.y <= (next.y - heading.y) * 1.2);
/** OCR noise: a low-confidence word made only of marks (rules, smudges, underlines). */
const NOISE = /^[~_\-—–=|.,:;'`"^*•·°]+$/;

export function wordsToTable(input: Word[]): PositionedTable {
    const noise = input.filter(w => w.confidence !== undefined && w.confidence < 60 && NOISE.test(w.text.trim()));
    const words = input.filter(w => !noise.includes(w)), all = lines(words), notes: string[] = [];
    if (noise.length) notes.push(`${noise.length} low-confidence mark${noise.length === 1 ? '' : 's'} ("${noise[0].text.trim()}") not read as text.`);
    const marks = all.filter(l => l.cells.length === 1 && PAGE_MARK.test(l.cells[0].text));
    const kept = all.filter(l => !marks.includes(l));
    if (marks.length) notes.push(`${marks.length} page-number line${marks.length === 1 ? '' : 's'} not read ("${marks[0].cells[0].text}").`);
    const pitch = median(kept.slice(1).map((l, i) => l.page === kept[i].page ? l.y - kept[i].y : 0).filter(d => d > 0)) || 1;

    // Blocks: consecutive lines on one page without a blank line between them.
    const blocks: Line[][] = [];
    for (const [i, l] of kept.entries()) {
        const prev = kept[i - 1];
        if (!prev || prev.page !== l.page || l.y - prev.y > pitch * 1.6) blocks.push([l]); else blocks.at(-1)!.push(l);
    }
    const rows: string[][] = [], disputes: Dispute[] = [], geometry: RowGeometry[] = [];
    const boxOf = (c: Cell, y: number): CellBox => [c.x0, y - c.h / 2, c.x1, y + c.h / 2];
    const union = (a: CellBox, b: CellBox): CellBox => !a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
    const push = (row: string[], g: RowGeometry) => { rows.push(row); geometry.push(g); };
    const plain = (l: Line) => push(l.cells.map(c => c.text), { page: l.page, cells: l.cells.map(c => boxOf(c, l.y)) });
    let header: Line | null = null, repeated = 0, wrapped = 0;
    type Aligned = { row: string[]; alts: string[][]; y: number; h: number; x0: (number | undefined)[]; page: number; boxes: CellBox[] };
    const align = (l: Line): Aligned => {
        const cols = header!.cells, row = cols.map(() => ''), alts: string[][] = cols.map(() => []), x0: (number | undefined)[] = cols.map(() => undefined), boxes: CellBox[] = cols.map(() => null);
        for (const c of l.cells) {
            const mid = (c.x0 + c.x1) / 2;
            let k = cols.findIndex((h, j) => mid < (j + 1 < cols.length ? (h.x1 + cols[j + 1].x0) / 2 : Infinity));
            if (k < 0) k = cols.length - 1;
            alts[k] = row[k] ? [...alts[k].map(a => join(a, c.text)), ...c.alts.map(a => join(row[k], a))] : c.alts;
            row[k] = join(row[k], c.text); x0[k] ??= c.x0; boxes[k] = union(boxes[k], boxOf(c, l.y));
        }
        return { row, alts, y: l.y, h: l.height, x0, page: l.page, boxes };
    };
    // A line of a table with neither a date nor a figure continues a transaction whose text wrapped (a long
    // description, a time printed under the date): it joins the nearest dated or figured line, above or below.
    const anchored = (a: Aligned) => a.row.some(c => DATE_LIKE.test(c) || (NUMERIC.test(c) && /\d/.test(c)) || SUMMARY.test(c));
    const emit = (lines: Aligned[]) => {
        const anchors = lines.map((a, i) => anchored(a) ? i : -1).filter(i => i >= 0);
        const parts = new Map<number, Aligned[]>(anchors.map(i => [i, [lines[i]]]));
        for (const [i, a] of lines.entries()) {
            if (anchored(a) || !a.row.some(Boolean)) continue;
            const near = anchors.reduce((best, j) => best < 0 || Math.abs(lines[j].y - a.y) < Math.abs(lines[best].y - a.y) ? j : best, -1);
            if (near < 0 || Math.abs(lines[near].y - a.y) > pitch * 1.6) { parts.set(i, [a]); continue; }
            // Wrapped text keeps the left edge of the text it continues, which can lie under a neighbouring heading.
            const anchor = lines[near], moved: Aligned = { ...a, row: a.row.map(() => ''), alts: a.alts.map(() => []), boxes: a.boxes.map(() => null) };
            a.row.forEach((text, k) => {
                if (!text) return;
                const j = anchor.row.findIndex((t, jj) => t && !NUMERIC.test(t) && anchor.x0[jj] !== undefined && Math.abs(anchor.x0[jj]! - a.x0[k]!) <= a.h * 0.5);
                const to = j >= 0 && !a.row[j] ? j : k;
                moved.row[to] = text; moved.alts[to] = a.alts[k]; moved.boxes[to] = a.boxes[k];
            });
            parts.get(near)!.push(moved); wrapped++;
        }
        for (const i of [...parts.keys()].sort((x, y) => x - y)) {
            const group = parts.get(i)!.sort((x, y) => x.y - y.y), width = group[0].row.length;
            const row = Array.from({ length: width }, (_, k) => group.map(g => g.row[k]).filter(Boolean).join(' '));
            for (let k = 0; k < width; k++) {
                const readings = group.flatMap((g, gi) => g.alts[k].map(alt => group.map((h, hi) => hi === gi ? alt : h.row[k]).filter(Boolean).join(' ')));
                if (readings.length) disputes.push({ line: rows.length, column: k, readings: [...new Set(readings)] });
            }
            push(row, { page: group[0].page, cells: Array.from({ length: width }, (_, k) => group.reduce<CellBox>((b, g) => union(b, g.boxes[k]), null)) });
        }
    };
    let furniture = 0, joinedHeadings = 0;
    for (const block of blocks) {
        const sameHeading = (l: Line) => !!header && l.cells.map(c => c.text).join('|') === header.cells.map(c => c.text).join('|');
        // Find this block's heading line, joining a heading printed on two lines ("Dr" over "(RM)", "Transaction" over "ID").
        let start = block.findIndex((l, i) => isHeading(l) && datedSoon(block, i + 1));
        if (start < 0) for (let i = 0; i + 2 < block.length; i++) if (isHeading(block[i]) && wraps(block[i], block[i + 1]) && datedSoon(block, i + 2)) {
            const top = block[i], next = block[i + 1], merged: Line = { ...top, cells: top.cells.map(c => ({ ...c })) };
            for (const c of next.cells) {
                const k = merged.cells.findIndex(h => c.x0 < h.x1 && c.x1 > h.x0);
                merged.cells[k].text += ` ${c.text}`; merged.cells[k].x0 = Math.min(merged.cells[k].x0, c.x0); merged.cells[k].x1 = Math.max(merged.cells[k].x1, c.x1);
            }
            block.splice(i, 2, merged); start = i; joinedHeadings++;
            break;
        }
        // ...but only when it sits as close to the headings as the headings sit to the first row (not a preamble line above them).
        if (start > 0 && prefixes(block[start - 1], block[start], block[start + 1])) {
            const top = block[start - 1], merged: Line = { ...block[start], cells: block[start].cells.map(c => ({ ...c })) };
            for (const c of top.cells) { const k = merged.cells.findIndex(h => c.x0 < h.x1 && c.x1 > h.x0); merged.cells[k].text = `${c.text} ${merged.cells[k].text}`; }
            block.splice(start - 1, 2, merged); start--; joinedHeadings++;
        }
        // A table continues across a page break: the repeated heading is skipped, and so is page furniture printed
        // above it (a repeated letterhead), unless a line there looks like a transaction.
        if (header && start >= 0 && sameHeading(block[start])) {
            const above = block.slice(0, start);
            if (above.some(isDated)) emit(above.map(align)); else furniture += above.length;
            repeated++;
            emit(block.slice(start + 1).map(align));
            continue;
        }
        if (header && start < 0 && isDated(block[0])) { emit(block.map(align)); continue; }
        if (rows.length) push([], null);
        if (start < 0) { header = null; for (const l of block) plain(l); continue; }
        for (const l of block.slice(0, start)) plain(l);
        header = block[start];
        plain(header);
        emit(block.slice(start + 1).map(align));
    }
    if (joinedHeadings) notes.push(`Column headings printed on two lines joined${joinedHeadings > 1 ? ` (${joinedHeadings} times)` : ''}${header ? `: ${header.cells.map(c => `"${c.text}"`).join(', ')}` : ''}.`);
    if (furniture) notes.push(`${furniture} repeated page-header line${furniture === 1 ? '' : 's'} above the column headings on later pages not read.`);
    if (wrapped) notes.push(`${wrapped} wrapped line${wrapped === 1 ? '' : 's'} (text continuing a transaction) joined to the transaction they belong to.`);
    if (repeated) notes.push(`${repeated} repeated column-heading line${repeated === 1 ? '' : 's'} on later pages not read.`);
    const text = rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';
    return { bytes: new TextEncoder().encode(text), rows: rows.length, columns: Math.max(0, ...rows.map(r => r.length)), notes, disputes, geometry };
}
