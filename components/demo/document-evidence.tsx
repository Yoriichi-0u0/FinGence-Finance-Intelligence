'use client';
import { useEffect, useRef, useState } from 'react';
import { FileSearch, LoaderCircle } from 'lucide-react';
import { Panel } from '@/components/ui';
import type { DocumentInput, ProcessedDocument, ProcessingContext } from '@/lib/demo/pipeline';
import type { PageCoords } from '@/lib/interpretation/extract';
import type { CellBox, RowGeometry } from '@/lib/interpretation/positioned';
import { button, money } from './shared';

/**
 * Side by side: the document as supplied (left) and what FinGence read from it (right). Each verified record points to
 * the line it came from; hovering either side highlights the other. Columns are coloured by the field read from them,
 * lines the AI model was shown are marked, and lines nothing was read from stay dim. Everything here is computed in
 * this browser from the processing's own reading: nothing is sent anywhere.
 */
const FIELD: Record<string, { label: string; color: string; fill: string }> = {
    date: { label: 'Date', color: 'bg-sky-100 text-sky-950', fill: 'rgba(14,165,233,0.28)' },
    description: { label: 'Description', color: 'bg-violet-100 text-violet-950', fill: 'rgba(139,92,246,0.24)' },
    amount: { label: 'Amount', color: 'bg-emerald-100 text-emerald-950', fill: 'rgba(16,185,129,0.30)' },
    reference: { label: 'Reference', color: 'bg-amber-100 text-amber-950', fill: 'rgba(245,158,11,0.28)' },
    counterparty: { label: 'Counterparty', color: 'bg-rose-100 text-rose-950', fill: 'rgba(244,63,94,0.22)' },
    recordId: { label: 'Record ID', color: 'bg-slate-200 text-slate-900', fill: 'rgba(100,116,139,0.25)' },
    balance: { label: 'Balance', color: 'bg-teal-100 text-teal-950', fill: 'rgba(20,184,166,0.22)' },
};
const MONEY = new Set(['amount', 'unsignedAmount', 'moneyIn', 'moneyOut', 'debit', 'credit', 'direction']);
const fieldKey = (f: string) => MONEY.has(f) ? 'amount' : FIELD[f] ? f : null;
const ROLE: Record<string, string> = { BANK_STATEMENT: 'Bank statement', GENERAL_LEDGER: 'General ledger', BANK_HISTORY: 'Bank history' };
type Row = { id: string; line: number; date: string; text: string; reference: string; signed: string };

async function hex(bytes: Uint8Array) {
    const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer))].map(b => b.toString(16).padStart(2, '0')).join('');
}
/** The verified values of each record, from the same outputs every page reads. */
function recordRows(c: ProcessingContext, d: ProcessedDocument): Row[] {
    const o = c.outputs, lines = new Map(d.reading?.records.map(r => [r.id, r.line]) ?? []);
    const source = d.role === 'BANK_STATEMENT' ? o.bankRows : d.role === 'BANK_HISTORY' ? o.history.rows : [];
    const rows: Row[] = d.role === 'GENERAL_LEDGER'
        ? (o.ledger?.rows ?? []).map(r => ({ id: r.recordId, line: lines.get(r.recordId) ?? -1, date: r.date, text: r.description, reference: r.reference, signed: (Number(r.signedCents) / 100).toFixed(2) }))
        : source.map(r => ({ id: r.rowId, line: lines.get(r.rowId) ?? -1, date: r.date, text: r.counterparty ? `${r.description} · ${r.counterparty}` : r.description, reference: r.reference, signed: r.signedAmount }));
    return rows.filter(r => r.line >= 0);
}

