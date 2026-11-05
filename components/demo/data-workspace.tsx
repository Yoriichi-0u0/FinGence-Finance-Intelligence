'use client';
import Link from 'next/link';
import { useState } from 'react';
import { FileSpreadsheet, LoaderCircle, Play, RotateCcw, Sparkles, Upload } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui';
import { STAGE_TITLES, type DocumentInput, type StageId } from '@/lib/demo/pipeline';
import { useDemoProcessing } from './context';
import { InterpretationPanel } from './interpretation-panel';
import { SaveRun } from './save-run';
import { ROLE_LABEL, useWorkspace } from '@/components/workspace/context';
import { DecisionBadge, PendingBadge, Stat, Table, button, money, periodLabel, primaryButton } from './shared';

const SAMPLE = ['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv', 'demo-bank-history-2025-04-to-2026-03.csv'];
/** A second fictional business: one quarter (January to March 2026) in SGD, with timing differences that clear across months. */
const QUARTER = ['quarter/demo-bank-statement-2026-q1-sgd.csv', 'quarter/demo-general-ledger-2026-q1-sgd.csv', 'quarter/demo-bank-history-2025-04-to-2026-03-sgd.csv'];
/** The same fictional transactions in unfamiliar layouts (needs the AI gateway), plus the canonical history for the forecast. */
const UNFAMILIAR = ['unfamiliar/bank-statement-march-2026-export.csv', 'unfamiliar/general-ledger-cash-march-2026.csv', 'demo-bank-history-2025-04-to-2026-03.csv'];
/** The same documents as an Excel workbook, as text PDFs and as scans (all need the AI gateway), plus the canonical history. */
const FORMATS = [
    { label: 'Unfamiliar CSV', paths: UNFAMILIAR },
    { label: 'Excel workbook', paths: ['unfamiliar/rimba-demo-kitchen-march-2026.xlsx', 'demo-bank-history-2025-04-to-2026-03.csv'] },
    { label: 'PDF statements', paths: ['unfamiliar/bank-statement-march-2026.pdf', 'unfamiliar/general-ledger-cash-march-2026.pdf', 'demo-bank-history-2025-04-to-2026-03.csv'] },
    { label: 'Scanned (OCR)', paths: ['unfamiliar/bank-statement-march-2026-scan.pdf', 'unfamiliar/general-ledger-cash-march-2026-scan.jpg', 'demo-bank-history-2025-04-to-2026-03.csv'] },
];
const ROLE: Record<string, string> = { BANK_STATEMENT: 'Bank statement', GENERAL_LEDGER: 'General ledger (cash account)', BANK_HISTORY: 'Bank transaction history' };
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

async function hex(bytes: Uint8Array) {
    const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer))].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Phase 1 Data experience: select documents once, process once, inspect every stage's evidence. */
