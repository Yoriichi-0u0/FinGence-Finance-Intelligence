'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarRange, ChartNoAxesCombined, Check, ChevronRight, FileBarChart, FileSpreadsheet, FileText, Fingerprint, HardDrive, House, LoaderCircle, MessageSquareText, Play, ReceiptText, RefreshCw, RotateCcw, Server, ShieldAlert, Sparkles, TrendingUp, Upload } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui';
import { STAGE_TITLES, type DocumentInput, type StageId } from '@/lib/demo/pipeline';
import { useDemoProcessing } from './context';
import { DocumentEvidenceEntry } from './document-evidence';
import { InterpretationPanel } from './interpretation-panel';
import { SaveRun } from './save-run';
import { ROLE_LABEL, useWorkspace } from '@/components/workspace/context';
import { Callout, DecisionBadge, PendingBadge, Stat, Table, button, chip, money, periodLabel, primaryButton } from './shared';

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
    const { status, context, liveStages, processedAt, persisted, error, process, clear, ai, aiWait, serverJobs, serverState, inputs } = useDemoProcessing();
    const [selected, setSelected] = useState<DocumentInput[]>([]);
    const [notice, setNotice] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    // Paused by the workspace's Management (signed in) or by server processing's pause switch: either stops new processing.
    const workspace = useWorkspace(), paused = workspace.session?.processing.paused ? workspace.session.processing : serverState?.paused ? serverState : null;
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

    const stageDone = stages.filter(x => x.stage).length;
    const checks = liveStages.flatMap(x => x.checks), passed = checks.filter(c => c.passed).length;

    if (workspace.session && workspace.session.role !== 'FINANCE') return <>
        <PageHeader title="Data" description="Documents are processed by Finance users." />
        <Panel title={`Signed in as ${ROLE_LABEL[workspace.session.role]}`}>
            <div className="p-4 sm:p-5"><p className="text-sm">Your role does not process financial documents. {workspace.session.role === 'MANAGEMENT' ? 'Every run your Finance users process appears in Operations, with each check, model call and failure.' : 'Manage who can sign in, and with which role, in Team.'}</p>
            <Link href={workspace.session.role === 'MANAGEMENT' ? '/operations' : '/team'} className={`${primaryButton} mt-4`}>{workspace.session.role === 'MANAGEMENT' ? 'Open Operations' : 'Open Team'}</Link></div>
        </Panel>
    </>;
    return <>
        <PageHeader eyebrow="Step 1 · your documents" title="Data" description="Provide a bank statement and a general ledger once. FinGence identifies, verifies, reconciles and analyses them in one run." />
        <section role="note" aria-label="Public prototype data notice" className="mb-6 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-panel)]">
            <div className="flex gap-3 border-b border-[var(--warn-line)] bg-[var(--warn-soft)] px-4 py-3 text-sm">
                <ShieldAlert aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-[var(--warn)]" />
                <p><strong>Public prototype: do not submit confidential or real financial documents.</strong> The built-in sample documents are fictional.</p>
            </div>
            <ul className="grid gap-px bg-[var(--border)] sm:grid-cols-3" aria-label="How your documents are handled">
                <li className="flex gap-3 bg-[var(--surface)] px-4 py-3"><Server aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-[var(--brand)]" /><span className="text-[13px] leading-snug"><strong className="block text-sm">{serverJobs ? 'Processed on the FinGence server' : 'Processed in this browser'}</strong><span className="text-[var(--muted)]">{serverJobs ? 'Files are not stored there; this browser re-checks the result.' : 'Your own files are not uploaded to a server.'}</span></span></li>
                <li className="flex gap-3 bg-[var(--surface)] px-4 py-3"><Sparkles aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-[var(--brand)]" /><span className="text-[13px] leading-snug"><strong className="block text-sm">{ai?.available ? 'AI suggests layouts only' : 'Fixed rules, not live AI'}</strong><span className="text-[var(--muted)]">{ai?.available ? 'It sees headings and a few sample lines and never supplies an amount.' : 'Every figure is computed deterministically.'}</span></span></li>
                <li className="flex gap-3 bg-[var(--surface)] px-4 py-3"><HardDrive aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-[var(--brand)]" /><span className="text-[13px] leading-snug"><strong className="block text-sm">Kept in this tab only</strong><span className="text-[var(--muted)]">Until you press Clear results or close the tab.</span></span></li>
            </ul>
            <details className="group border-t border-[var(--border)] text-sm">
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-2 font-semibold text-[var(--brand-ink)]"><ChevronRight aria-hidden="true" size={16} className="disclosure-chevron transition-transform" />Exactly how your documents are handled</summary>
                <div className="space-y-2 px-4 pb-4 text-[13px] leading-relaxed text-[var(--muted-strong)]">
                    {serverJobs
                        ? <p><strong>Processing runs on the FinGence server.</strong> Your files are sent to the server for one processing job and are not stored there; the server stores their fingerprints, decisions, verified records, reconciliation and anomaly results. This browser then re-checks the result from the same files. Their contents are kept temporarily in this tab&apos;s sessionStorage so results survive a reload, until you press Clear results or close the tab.</p>
                        : <p>If you choose your own files, they are read and processed locally in this browser and are not uploaded to a server; scans and images are read by OCR here too (the OCR engine and its English language data are downloaded from the jsDelivr CDN). Their contents are kept temporarily in this tab&apos;s sessionStorage so results survive a reload, until you press Clear results or close the tab.</p>}
                    {ai?.available
                        ? <p><strong>AI layout interpretation is on.</strong> Documents in the supported layouts are recognised by fixed schema rules. For an unfamiliar layout, its headings, column profiles and a few sample lines (never the whole file) are sent through the FinGence server to {ai.model} on Groq, which proposes the layout. Deterministic checks on every row of the original file decide whether it is accepted; the model never supplies an amount, and every figure is computed {serverJobs ? 'on the server and re-checked in this browser' : 'in this browser'}.</p>
                        : <p>Roles and columns are recognised by fixed schema rules and every figure is computed deterministically. This is not live AI inference.</p>}
                </div>
            </details>
        </section>
        {paused ? <Callout role="alert" tone="bad" className="mb-6" title="Processing is paused by your technical team.">You can still look at earlier results; new documents cannot be processed until they resume it.{paused.reason ? ` Their note: ${paused.reason}` : ''}</Callout> : null}
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
            <Panel title="Choose documents" eyebrow="1 · Input">
                <div className="space-y-4 p-4 sm:p-5">
                    <div className="grid gap-2.5 sm:grid-cols-2">
                        <button type="button" className={tile} disabled={busy} onClick={() => void loadSample()}><span className={tileIcon}><FileSpreadsheet aria-hidden="true" size={18} /></span><span className="min-w-0"><span className="block font-semibold">Synthetic sample documents</span><span className="block text-xs font-normal text-[var(--muted)]">One month · March 2026 · MYR</span></span></button>
                        <button type="button" className={tile} disabled={busy} onClick={() => void loadSample(QUARTER)}><span className={tileIcon}><CalendarRange aria-hidden="true" size={18} /></span><span className="min-w-0"><span className="block font-semibold">Quarter sample</span><span className="block text-xs font-normal text-[var(--muted)]">3 months · January to March 2026 · SGD</span></span></button>
                    </div>
                    <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-[var(--border-strong)] bg-[var(--surface-subtle)] px-4 py-4 text-center text-sm transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                        <span className="inline-flex items-center gap-2 font-semibold text-[var(--brand-ink)]"><Upload aria-hidden="true" size={17} />Choose files</span>
                        <span className="text-xs text-[var(--muted)]">CSV, Excel, PDF, or a scan or photo · up to 6 files · no labels needed</span>
                        <input className="sr-only" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,application/pdf,.png,.jpg,.jpeg,image/png,image/jpeg" multiple disabled={busy} onChange={e => { void choose(e.target.files); e.target.value = ''; }} />
                    </label>
                    {ai?.available ? <div role="group" aria-label="Samples in other formats (AI)" className="space-y-2">
                        <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--muted-strong)]"><Sparkles aria-hidden="true" size={14} className="text-[var(--brand)]" />Same documents, other formats (AI):</p>
                        <div className="flex flex-wrap gap-2">{FORMATS.map(f => <button key={f.label} type="button" className={chip(false)} disabled={busy} onClick={() => void loadSample(f.paths)}>{f.label}</button>)}</div>
                    </div> : null}
                    <details className="text-xs text-[var(--muted)]">
                        <summary className="inline-flex min-h-9 cursor-pointer items-center gap-1 font-semibold text-[var(--muted-strong)]"><ChevronRight aria-hidden="true" size={14} className="disclosure-chevron transition-transform" />About the samples and your own files</summary>
                        <p className="mt-1 leading-relaxed">Sample: a fictional bank statement and cash-account ledger for March 2026, plus 12 months of bank history (generated by <code>scripts/generate-demo-documents.mjs</code>). The quarter sample is a second fictional business with three months in Singapore dollars, where timing differences clear from one month to the next (<code>scripts/generate-quarter-documents.mjs</code>). You may instead choose your own files: CSV, Excel (.xlsx), PDF statements, or scans and photos (PDF, PNG, JPEG); you do not need to label them. Use only fictional or non-confidential test data.{ai?.available ? ` The unfamiliar-layout samples are the same fictional transactions exported with other headings, date and number formats; the Excel, PDF and scanned samples hold the same documents in those formats. They are read by the AI interpreter and checked against the arithmetic in each document. Scans are read by OCR ${serverJobs ? 'on the server and again in this browser' : 'in this browser'}, which can take up to a minute, and an OCR misreading of a reference code shows up as a reconciliation item to review.` : ''}</p>
                    </details>
                    {notice ? <Callout role="alert" tone="bad">{notice}</Callout> : null}
                    <div>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">Selected {selected.length ? `· ${selected.length}` : ''}</p>
                        {selected.length ? <ul aria-label="Selected documents" className="space-y-1.5">{selected.map(d => <li key={d.name} className="flex min-w-0 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm"><FileText aria-hidden="true" size={16} className="shrink-0 text-[var(--muted)]" /><span className="min-w-0 flex-1 break-all">{d.name}</span><span className="shrink-0 text-xs text-[var(--muted)]">{kb(d.bytes.byteLength)} · {d.provenance === 'PUBLIC_SYNTHETIC_SAMPLE' ? 'sample' : 'yours'}</span></li>)}</ul>
                            : <p className="rounded-xl border border-dashed border-[var(--border)] px-3 py-3 text-sm text-[var(--muted)]">No documents selected.</p>}
                    </div>
                    <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4 sm:flex-row">
                        <button type="button" className={`${primaryButton} sm:flex-1`} disabled={busy || !selected.length || !!paused} onClick={() => void process(selected)}>{status === 'processing' ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Play aria-hidden="true" size={16} />}Process Financial Documents</button>
                        <button type="button" className={button} disabled={busy || (status !== 'ready' && status !== 'failed')} onClick={() => { clear(); setSelected([]); }}><RotateCcw aria-hidden="true" size={16} />Clear results</button>
                    </div>
                </div>
            </Panel>
            <Panel title="Processing stages" eyebrow={`2 · ${serverJobs ? 'Server processing job' : 'Browser demo runner'}`} action={stageDone ? <span className="text-xs font-medium text-[var(--muted)]">{stageDone} of {stages.length} stages · {passed} of {checks.length} checks passed</span> : undefined}>
                {context ? <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-xs text-[var(--muted)] sm:px-5"><Fingerprint aria-hidden="true" size={14} className="text-[var(--brand)]" /><span>Processing ID <code className="break-all text-[var(--ink)]">{context.processingId}</code> · same documents always give the same ID{context.job ? <> · server job <code className="break-all text-[var(--ink)]">{context.job.id}</code>, results stored, re-checked in this browser</> : null}</span></p> : null}
                <ol className="px-4 py-3 sm:px-5" aria-live="polite">
                    {stages.map(({ id, title, stage }, i) => {
                        const tone = stage ? stage.decision === 'AUTO_ACCEPTED' ? 'bg-[var(--good)] text-white' : stage.decision === 'QUARANTINED' ? 'bg-[var(--warn)] text-white' : 'bg-[var(--border-strong)] text-[var(--ink)]' : status === 'processing' && i === stageDone ? 'bg-[var(--brand-soft)] text-[var(--brand)] ring-2 ring-[var(--brand)]' : 'bg-[var(--surface-sunken)] text-[var(--muted)]';
                        return <li key={id} className="relative flex gap-3 pb-3 last:pb-0">
                            {i < stages.length - 1 ? <span aria-hidden="true" className={`absolute left-[13px] top-8 bottom-0 w-px ${stage ? 'bg-[var(--good-line)]' : 'bg-[var(--border)]'}`} /> : null}
                            <span aria-hidden="true" className={`relative z-[1] grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${tone}`}>{stage?.decision === 'AUTO_ACCEPTED' ? <Check size={15} strokeWidth={3} /> : status === 'processing' && !stage && i === stageDone ? <LoaderCircle size={14} className="animate-spin" /> : i + 1}</span>
                            <div className="min-w-0 flex-1 pt-0.5">
                                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
                                    <p className="text-sm font-semibold"><span className="sr-only">{i + 1} </span>{title}</p>
                                    {stage ? <DecisionBadge decision={stage.decision} /> : ended || status === 'processing' ? <span className="text-xs text-[var(--muted)]">{status === 'processing' ? 'Waiting' : 'Not run'}</span> : <PendingBadge />}
                                </div>
                                {stage ? <details className="mt-1 text-sm">
                                    <summary className="flex cursor-pointer gap-1 text-[13px] leading-snug text-[var(--muted-strong)]"><ChevronRight aria-hidden="true" size={14} className="disclosure-chevron mt-0.5 shrink-0 transition-transform" /><span>{stage.summary}</span></summary>
                                    <div className="mt-2 rounded-xl bg-[var(--surface-subtle)] p-3 ring-1 ring-inset ring-[var(--border)]">
                                        <p className="text-xs text-[var(--muted)]">Method: {stage.method}</p>
                                        <ul className="mt-2 space-y-1.5 text-xs">{stage.checks.map(c => <li key={c.id} className="flex gap-2"><span aria-hidden="true" className={`mt-px grid size-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${c.passed ? 'bg-[var(--good-soft)] text-[var(--good)]' : 'bg-[var(--warn-soft)] text-[var(--warn)]'}`}>{c.passed ? '✓' : '!'}</span><span><strong>{c.label}</strong> <span className="sr-only">{c.passed ? 'passed' : 'not passed'}</span>· {c.detail}</span></li>)}</ul>
                                    </div>
                                </details> : null}
                            </div>
                        </li>;
                    })}
                </ol>
                {aiWait && status === 'processing' ? <Callout role="status" tone="warn" className="m-4"><span className="inline-flex items-center gap-2"><LoaderCircle aria-hidden="true" className="shrink-0 animate-spin" size={16} />Waiting about {aiWait} s for the AI provider&apos;s per-minute limit before interpreting the next document.</span></Callout> : null}
                {error ? <Callout role="alert" tone="bad" className="m-4">{error}</Callout> : null}
            </Panel>
        </div>
        {context ? <div className="mt-6 space-y-5">
            {scope && out?.reconciliation && out.totals ? <Panel title="Verified outputs" eyebrow={`3 · Results · ${scope.businessName} · ${periodLabel(scope.period)} · ${scope.currency}`}>
                <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
                    <Stat tone="brand" label="Net signed bank movement" value={money(scope.currency, out.totals.net)} detail={`${out.totals.rows} bank records`} />
                    <Stat tone="brand" label="Bank − ledger difference" value={money(scope.currency, out.reconciliation.cashMovement.signedDifference)} detail={`Ledger ${money(scope.currency, out.reconciliation.cashMovement.ledger)}`} />
                    <Stat tone="good" label="Matched automatically" value={`${out.reconciliation.counts.MATCH_EXACT + out.reconciliation.counts.MATCH_DATE_SHIFT} of ${out.reconciliation.results.length}`} detail={out.resolution ? `${out.resolution.totals.timing + out.resolution.totals.resolutions.ENTRY_PREPARED} differences resolved · ${out.resolution.attention.length} flagged` : `${context.quarantine.filter(q => q.kind === 'RECONCILIATION_EXCEPTION').length} exceptions flagged`} />
                    <Stat tone="plain" label="Next-month baseline" value={out.forecast?.forecast.status === 'AVAILABLE' ? money(scope.currency, out.forecast.forecast.net) : 'Unavailable'} detail={out.forecast?.forecast.status === 'AVAILABLE' ? `${out.forecast.forecast.period} net, six-month mean` : 'Needs 7 consecutive months'} />
                </div>
                <nav aria-label="Connected results" className="grid grid-cols-2 gap-2 border-t border-[var(--border)] p-4 sm:grid-cols-4 sm:px-5">
                    {([['/', 'Overview', House], ['/transactions', 'Transactions', ReceiptText], ['/reconciliation', 'Reconciliation', RefreshCw], ['/analytics', 'Analytics', ChartNoAxesCombined], ['/anomalies', 'Anomalies', AlertTriangle], ['/forecasting', 'Forecasting', TrendingUp], ['/reports', 'Reports', FileBarChart], ['/ask', 'Finance Q&A', MessageSquareText]] as const).map(([href, label, Icon]) => <Link key={href} href={href} className="group flex min-h-12 items-center gap-2.5 rounded-xl border border-[var(--border)] px-3 text-sm font-semibold transition-colors hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)]"><Icon aria-hidden="true" size={17} className="shrink-0 text-[var(--brand)]" /><span className="min-w-0 flex-1 truncate">{label}</span><ArrowRight aria-hidden="true" size={15} className="hidden shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5 sm:block" /></Link>)}
                </nav>
                {context.job ? null : <SaveRun context={context} />}
            </Panel> : <Panel title="Outputs" eyebrow="3 · Results"><p className="p-5 text-sm">No financial outputs were produced because the documents were quarantined. See the stage checks above for the exact reason.</p></Panel>}
            <Panel title="Documents identified" eyebrow={processedAt ? `4 · Processed ${new Date(processedAt).toLocaleString()}${persisted ? '' : ' · not kept after reload'}` : '4 · Documents'}>
                <Table caption="Identified documents" columns={['Document', 'Role', 'Decision', 'Records', 'Scope', 'SHA-256']} rows={context.documents.map(d => [
                    <span key="n" className="grid gap-1"><span className="break-all">{d.name}</span>{d.source?.kind === 'WORKSHEET' ? <span className="text-xs font-normal text-[var(--muted)]">Worksheet {d.source.sheetNumber} of {d.source.workbook} · workbook SHA-256 <code>{d.source.workbookSha256.slice(0, 12)}…</code></span>
                        : d.source ? <span className="text-xs font-normal text-[var(--muted)]">{d.source.kind === 'OCR' ? `Read by OCR ${context.job ? 'on the server' : 'in this browser'} · ${d.source.confidence}% mean confidence` : 'PDF text layer'} · {d.source.pages} page{d.source.pages === 1 ? '' : 's'} · file SHA-256 <code>{d.source.fileSha256.slice(0, 12)}…</code></span> : null}</span>, d.role ? ROLE[d.role] : 'Not identified',
                    <span key="d" className="grid justify-items-start gap-1"><DecisionBadge decision={d.decision} label={d.decision === 'AUTO_ACCEPTED' && context.status === 'QUARANTINED' ? 'Identified · run quarantined' : undefined} /><span className="text-xs text-[var(--muted)]">{d.reason}</span></span>,
                    d.rows ?? '—', d.businessId ? `${d.businessId} · ${d.periods.length > 1 ? `${d.periods[0]} to ${d.periods.at(-1)}` : d.periods[0] ?? ''} · ${d.currency}` : '—',
                    <code key="s" className="break-all text-xs" title={d.sha256}>{d.sha256.slice(0, 16)}…</code>,
                ])} />
            </Panel>
            <DocumentEvidenceEntry context={context} inputs={inputs} />
            <InterpretationPanel context={context} />
        </div> : null}
    </>;
}

const tile = 'flex min-h-16 w-full items-center gap-3 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 py-3 text-left text-sm text-[var(--ink)] transition-colors hover:border-[var(--brand)] hover:bg-[var(--brand-soft)] disabled:cursor-not-allowed disabled:opacity-50';
const tileIcon = 'grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]';
