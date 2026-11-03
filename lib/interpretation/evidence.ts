/** Reads an untrusted CSV into rows and builds the bounded evidence window shown to a model. */
import Papa from 'papaparse';
import { INTERPRETATION_VERSION, type LayoutEvidence } from './contracts';

export const MAX_TABLE_BYTES = 512_000;
const DELIMITERS = [',', ';', '\t', '|'] as const;
export type Table = { rows: string[][]; delimiter: typeof DELIMITERS[number] };

/** Picks the delimiter that yields the largest block of equal-width multi-column rows (preamble lines are single cells). */
export function readTable(bytes: Uint8Array): Table | null {
    if (!bytes.length || bytes.length > MAX_TABLE_BYTES) return null;
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); } catch { return null; }
    let best: (Table & { score: number }) | null = null;
    for (const delimiter of DELIMITERS) {
        const parsed = Papa.parse<string[]>(text, { delimiter, skipEmptyLines: false });
        const rows = parsed.data.map(r => r.map(c => c.trim()));
        while (rows.length && rows.at(-1)!.every(c => !c)) rows.pop();
        const widths = new Map<number, number>();
        for (const r of rows) if (r.length > 1) widths.set(r.length, (widths.get(r.length) ?? 0) + 1);
        const score = Math.max(0, ...widths.values());
        if (rows.length <= 5000 && (!best || score > best.score)) best = { rows, delimiter, score };
    }
    return best && best.score > 1 ? { rows: best.rows, delimiter: best.delimiter } : null;
}

const modalWidth = (rows: string[][]) => {
    const counts = new Map<number, number>();
    for (const r of rows) if (r.length > 1) counts.set(r.length, (counts.get(r.length) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
};
/** Deterministic header guess, only used to compute profiles; the model's choice is verified separately. */
export function guessHeaderLine(rows: string[][]): number {
    const width = modalWidth(rows);
    const index = rows.findIndex((r, i) => r.length === width && r.every(c => c && !/^-?[\d.,()]+$/.test(c)) && rows[i + 1]?.length === width);
    return index < 0 ? 0 : index;
}
const clip = (cells: string[]) => cells.slice(0, 24).map(c => c.length > 80 ? c.slice(0, 77) + '…' : c);
const numeric = /^\(?-?(?:RM|MYR)?\s?[\d.,]+\)?$/i, dateish = /\d{1,4}[-/.\s][A-Za-z\d]{1,9}[-/.\s]\d{2,4}|^\d{8}$/;

export function buildEvidence(table: Table, sha256: string, fileName: string): LayoutEvidence {
    const { rows } = table, headerLine = guessHeaderLine(rows), width = rows[headerLine]?.length ?? 0;
    const body = rows.slice(headerLine + 1).filter(r => r.length === width);
    const headEnd = Math.min(rows.length, Math.max(headerLine + 7, 10), 18);
    const head = rows.slice(0, headEnd).map((cells, line) => ({ line, cells: clip(cells) }));
    const tail = rows.slice(Math.max(headEnd, rows.length - 3)).map((cells, i, all) => ({ line: rows.length - all.length + i, cells: clip(cells) }));
    const profiles = (rows[headerLine] ?? []).map((header, column) => {
        const values = body.map(r => r[column] ?? '');
        const nonEmpty = values.filter(Boolean);
        return {
            column, header: header.slice(0, 80), samples: [...new Set(nonEmpty)].slice(0, 5).map(v => v.slice(0, 60)),
            nonEmpty: nonEmpty.length, numericLike: nonEmpty.filter(v => numeric.test(v)).length, dateLike: nonEmpty.filter(v => dateish.test(v)).length,
        };
    });
    return { version: INTERPRETATION_VERSION, sha256, fileName: fileName.split(/[/\\]/).pop()!.slice(0, 80), delimiter: table.delimiter, totalLines: rows.length, head, tail, profiles, profileHeaderLine: headerLine };
}