export function DocumentEvidence({ context, inputs }: { context: ProcessingContext; inputs: DocumentInput[] }) {
    const docs = context.documents.filter(d => d.reading);
    const [index, setIndex] = useState(0), [active, setActive] = useState<number | null>(null);
    const doc = docs[Math.min(index, docs.length - 1)];
    const [file, setFile] = useState<{ sha: string; input: DocumentInput } | null>(null);
    const fileSha = doc?.source?.kind === 'WORKSHEET' ? doc.source.workbookSha256 : doc?.source ? doc.source.fileSha256 : doc?.sha256;
    useEffect(() => {
        let live = true;
        void (async () => { for (const input of inputs) if (await hex(input.bytes) === fileSha) { if (live) setFile({ sha: fileSha!, input }); return; } })();
        return () => { live = false; };
    }, [inputs, fileSha]);
    const original = file?.sha === fileSha ? file.input : null;
    const rows = doc ? recordRows(context, doc) : [];
    // Selecting a line on the document scrolls the record list to it (and the reverse, in the document panes).
    useEffect(() => { if (active !== null && doc) document.getElementById(`rec-${doc.sha256.slice(0, 8)}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, doc]);
    if (!doc?.reading) return null;
    const r = doc.reading, read = new Set(r.records.map(x => x.line)), ai = new Set(r.aiLines);
    const cellField = new Map(r.columns.map(c => [c.column, fieldKey(c.field)]));
    const disputes = new Set((doc.source?.kind === 'OCR' ? doc.source.disputes : []).map(x => `${x.line}:${x.column}`));
    const extracted = doc.source && doc.source.kind !== 'WORKSHEET' ? doc.source : null;
    const currency = context.scope?.currency ?? doc.currency ?? '';
    const shown = [...new Set(r.columns.map(c => fieldKey(c.field)).filter(Boolean))] as string[];

    return <Panel title="What FinGence read" eyebrow="Document and reading, side by side">
        <div className="space-y-3 p-4 sm:p-5">
            <div role="tablist" aria-label="Documents" className="flex flex-wrap gap-2">
                {docs.map((d, i) => <button key={d.sha256} type="button" role="tab" aria-selected={d === doc} className={`${button} min-h-9 px-3 py-1 text-xs ${d === doc ? 'border-[var(--teal)] bg-[var(--teal-soft)]' : ''}`} onClick={() => { setIndex(i); setActive(null); }}>{d.role ? ROLE[d.role] : 'Not identified'} · <span className="max-w-[14rem] truncate">{d.name}</span></button>)}
            </div>
            <p className="text-sm text-[var(--muted-strong)]">
                {r.records.length ? <>FinGence read <strong>{r.records.length} records</strong> from {r.rows.length} lines of this document{r.aiLines.length ? <>; the AI model was shown <strong>{r.aiLines.length} lines</strong> (headings and samples) to propose the layout, and the code then read and checked every line</> : <>, by its exact column names (no AI)</>}. Lines nothing was read from (headings, totals, page text) stay dim.</>
                    : <>No records were taken from this document: {doc.reason}</>}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label="Legend">
                {shown.map(f => <span key={f} className={`rounded px-1.5 py-0.5 ${FIELD[f].color}`}>{FIELD[f].label}</span>)}
                {r.aiLines.length ? <span className="rounded border border-dashed border-indigo-400 px-1.5 py-0.5 text-indigo-900">AI was shown this line</span> : null}
                {disputes.size ? <span className="rounded px-1.5 py-0.5 outline outline-2 -outline-offset-2 outline-red-500">Two OCR passes disagreed</span> : null}
            </div>
            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                <section aria-label="Document as supplied" className="min-w-0 rounded-lg border border-[var(--border)]">
                    <h3 className="border-b border-[var(--border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Document as supplied</h3>
                    <div className="thin-scrollbar max-h-[45vh] lg:max-h-[70vh] overflow-auto">
                        {extracted?.geometry && extracted.coords && original
                            ? <Pages input={original} coords={extracted.coords} geometry={extracted.geometry} read={read} active={active} setActive={setActive} cellField={cellField} disputes={disputes} />
                            : <Grid rows={r.rows} read={read} ai={ai} active={active} setActive={setActive} cellField={cellField} disputes={disputes} />}
                    </div>
                    {extracted && !extracted.geometry ? <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">This processing kept no word positions; showing the lines as read.</p> : null}
                </section>
                <section aria-label="What FinGence read" className="min-w-0 rounded-lg border border-[var(--border)]">
                    <h3 className="border-b border-[var(--border)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Verified records</h3>
                    <ol className="thin-scrollbar max-h-[45vh] lg:max-h-[70vh] divide-y divide-[var(--border)] overflow-auto text-sm">
                        {rows.map(x => <li key={x.id} id={`rec-${doc.sha256.slice(0, 8)}-${x.line}`} tabIndex={0} onMouseEnter={() => setActive(x.line)} onFocus={() => setActive(x.line)} onClick={() => setActive(x.line)}
                            className={`grid cursor-default grid-cols-[3.2rem_minmax(0,1fr)_auto] gap-2 px-3 py-2 ${active === x.line ? 'bg-[var(--teal-soft)]' : ''}`}>
                            <span className="text-xs text-[var(--muted)]">line {x.line + 1}</span>
                            <span className="min-w-0"><span className={`mr-1 rounded px-1 text-xs ${FIELD.date.color}`}>{x.date}</span><span className="break-words">{x.text}</span>{x.reference ? <span className={`ml-1 rounded px-1 text-xs ${FIELD.reference.color}`}>{x.reference}</span> : null}<span className="block text-[11px] text-[var(--muted)]">{x.id}</span></span>
                            <span className={`self-start rounded px-1 text-right text-xs tabular-nums ${FIELD.amount.color}`}>{money(currency, x.signed)}</span>
                        </li>)}
                        {!rows.length ? <li className="px-3 py-3 text-[var(--muted)]">No verified records.</li> : null}
                    </ol>
                </section>
            </div>
        </div>
    </Panel>;
}

type Shared = { read: Set<number>; active: number | null; setActive: (line: number | null) => void; cellField: Map<number, string | null>; disputes: Set<string> };

/** A CSV, worksheet, or a PDF without positions: the table line by line, each read cell coloured by its field. */
function Grid({ rows, read, ai, active, setActive, cellField, disputes }: Shared & { rows: string[][]; ai: Set<number> }) {
    const ref = useRef<HTMLTableRowElement>(null);
    useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }); }, [active]);
    return <table className="w-full text-xs"><tbody>
        {rows.map((cells, line) => {
            const used = read.has(line);
            return <tr key={line} ref={active === line ? ref : undefined} onMouseEnter={() => used && setActive(line)} onClick={() => used && setActive(line)}
                className={`border-b border-[var(--border)] align-top ${active === line ? 'bg-[var(--teal-soft)]' : ''} ${used ? '' : 'text-[var(--muted)] opacity-60'} ${ai.has(line) ? 'outline outline-1 -outline-offset-1 outline-dashed outline-indigo-400' : ''}`}>
                <td className="w-9 select-none px-1.5 py-1 text-right text-[10px] text-[var(--muted)]">{line + 1}</td>
                {cells.map((c, k) => { const f = used ? cellField.get(k) : null; return <td key={k} className={`whitespace-nowrap px-1.5 py-1 ${f ? FIELD[f].color : ''} ${disputes.has(`${line}:${k}`) ? 'outline outline-2 -outline-offset-2 outline-red-500' : ''}`}>{c}</td>; })}
            </tr>;
        })}
    </tbody></table>;
}

/** A PDF or image: each page drawn as supplied, with a box over every cell read, coloured by its field. */
function Pages({ input, coords, geometry, read, active, setActive, cellField, disputes }: Shared & { input: DocumentInput; coords: PageCoords[]; geometry: RowGeometry[] }) {
    const [pages, setPages] = useState<{ number: number; src: string; width: number; height: number }[] | null>(null), [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        void (async () => {
            try {
                const isPdf = input.bytes[0] === 0x25 && input.bytes[1] === 0x50;
                if (!isPdf) {
                    const src = URL.createObjectURL(new Blob([input.bytes.slice()])), c = coords[0];
                    if (live && c?.coords === 'PIXELS') setPages([{ number: 1, src, width: c.width, height: c.height }]);
                    return;
                }
                const { readPdf } = await import('@/lib/interpretation/pdf');
                const pdf = await readPdf(input.bytes), out = [];
                try {
                    for (const p of pdf.pages) {
                        const scale = Math.min(2, 1100 / p.width), canvas = await pdf.render(p.number, scale);
                        if (!(canvas instanceof HTMLCanvasElement)) continue;
                        const c = coords.find(x => x.number === p.number);
                        // The box coordinates: PDF points times the reading's scale, or the stored scan's pixels (spanning the page).
                        const [w, h] = c?.coords === 'PIXELS' ? [c.width, c.height] : [p.width * (c?.scale ?? 1), p.height * (c?.scale ?? 1)];
                        out.push({ number: p.number, src: canvas.toDataURL('image/jpeg', 0.85), width: w, height: h });
                    }
                } finally { await pdf.close(); }
                if (live) setPages(out);
            } catch { if (live) setFailed(true); }
        })();
        return () => { live = false; };
    }, [input, coords]);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }); }, [active]);
    if (failed) return <p className="p-3 text-sm text-[var(--muted)]">The document could not be drawn in this browser.</p>;
    if (!pages) return <p className="flex items-center gap-2 p-3 text-sm text-[var(--muted)]"><LoaderCircle aria-hidden="true" className="animate-spin" size={14} />Drawing the document…</p>;
    const pct = (v: number, of: number) => `${(v / of) * 100}%`;
    return <div className="space-y-2 bg-slate-100 p-2">
        {pages.map(p => <div key={p.number} className="relative mx-auto w-full bg-white shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local data URL of the user's own page, drawn in this browser */}
            <img src={p.src} alt={`Page ${p.number} of ${input.name}`} className="block w-full" />
            {geometry.map((g, line) => {
                if (!g || g.page !== p.number) return null;
                const used = read.has(line), boxes = g.cells.map((b, k) => [b, k] as [CellBox, number]).filter(([b]) => b);
                if (!used && !boxes.some(([, k]) => disputes.has(`${line}:${k}`))) return null;
                return boxes.map(([b, k]) => {
                    const f = used ? cellField.get(k) : null, [x0, y0, x1, y1] = b!, on = active === line;
                    return <div key={`${line}:${k}`} ref={on && k === boxes[0][1] ? ref : undefined} onMouseEnter={() => used && setActive(line)} onClick={() => used && setActive(line)}
                        className={`absolute rounded-[2px] ${disputes.has(`${line}:${k}`) ? 'outline outline-2 outline-red-500' : ''} ${on ? 'ring-2 ring-[var(--teal)]' : ''}`}
                        style={{ left: pct(x0 - 2, p.width), top: pct(y0 - 2, p.height), width: pct(x1 - x0 + 4, p.width), height: pct(y1 - y0 + 4, p.height), background: f ? FIELD[f].fill : 'transparent', opacity: active === null || on ? 1 : 0.55 }} />;
                });
            })}
        </div>)}
    </div>;
}

/** The entry on the Data page: shown once a processing has documents read as tables. */
export function DocumentEvidenceEntry({ context, inputs }: { context: ProcessingContext; inputs: DocumentInput[] }) {
    const [open, setOpen] = useState(false);
    if (!context.documents.some(d => d.reading)) return null;
    return open ? <DocumentEvidence context={context} inputs={inputs} />
        : <button type="button" className={button} onClick={() => setOpen(true)}><FileSearch aria-hidden="true" size={16} />Compare each document with what FinGence read</button>;
}
