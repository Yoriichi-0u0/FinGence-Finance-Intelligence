'use client';
import { useEffect, useState } from 'react';
import Papa from 'papaparse';
import { Eye, FileWarning, LoaderCircle } from 'lucide-react';
import { Panel } from '@/components/ui';
import type { DocumentInput } from '@/lib/demo/pipeline';
import { chip } from './shared';

/**
 * The documents exactly as chosen, before anything is processed: the pages of a PDF or a scan, or the first rows of a
 * spreadsheet. Everything is drawn in this browser from the chosen bytes; nothing is sent anywhere.
 */
const MAX_PAGES = 3, MAX_ROWS = 20;
type Preview = { kind: 'pages'; pages: { number: number; src: string }[]; total: number } | { kind: 'table'; rows: string[][]; total: number; sheet?: string } | { kind: 'none'; reason: string };

const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isImage = (name: string, b: Uint8Array) => /\.(png|jpe?g)$/i.test(name) || (b[0] === 0x89 && b[1] === 0x50) || (b[0] === 0xff && b[1] === 0xd8);
const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
const table = (text: string) => (Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: true }).data ?? []).filter(r => Array.isArray(r));

async function preview(input: DocumentInput): Promise<Preview> {
    const b = input.bytes;
    if (isPdf(b)) {
        const { readPdf } = await import('@/lib/interpretation/pdf');
        const pdf = await readPdf(b), pages: { number: number; src: string }[] = [];
        try {
            for (const p of pdf.pages.slice(0, MAX_PAGES)) {
                const canvas = await pdf.render(p.number, Math.min(1.6, 900 / p.width));
                if (canvas instanceof HTMLCanvasElement) pages.push({ number: p.number, src: canvas.toDataURL('image/jpeg', 0.82) });
            }
        } finally { await pdf.close(); }
        return pages.length ? { kind: 'pages', pages, total: pdf.pages.length } : { kind: 'none', reason: 'This PDF has no page that can be drawn.' };
    }
    if (isImage(input.name, b)) return { kind: 'pages', pages: [{ number: 1, src: URL.createObjectURL(new Blob([b.slice()])) }], total: 1 };
    if (isZip(b) || /\.xlsx$/i.test(input.name)) {
        const { expandWorkbook } = await import('@/lib/interpretation/workbook');
        const book = await expandWorkbook(input.name, b, '0'.repeat(64));
        if ('error' in book || !book.worksheets.length) return { kind: 'none', reason: 'This workbook has no worksheet that can be shown.' };
        const first = book.worksheets[0], rows = table(new TextDecoder().decode(first.bytes));
        return { kind: 'table', rows: rows.slice(0, MAX_ROWS + 1), total: rows.length, sheet: `${first.sheet}${book.worksheets.length > 1 ? ` (1 of ${book.worksheets.length} worksheets)` : ''}` };
    }
    const rows = table(new TextDecoder().decode(b));
    return rows.length ? { kind: 'table', rows: rows.slice(0, MAX_ROWS + 1), total: rows.length } : { kind: 'none', reason: 'This file has no rows to show.' };
}

export function DocumentPreview({ documents }: { documents: DocumentInput[] }) {
    const [index, setIndex] = useState(0), current = documents[Math.min(index, documents.length - 1)];
    const [state, setState] = useState<{ for: DocumentInput; preview: Preview } | null>(null);
    useEffect(() => {
        if (!current) return;
        let live = true, made: Preview | null = null;
        void preview(current).catch(() => ({ kind: 'none', reason: 'This file could not be shown here; it can still be processed.' } as Preview))
            .then(p => { made = p; if (live) setState({ for: current, preview: p }); });
        return () => { live = false; if (made?.kind === 'pages') for (const p of made.pages) if (p.src.startsWith('blob:')) URL.revokeObjectURL(p.src); };
    }, [current]);
    if (!current) return null;
    const ready = state?.for === current ? state.preview : null;
    return <Panel className="mt-5" title="Preview" eyebrow={`What you chose · ${documents.length} document${documents.length === 1 ? '' : 's'}`}>
        {documents.length > 1 ? <div role="tablist" aria-label="Chosen documents" className="thin-scrollbar flex gap-2 overflow-x-auto border-b border-[var(--border)] px-4 py-3 sm:px-5">
            {documents.map((d, i) => <button key={`${d.name}-${i}`} type="button" role="tab" aria-selected={d === current} className={`${chip(d === current)} shrink-0`} onClick={() => setIndex(i)}>{d.name}</button>)}
        </div> : null}
        <div className="p-4 sm:p-5">
            {!ready ? <p role="status" className="flex items-center gap-2 text-sm text-[var(--muted-strong)]"><LoaderCircle aria-hidden="true" size={16} className="animate-spin" />Drawing {current.name}…</p>
                : ready.kind === 'none' ? <p className="flex items-center gap-2 text-sm text-[var(--muted-strong)]"><FileWarning aria-hidden="true" size={16} className="text-[var(--muted)]" />{ready.reason}</p>
                : ready.kind === 'pages' ? <>
                    <div className="thin-scrollbar flex max-h-[34rem] gap-3 overflow-auto rounded-xl bg-[var(--surface-sunken)] p-3 ring-1 ring-inset ring-[var(--border)]">
                        {/* eslint-disable-next-line @next/next/no-img-element -- a local data or blob URL of the user's own page, drawn in this browser */}
                        {ready.pages.map(p => <img key={p.number} src={p.src} alt={`Page ${p.number} of ${current.name}`} className="h-auto w-[min(100%,34rem)] shrink-0 rounded-md bg-white shadow-sm ring-1 ring-black/5" />)}
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted)]"><Eye aria-hidden="true" size={13} />{ready.total > ready.pages.length ? `First ${ready.pages.length} of ${ready.total} pages` : `${ready.total} page${ready.total === 1 ? '' : 's'}`} · as supplied, before processing</p>
                </>
                : <>
                    <div className="thin-scrollbar max-h-[30rem] overflow-auto rounded-xl ring-1 ring-inset ring-[var(--border)]">
                        <table className="min-w-full text-left text-xs">
                            <caption className="sr-only">First rows of {current.name}</caption>
                            <tbody>{ready.rows.slice(0, MAX_ROWS + 1).map((r, i) => <tr key={i} className={i === 0 ? 'sticky top-0 bg-[var(--surface-subtle)] font-semibold' : 'border-t border-[var(--border)]'}>
                                <td className="w-10 px-2 py-1.5 text-right text-[var(--muted)] tabular-nums">{i + 1}</td>
                                {r.map((cell, j) => <td key={j} className="whitespace-nowrap px-2.5 py-1.5">{cell}</td>)}
                            </tr>)}</tbody>
                        </table>
                    </div>
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted)]"><Eye aria-hidden="true" size={13} />{ready.sheet ? `Worksheet ${ready.sheet} · ` : ''}{ready.total > MAX_ROWS + 1 ? `First ${MAX_ROWS + 1} of ${ready.total} lines` : `${ready.total} lines`} · as supplied, before processing</p>
                </>}
        </div>
    </Panel>;
}