export default function DemoDataWorkspace() {
    const { status, context, liveStages, processedAt, persisted, error, process, clear, ai, aiWait } = useDemoProcessing();
    const [selected, setSelected] = useState<DocumentInput[]>([]);
    const [notice, setNotice] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const workspace = useWorkspace(), paused = workspace.session?.processing.paused ? workspace.session.processing : null;
    const busy = status === 'processing' || loading;

    async function loadSample(paths = SAMPLE) {
        setLoading(true); setNotice(null);
        try {
            const manifests = Object.fromEntries(await Promise.all(['', 'unfamiliar/', 'quarter/'].map(async dir => [dir, (await (await fetch(`/demo/${dir}manifest.json`, { cache: 'no-store' })).json() as { files: Record<string, { sha256: string }> }).files] as const)));
            const files = await Promise.all(paths.map(async path => {
                const bytes = new Uint8Array(await (await fetch(`/demo/${path}`, { cache: 'no-store' })).arrayBuffer());
                const [dir, name] = path.includes('/') ? [path.slice(0, path.lastIndexOf('/') + 1), path.slice(path.lastIndexOf('/') + 1)] : ['', path];
                // The published manifest pins each sample's bytes; a mismatch is reported instead of processed as the sample.
                if (manifests[dir]?.[name]?.sha256 !== await hex(bytes)) throw Error(name);
                return { name, bytes, provenance: 'PUBLIC_SYNTHETIC_SAMPLE' as const };
            }));
            setSelected(files);
        } catch { setNotice('The synthetic sample documents could not be loaded or did not match their published fingerprints.'); }
        finally { setLoading(false); }
    }
    async function choose(list: FileList | null) {
        if (!list?.length) return;
        setSelected(await Promise.all([...list].slice(0, 6).map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), provenance: 'USER_SUPPLIED' as const }))));
        setNotice(null);
    }
    const stages = (Object.keys(STAGE_TITLES) as StageId[]).map(id => ({ id, title: STAGE_TITLES[id], stage: liveStages.find(s => s.id === id) }));
    const ended = status === 'ready' || status === 'failed';
    const scope = context?.scope, out = context?.outputs;

    if (workspace.session && workspace.session.role !== 'FINANCE') return <>
        <PageHeader title="Data" description="Documents are processed by Finance users." />
        <Panel title={`Signed in as ${ROLE_LABEL[workspace.session.role]}`}>
            <div className="p-4 sm:p-5"><p className="text-sm">Your role does not process financial documents. {workspace.session.role === 'MANAGEMENT' ? 'Every run your Finance users process appears in Operations, with each check, model call and failure.' : 'Manage who can sign in, and with which role, in Team.'}</p>
            <Link href={workspace.session.role === 'MANAGEMENT' ? '/operations' : '/team'} className={`${primaryButton} mt-4`}>{workspace.session.role === 'MANAGEMENT' ? 'Open Operations' : 'Open Team'}</Link></div>
        </Panel>
    </>;
    return <>
        <PageHeader title="Data" description="Provide a bank statement and a general ledger once. FinGence identifies, verifies, reconciles and analyses them in one run." />
        {paused ? <div role="alert" className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-950">
            <p><strong>Processing is paused by your technical team.</strong> You can still look at earlier results; new documents cannot be processed until they resume it.</p>
            {paused.reason ? <p className="mt-1">Their note: {paused.reason}</p> : null}
        </div> : null}
        <div role="note" aria-label="Public prototype data notice" className="mb-5 space-y-1.5 rounded-lg border border-amber-200 bg-[var(--amber-soft)] p-3 text-sm">
            <p><strong>Public prototype: do not submit confidential or real financial documents.</strong> The built-in sample documents are fictional.</p>
            <p>If you choose your own files, they are read and processed locally in this browser and are not uploaded to a server; scans and images are read by OCR here too (the OCR engine and its English language data are downloaded from the jsDelivr CDN). Their contents are kept temporarily in this tab&apos;s sessionStorage so results survive a reload, until you press Clear results or close the tab.</p>
            {ai?.available
                ? <p><strong>AI layout interpretation is on.</strong> Documents in the supported layouts are recognised by fixed schema rules. For an unfamiliar layout, its headings, column profiles and a few sample lines (never the whole file) are sent through the FinGence server to {ai.model} on Groq, which proposes the layout. Deterministic checks on every row of the original file decide whether it is accepted; the model never supplies an amount, and every figure is computed in this browser.</p>
                : <p>Roles and columns are recognised by fixed schema rules and every figure is computed deterministically. This is not live AI inference.</p>}
        </div>
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <Panel title="1. Documents" eyebrow="Input">
                <div className="space-y-4 p-4 sm:p-5">
                    <div className="flex flex-wrap gap-2">
                        <button type="button" className={button} disabled={busy} onClick={() => void loadSample()}><FileSpreadsheet aria-hidden="true" size={16} />Use synthetic sample documents</button>
                        <button type="button" className={button} disabled={busy} onClick={() => void loadSample(QUARTER)}><FileSpreadsheet aria-hidden="true" size={16} />Quarter sample (3 months, SGD)</button>
                        <label className={`${button} cursor-pointer`}><Upload aria-hidden="true" size={16} />Choose files<input className="sr-only" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,application/pdf,.png,.jpg,.jpeg,image/png,image/jpeg" multiple disabled={busy} onChange={e => { void choose(e.target.files); e.target.value = ''; }} /></label>
                    </div>
                    {ai?.available ? <div role="group" aria-label="Samples in other formats (AI)" className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--muted-strong)]"><Sparkles aria-hidden="true" size={14} />Same documents, other formats (AI):</span>
                        {FORMATS.map(f => <button key={f.label} type="button" className={`${button} min-h-9 px-3 py-1 text-xs`} disabled={busy} onClick={() => void loadSample(f.paths)}>{f.label}</button>)}
                    </div> : null}
                    <p className="text-xs text-[var(--muted)]">Sample: a fictional bank statement and cash-account ledger for March 2026, plus 12 months of bank history (generated by <code>scripts/generate-demo-documents.mjs</code>). The quarter sample is a second fictional business with three months in Singapore dollars, where timing differences clear from one month to the next (<code>scripts/generate-quarter-documents.mjs</code>). You may instead choose your own files: CSV, Excel (.xlsx), PDF statements, or scans and photos (PDF, PNG, JPEG); you do not need to label them. Use only fictional or non-confidential test data.{ai?.available ? ' The unfamiliar-layout samples are the same fictional transactions exported with other headings, date and number formats; the Excel, PDF and scanned samples hold the same documents in those formats. They are read by the AI interpreter and checked against the arithmetic in each document. Scans are read by OCR in this browser, which can take up to a minute, and an OCR misreading of a reference code shows up as a reconciliation item to review.' : ''}</p>
                    {notice ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{notice}</p> : null}
                    {selected.length ? <ul aria-label="Selected documents" className="space-y-2">{selected.map(d => <li key={d.name} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"><span className="min-w-0 break-all">{d.name}</span><span className="shrink-0 text-xs text-[var(--muted)]">{kb(d.bytes.byteLength)} · {d.provenance === 'PUBLIC_SYNTHETIC_SAMPLE' ? 'sample' : 'yours'}</span></li>)}</ul>
                        : <p className="text-sm text-[var(--muted)]">No documents selected.</p>}
                    <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
                        <button type="button" className={primaryButton} disabled={busy || !selected.length || !!paused} onClick={() => void process(selected)}>{status === 'processing' ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Play aria-hidden="true" size={16} />}Process Financial Documents</button>
                        <button type="button" className={button} disabled={busy || (status !== 'ready' && status !== 'failed')} onClick={() => { clear(); setSelected([]); }}><RotateCcw aria-hidden="true" size={16} />Clear results</button>
                    </div>
                </div>
            </Panel>
            <Panel title="2. Processing stages" eyebrow="Browser demo runner">
                {context ? <p className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)] sm:px-5">Processing ID <code className="text-[var(--ink)]">{context.processingId}</code> · same documents always give the same ID</p> : null}
                <ol className="divide-y divide-[var(--border)]" aria-live="polite">
                    {stages.map(({ id, title, stage }, i) => <li key={id} className="px-4 py-3 sm:px-5">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold"><span className="mr-2 text-[var(--muted)]">{i + 1}</span>{title}</p>
                            {stage ? <DecisionBadge decision={stage.decision} /> : ended || status === 'processing' ? <span className="text-xs text-[var(--muted)]">{status === 'processing' ? 'Waiting' : 'Not run'}</span> : <PendingBadge />}
                        </div>
                        {stage ? <details className="mt-1 text-sm">
                            <summary className="cursor-pointer text-[var(--muted-strong)]">{stage.summary}</summary>
                            <p className="mt-2 text-xs text-[var(--muted)]">Method: {stage.method}</p>
                            <ul className="mt-2 space-y-1 text-xs">{stage.checks.map(c => <li key={c.id} className="flex gap-2"><span aria-hidden="true" className={c.passed ? 'text-[var(--green)]' : 'text-amber-700'}>{c.passed ? '✓' : '!'}</span><span><strong>{c.label}</strong> <span className="sr-only">{c.passed ? 'passed' : 'not passed'}</span>· {c.detail}</span></li>)}</ul>
                        </details> : null}
                    </li>)}
                </ol>
                {aiWait && status === 'processing' ? <p role="status" className="m-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-[var(--amber-soft)] p-3 text-sm"><LoaderCircle aria-hidden="true" className="shrink-0 animate-spin" size={16} />Waiting about {aiWait} s for the AI provider&apos;s per-minute limit before interpreting the next document.</p> : null}
                {error ? <p role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
            </Panel>
        </div>
        {context ? <div className="mt-5 space-y-5">
            <Panel title="3. Documents identified" eyebrow={processedAt ? `Processed ${new Date(processedAt).toLocaleString()}${persisted ? '' : ' · not kept after reload'}` : undefined}>
                <Table caption="Identified documents" columns={['Document', 'Role', 'Decision', 'Records', 'Scope', 'SHA-256']} rows={context.documents.map(d => [
                    <span key="n" className="grid gap-1"><span className="break-all">{d.name}</span>{d.source?.kind === 'WORKSHEET' ? <span className="text-xs text-[var(--muted)]">Worksheet {d.source.sheetNumber} of {d.source.workbook} · workbook SHA-256 <code>{d.source.workbookSha256.slice(0, 12)}…</code></span>
                        : d.source ? <span className="text-xs text-[var(--muted)]">{d.source.kind === 'OCR' ? `Read by OCR in this browser · ${d.source.confidence}% mean confidence` : 'PDF text layer'} · {d.source.pages} page{d.source.pages === 1 ? '' : 's'} · file SHA-256 <code>{d.source.fileSha256.slice(0, 12)}…</code></span> : null}</span>, d.role ? ROLE[d.role] : 'Not identified',
                    <span key="d" className="grid gap-1"><DecisionBadge decision={d.decision} label={d.decision === 'AUTO_ACCEPTED' && context.status === 'QUARANTINED' ? 'Identified · run quarantined' : undefined} /><span className="text-xs text-[var(--muted)]">{d.reason}</span></span>,
                    d.rows ?? '—', d.businessId ? `${d.businessId} · ${d.periods.length > 1 ? `${d.periods[0]} to ${d.periods.at(-1)}` : d.periods[0] ?? ''} · ${d.currency}` : '—',
                    <code key="s" className="break-all text-xs" title={d.sha256}>{d.sha256.slice(0, 16)}…</code>,
                ])} />
            </Panel>
            <InterpretationPanel context={context} />
            {scope && out?.reconciliation && out.totals ? <Panel title="4. Verified outputs" eyebrow={`${scope.businessName} · ${periodLabel(scope.period)} · ${scope.currency}`}>
                <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
                    <Stat label="Net signed bank movement" value={money(scope.currency, out.totals.net)} detail={`${out.totals.rows} bank records`} />
                    <Stat label="Bank − ledger difference" value={money(scope.currency, out.reconciliation.cashMovement.signedDifference)} detail={`Ledger ${money(scope.currency, out.reconciliation.cashMovement.ledger)}`} />
                    <Stat label="Matched automatically" value={`${out.reconciliation.counts.MATCH_EXACT + out.reconciliation.counts.MATCH_DATE_SHIFT} of ${out.reconciliation.results.length}`} detail={out.resolution ? `${out.resolution.totals.timing + out.resolution.totals.resolutions.ENTRY_PREPARED} differences resolved · ${out.resolution.attention.length} flagged` : `${context.quarantine.filter(q => q.kind === 'RECONCILIATION_EXCEPTION').length} exceptions flagged`} />
                    <Stat label="Next-month baseline" value={out.forecast?.forecast.status === 'AVAILABLE' ? money(scope.currency, out.forecast.forecast.net) : 'Unavailable'} detail={out.forecast?.forecast.status === 'AVAILABLE' ? `${out.forecast.forecast.period} net, six-month mean` : 'Needs 7 consecutive months'} />
                </div>
                <nav aria-label="Connected results" className="flex flex-wrap gap-2 border-t border-[var(--border)] p-4 sm:px-5">
                    {[['/', 'Overview'], ['/transactions', 'Transactions'], ['/reconciliation', 'Reconciliation'], ['/analytics', 'Analytics'], ['/anomalies', 'Anomalies'], ['/forecasting', 'Forecasting'], ['/reports', 'Reports'], ['/ask', 'Finance Q&A']].map(([href, label]) => <Link key={href} href={href} className={button}>{label}</Link>)}
                </nav>
                <SaveRun context={context} />
            </Panel> : <Panel title="4. Outputs"><p className="p-5 text-sm">No financial outputs were produced because the documents were quarantined. See the stage checks above for the exact reason.</p></Panel>}
        </div> : null}
    </>;
}
