'use client';
import { useRef, useState } from 'react';
import { FileSpreadsheet, LoaderCircle, Play, RotateCcw, Sparkles, Upload, FileText } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui';
import { STAGE_TITLES, type DocumentInput, type StageId } from '@/lib/demo/pipeline';
import { loadSampleDocuments, UNFAMILIAR_SAMPLES, SAMPLE_ERROR } from '@/lib/demo/samples';
import { isBuiltInSample } from '@/lib/demo/sample-navigation';
import { isReady } from './modules';
import { useDemoProcessing } from './context';
import { SaveRun } from './save-run';
import { InterpretationPanel } from './interpretation-panel';
import { DataWorkflow } from './data-workflow';
import workflowStyles from './data-workflow.module.css';
import { dataStatus, reportedProgress, stagePresentation } from './data-presentation';
import { DecisionBadge, Stat, Table, button, money, periodLabel, primaryButton } from './shared';

/** A second fictional business: one quarter (January to March 2026) in SGD, with timing differences that clear across months. */
const QUARTER = ['quarter/demo-bank-statement-2026-q1-sgd.csv', 'quarter/demo-general-ledger-2026-q1-sgd.csv', 'quarter/demo-bank-history-2025-04-to-2026-03-sgd.csv'];
/** The same documents as an Excel workbook, as text PDFs and as scans (all need the AI gateway), plus the canonical history. */
const FORMATS = [
    { label: 'Unfamiliar CSV', paths: UNFAMILIAR_SAMPLES },
    { label: 'Excel workbook', paths: ['unfamiliar/rimba-demo-kitchen-march-2026.xlsx', 'demo-bank-history-2025-04-to-2026-03.csv'] },
    { label: 'PDF statements', paths: ['unfamiliar/bank-statement-march-2026.pdf', 'unfamiliar/general-ledger-cash-march-2026.pdf', 'demo-bank-history-2025-04-to-2026-03.csv'] },
    { label: 'Scanned (OCR)', paths: ['unfamiliar/bank-statement-march-2026-scan.pdf', 'unfamiliar/general-ledger-cash-march-2026-scan.jpg', 'demo-bank-history-2025-04-to-2026-03.csv'] },
];
const ROLE: Record<string, string> = { BANK_STATEMENT: 'Bank statement', GENERAL_LEDGER: 'General ledger (cash account)', BANK_HISTORY: 'Bank transaction history' };
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/** Phase 1 Data experience: select documents once, process once, inspect every stage's evidence. */
export default function DemoDataWorkspace() {
    const { status, context, liveStages, processedAt, persisted, error, process, clear, ai, aiWait, serverJobs, serverState } = useDemoProcessing();
    const [selected, setSelected] = useState<DocumentInput[]>([]);
    const [notice, setNotice] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [replaceSample, setReplaceSample] = useState<string | null>(null);
    const processing = useRef(false);
    const busy = status === 'processing' || loading, paused = !!serverState?.paused;
    const sampleActive = isReady(context) && isBuiltInSample(context);
    const confirmingReplacement = sampleActive && replaceSample === context.processingId;

    async function processSelection(confirmed = false) {
        if (busy || paused || processing.current || !selected.length) return;
        if (sampleActive && !confirmed) { setReplaceSample(context.processingId); return; }
        if (confirmed && !confirmingReplacement) return;
        processing.current = true; setReplaceSample(null);
        try { await process(selected); } finally { processing.current = false; }
    }

    async function loadSample(paths?: readonly string[]) {
        setLoading(true); setNotice(null); setReplaceSample(null);
        try {
            const files = await loadSampleDocuments(paths);
            setSelected(files);
        } catch { setNotice(SAMPLE_ERROR); }
        finally { setLoading(false); }
    }
    async function choose(list: FileList | null) {
        if (!list?.length) return;
        setReplaceSample(null);
        setSelected(await Promise.all([...list].slice(0, 6).map(async file => ({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), provenance: 'USER_SUPPLIED' as const }))));
        setNotice(null);
    }
    const stages = (Object.keys(STAGE_TITLES) as StageId[]).map(id => ({ id, title: STAGE_TITLES[id], stage: liveStages.find(s => s.id === id) }));
    const ended = status === 'ready' || status === 'failed';
    const scope = context?.scope, out = context?.outputs;

    const state = dataStatus(status, context, selected.length, loading), progress = reportedProgress(liveStages);
    const completed = isReady(context);
    const latest = liveStages.at(-1);
    return <div className="data-processing">
        <p className="data-eyebrow">FINANCIAL WORKSPACE</p>
        <PageHeader title="Data Processing" description="Upload, verify and process your financial documents." actions={<div className={workflowStyles.headerActions}><span className="data-status" data-tone={state.tone} role="status">{state.label}</span></div>} />

        {paused && serverState ? <p role="alert" className="data-review-warning"><strong>Processing is paused by your technical team.</strong> {serverState.reason ? `Reason: ${serverState.reason}. ` : ''}New documents cannot be processed until it is resumed.</p> : null}
        <DataWorkflow status={status} completed={completed} selected={selected.length} quarantined={context?.status === 'QUARANTINED'} />
        <div className="data-workflow-grid">
            <Panel title="Financial Documents" eyebrow="Step 1 · Choose documents" className="data-documents">
                <div className="space-y-4 p-4 sm:p-5">
                    {sampleActive && <aside className="demo-sample-notice" aria-label="Current sample results"><strong>You are currently viewing sample data. Processing new documents will replace these results.</strong><p>Choose supported test documents below. Selecting files or visiting this page keeps the current results; replacement starts only when you confirm processing.</p></aside>}
                    <div className="data-document-choices">
                        <button type="button" className={`${button} data-sample-choice`} disabled={busy} onClick={() => void loadSample()}><FileSpreadsheet aria-hidden="true" size={16} />Use synthetic sample documents</button>
                        <button type="button" className={button} disabled={busy} onClick={() => void loadSample(QUARTER)}><FileSpreadsheet aria-hidden="true" size={16} />Quarter sample (3 months, SGD)</button>
                        {ai?.available ? <div role="group" aria-label="Samples in other formats (AI)" className="flex flex-wrap gap-2">{FORMATS.map(f => <button key={f.label} type="button" className={button} disabled={busy} onClick={() => void loadSample(f.paths)}><Sparkles size={14} aria-hidden="true"/>{f.label}</button>)}</div> : null}
                        <label className="data-upload-choice"><Upload aria-hidden="true" size={26} /><strong>Choose files</strong><span>Bank statement, cash-account ledger and optional bank history. CSV, Excel (.xlsx), PDF, PNG and JPEG; unfamiliar formats require the enabled AI interpreter.</span><input aria-label="Choose files" className="sr-only" type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,application/pdf,.png,.jpg,.jpeg,image/png,image/jpeg" multiple disabled={busy} onChange={e => { void choose(e.target.files); e.target.value = ''; }} /></label>
                    </div>
                    <div className={workflowStyles.disclosure}><p>Built-in samples are fictional. Use only fictional or non-confidential test documents.</p>{serverJobs ? <p>Files are sent to the FinGence server for processing. Documents are not stored. Verified records, results and flagged items are kept; this browser re-checks the job before displaying them.</p> : <p>Supported files are processed locally in this browser and are not uploaded to a server. Scans and images use browser OCR; the OCR engine and English data are downloaded from jsDelivr.</p>}{ai?.available ? <p>For unfamiliar layouts, headings, column profiles and a few sample lines (never the whole file) are sent through the FinGence server to {ai.model} on Groq for a layout proposal. Deterministic checks verify every original row; the model never supplies amounts.</p> : <p>Processing uses deterministic rules, not live AI, when the interpreter is not enabled.</p>}<p>Temporary document contents in this tab&apos;s sessionStorage survive reloads until Clear results or tab closure. Processing supports one stated currency and several months; the quarter sample demonstrates January–March in SGD.</p></div>
                    {notice ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{notice}</p> : null}
                    <div className="data-selected-heading"><h3>Selected documents</h3><span>{selected.length} selected</span></div>
                    {selected.length ? <ul aria-label="Selected documents" className="data-selected-files">{selected.map(d => <li key={d.name}><FileText size={20} aria-hidden="true"/><div><strong>{d.name}</strong><p>{d.name.split('.').at(-1)?.toUpperCase() || 'File type unverified'} · {kb(d.bytes.byteLength)} · {d.provenance === 'PUBLIC_SYNTHETIC_SAMPLE' ? 'Fictional sample' : 'Your selection'}</p></div><span className="data-status" data-tone="neutral">Selected</span></li>)}</ul>
                        : <p className="data-selection-empty">No documents selected. Choose fictional samples or supported test files to begin.</p>}

                    <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
                        <button type="button" className={`${primaryButton} data-process-action`} disabled={busy || paused || !selected.length} onClick={() => void processSelection()}>{status === 'processing' ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Play aria-hidden="true" size={16} />}Process Financial Documents</button>
                        <button type="button" className={button} disabled={busy || (status !== 'ready' && status !== 'failed')} onClick={() => { clear(); setSelected([]); setReplaceSample(null); }}><RotateCcw aria-hidden="true" size={16} />Clear results</button>
                    </div>
                    {confirmingReplacement && <div className="demo-replace-confirmation" role="group" aria-label="Replace sample results"><h3>Replace the sample results?</h3><p>Processing the selected documents replaces this sample context. If verification fails or documents are quarantined, the previous sample dashboard will not be shown as the new result. You can cancel and keep exploring the sample.</p><div><button type="button" className={primaryButton} disabled={busy || paused} onClick={() => void processSelection(true)}>Replace Sample and Process</button><button type="button" className={button} disabled={busy} onClick={() => setReplaceSample(null)}>Cancel</button></div></div>}
                   </div>
            </Panel>
            <Panel title="Processing Progress" eyebrow="Step 2 · Process and verify" className="data-progress-panel">
                <div className="data-progress-summary"><div><span className="data-status" data-tone={state.tone}>{state.label}</span><strong aria-live="polite" aria-atomic="true">{progress.reported} / {progress.total}<small> stages reported</small></strong></div><progress aria-label="Reported processing stages" value={progress.reported} max={progress.total}/><p>{latest ? `Latest reported stage: ${latest.title}` : 'No stages reported yet. Progress updates only when the processing runner returns a stage result.'}</p>{context?.status === 'QUARANTINED' && <p className="data-review-warning">Documents did not produce verified financial outputs. Inspect the stage evidence below.</p>}{context && context.quarantine.length > 0 && <p className="data-review-warning">{context.quarantine.length} review findings retained. Findings may overlap; they are not confirmed fraud.</p>}</div>
                {context ? <p className="border-b border-[var(--border)] px-4 py-2 text-xs text-[var(--muted)] sm:px-5">Processing ID <code className="text-[var(--ink)]">{context.processingId}</code> · same documents always give the same ID{context.job ? <> · server job <code>{context.job.id}</code>, results stored and re-checked in this browser</> : null}</p> : null}
                <details key={status === 'processing' ? 'running' : status === 'ready' ? 'finished' : status} className="data-stage-details"><summary>View All Processing Stages <span>{progress.reported} of {progress.total} reported</span></summary><ol className="divide-y divide-[var(--border)]" aria-live="polite">
                    {stages.map(({ id, title, stage }, i) => <li key={id} className="px-4 py-3 sm:px-5">
                        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold"><span className="mr-2 text-[var(--muted)]">{i + 1}</span>{title}</p>
                            <span className="data-status" data-tone={stagePresentation(stage, ended).tone}>{stagePresentation(stage, ended).label}</span>
                        </div>
                        {stage ? <details className="mt-1 text-sm">
                            <summary className="cursor-pointer text-[var(--muted-strong)]">{stage.summary}</summary>
                            <p className="mt-2 text-xs text-[var(--muted)]">Method: {stage.method}</p>
                            <ul className="mt-2 space-y-1 text-xs">{stage.checks.map(c => <li key={c.id} className="flex gap-2"><span aria-hidden="true" className={c.passed ? 'text-[var(--green)]' : 'text-amber-700'}>{c.passed ? '✓' : '!'}</span><span><strong>{c.label}</strong> <span className="sr-only">{c.passed ? 'passed' : 'not passed'}</span>· {c.detail}</span></li>)}</ul>
                        </details> : null}
                    </li>)}
                </ol></details>
                {aiWait && status === 'processing' ? <p role="status" className="m-4 text-sm">Waiting about {aiWait} s for the AI provider&apos;s per-minute limit before the next document.</p> : null}
                {error ? <p role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
            </Panel>
        </div>
        <div className="mt-5 space-y-5">
            {completed && scope && out?.reconciliation && out.totals ? <Panel title="Verified Financial Summary" className="data-summary" eyebrow={`${scope.businessName} · ${periodLabel(scope.period)} · ${scope.currency}`}>
                <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">
                    <Stat label="Net signed bank movement" value={money(scope.currency, out.totals.net)} detail={`${out.totals.rows} bank records`} />
                    <Stat label="Bank − ledger difference" value={money(scope.currency, out.reconciliation.cashMovement.signedDifference)} detail={`Ledger ${money(scope.currency, out.reconciliation.cashMovement.ledger)}`} />
                    <Stat label="Matched automatically" value={`${out.reconciliation.counts.MATCH_EXACT + out.reconciliation.counts.MATCH_DATE_SHIFT} of ${out.reconciliation.results.length}`} detail={out.resolution ? `${out.resolution.totals.timing + out.resolution.totals.resolutions.ENTRY_PREPARED} differences resolved · ${out.resolution.attention.length} flagged` : `${context.quarantine.filter(q => q.kind === 'RECONCILIATION_EXCEPTION').length} exceptions flagged`} />
                    <Stat label="Next-month baseline" value={out.forecast?.forecast.status === 'AVAILABLE' ? money(scope.currency, out.forecast.forecast.net) : 'Unavailable'} detail={out.forecast?.forecast.status === 'AVAILABLE' ? `${out.forecast.forecast.period} net, six-month mean` : 'Needs 7 consecutive months'} />
                </div>{context.job ? null : <SaveRun context={context} />}<p className="data-forecast-note">A forecast baseline is an estimate, not a guaranteed financial outcome. Cash movement is not revenue, expenses or profit.</p>
            </Panel> : <Panel title="Verified Financial Summary" className="data-summary"><p className={workflowStyles.empty}>{context?.status === 'QUARANTINED' ? 'Financial outputs unavailable. Documents were quarantined; inspect the stage evidence above.' : status === 'processing' ? 'Processing documents. Verified financial outputs are not available yet.' : status === 'failed' ? 'Financial outputs unavailable. Processing failed; inspect the error above.' : 'No financial data processed yet.'}</p><div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-4">{['Net Signed Bank Movement', 'Bank and Ledger Difference', 'Matched Automatically', 'Next Month Baseline'].map(label => <Stat key={label} label={label} value="—" detail="Awaiting verified output" />)}</div></Panel>}
            <Panel title="Identified Documents" className="data-identified" action={<span className="data-status" data-tone="neutral">{context?.documents.length ?? 0} documents</span>} eyebrow={processedAt ? `Processed ${new Date(processedAt).toLocaleString()}${persisted ? '' : ' · not kept after reload'}` : undefined}>
                {context?.documents.length ? <Table caption="Identified documents" columns={['Document', 'Role', 'Decision', 'Records', 'Scope', 'SHA-256']} rows={context.documents.map(d => [
                    <span key="n" className="grid gap-1"><span className="break-all">{d.name}</span>{d.source?.kind === 'WORKSHEET' ? <span className="text-xs text-[var(--muted)]">Worksheet {d.source.sheetNumber} of {d.source.workbook} · workbook SHA-256 <code>{d.source.workbookSha256.slice(0, 12)}…</code></span>
                        : d.source ? <span className="text-xs text-[var(--muted)]">{d.source.kind === 'OCR' ? `Read by OCR ${context.job ? 'on the server' : 'in this browser'} · ${d.source.confidence}% mean confidence` : 'PDF text layer'} · {d.source.pages} page{d.source.pages === 1 ? '' : 's'} · file SHA-256 <code>{d.source.fileSha256.slice(0, 12)}…</code></span> : null}</span>, <span key="role" className="data-role">{d.role ? ROLE[d.role] : 'Not identified'}</span>,
                    <span key="d" className="grid gap-1"><DecisionBadge decision={d.decision} label={d.decision === 'AUTO_ACCEPTED' && context.status === 'QUARANTINED' ? 'Identified · run quarantined' : undefined} /><span className="text-xs text-[var(--muted)]">{d.reason}</span></span>,
                    d.rows ?? '—', d.businessId ? `${d.businessId} · ${d.periods.length > 1 ? `${d.periods[0]} to ${d.periods.at(-1)}` : d.periods[0] ?? ''} · ${d.currency}` : '—',
                    <div key="s" className="data-fingerprint"><code title={d.sha256}>{d.sha256.slice(0, 16)}…</code><details><summary>Full fingerprint</summary><code>{d.sha256}</code></details></div>,
                ])} /> : <p className={workflowStyles.empty}>No documents identified yet.</p>}
                {context && <InterpretationPanel context={context} />}
            </Panel>


        </div>
    </div>;
}
