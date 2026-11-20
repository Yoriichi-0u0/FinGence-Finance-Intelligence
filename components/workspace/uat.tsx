'use client';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, ClipboardCheck, Download, LoaderCircle, RefreshCw, Send } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui';
import { button, chip, field, primaryButton } from '@/components/demo/shared';
import {
    describeDevice, EMPTY_ANSWERS, issues, KINDS, KNOWN_LIMITATIONS, NOTE_MAX, OVERALL, progress, RESULTS, resultsCsv, setTask, SEVERITIES, signOff, tasksFor, UAT_TASKS,
    type Tester, type UatAnswers, type UatKind, type UatResult, type UatSeverity,
} from '@/lib/uat/tasks';
import { atLeast, plainMessage, ROLE_LABEL, useWorkspace } from './context';

type Saved = { answers: UatAnswers | null; submittedAt: string | null; updatedAt: string | null };
type SaveState = 'idle' | 'saving' | 'saved' | 'error';
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const RESULT_TONE: Record<UatResult, string> = {
    PASS: 'bg-[var(--good-soft)] text-[var(--good-ink)] ring-[var(--good-line)]',
    ISSUE: 'bg-[var(--bad-soft)] text-[var(--bad-ink)] ring-[var(--bad-line)]',
    NOT_DONE: 'bg-[var(--surface-subtle)] text-[var(--muted-strong)] ring-[var(--border)]',
};
const badge = 'inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset';

/** "Open **Data** and…" with the on-screen names in bold. */
function Rich({ text }: { text: string }) {
    return <>{text.split(/(\*\*[^*]+\*\*)/).map((part, i) => part.startsWith('**') ? <strong key={i} className="font-semibold text-[var(--ink)]">{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>)}</>;
}

/**
 * The Testing checklist (SAIC UAT): the acceptance-testing tasks, each with what to do, what should happen and one question,
 * where every tester records what happened. Answers save as they go, to the tester's own record; Admins and Superadmins
 * also see everyone's results in the organization, with the guide's sign-off criteria and a CSV for the technical report.
 */
export function TestingChecklist() {
    const workspace = useWorkspace();
    const admin = atLeast(workspace.viewRole ?? undefined, 'ADMIN');
    const [tab, setTab] = useState<'mine' | 'all'>('mine');
    const shown = admin ? tab : 'mine';
    return <>
        <PageHeader eyebrow="Workspace" title="Testing checklist"
            description="Work through each task on your own, in order, and record what happened. Where you get stuck is a finding too. Your answers save as you go." />
        {admin ? <div role="group" aria-label="Whose results" className="mb-4 flex flex-wrap gap-2">
            {([['mine', 'My checklist'], ['all', 'Everyone’s results']] as const).map(([k, label]) => <button key={k} type="button" aria-pressed={shown === k} className={chip(shown === k)} onClick={() => setTab(k)}>{label}</button>)}
        </div> : null}
        {workspace.loading ? <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle aria-hidden="true" size={16} className="animate-spin" />Loading…</p>
            : shown === 'all' ? <EveryonesResults /> : <MyChecklist admin={admin} />}
    </>;
}

function MyChecklist({ admin }: { admin: boolean }) {
    const workspace = useWorkspace();
    const [answers, setAnswers] = useState<UatAnswers | null>(null), [loadError, setLoadError] = useState<string | null>(null);
    const [state, setState] = useState<SaveState>('idle'), [savedAt, setSavedAt] = useState<string | null>(null), [submittedAt, setSubmittedAt] = useState<string | null>(null);
    const [open, setOpen] = useState<Set<number>>(new Set()), [problem, setProblem] = useState<string | null>(null), [device, setDevice] = useState('');
    const latest = useRef<UatAnswers | null>(null), dirty = useRef(false), timer = useRef<ReturnType<typeof setTimeout> | null>(null), chain = useRef(Promise.resolve());
    // This page's saves, in the order they were made: the database keeps the newest even if an older one arrives last.
    const page = useRef(''), seq = useRef(0);

    const payload = useCallback((submit: boolean) => {
        const device = describeDevice(navigator.userAgent, window.innerWidth);
        if (!page.current) page.current = crypto.randomUUID().replace(/-/g, '');
        seq.current += 1;
        return JSON.stringify({ answers: { ...latest.current!, context: { device } }, order: { page: page.current, seq: seq.current }, ...(submit ? { submit: true } : {}) });
    }, []);
    const save = useCallback((submit = false) => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
        if (!latest.current) return Promise.resolve(false);
        let ok = false;
        // One save at a time, always with the latest answers.
        chain.current = chain.current.then(async () => {
            const body = payload(submit);
            dirty.current = false; setState('saving');
            const res = await fetch('/api/workspace/uat', { method: 'PUT', headers: { 'content-type': 'application/json' }, body }).catch(() => null);
            const out = await res?.json().catch(() => null) as { submittedAt: string | null; updatedAt: string } | null;
            if (!res?.ok || !out) { dirty.current = true; setState('error'); return; }
            ok = true; setState('saved'); setSavedAt(out.updatedAt); setSubmittedAt(out.submittedAt);
        });
        return chain.current.then(() => ok);
    }, [payload]);

    useEffect(() => {
        let gone = false;
        void (async () => {
            const res = await fetch('/api/workspace/uat', { cache: 'no-store' }).catch(() => null);
            const body = await res?.json().catch(() => null) as Saved & { code?: string } | null;
            if (gone) return;
            if (!res?.ok || !body) { setLoadError(plainMessage(body?.code)); return; }
            const loaded = body.answers ?? EMPTY_ANSWERS;
            latest.current = loaded; setAnswers(loaded); setSavedAt(body.updatedAt); setSubmittedAt(body.submittedAt);
            // Open the tasks still to do; the first one is where the tester left off.
            setOpen(new Set(UAT_TASKS.filter(t => !loaded.tasks[t.id]).map(t => t.id)));
            setDevice(describeDevice(navigator.userAgent, window.innerWidth));
        })();
        // Leaving with unsaved typing still saves it. Moving to another FinGence page keeps this script running, so that save
        // waits behind any save in flight; closing the tab cannot wait, so it goes at once, and its higher order number keeps
        // an older save that lands after it from replacing it.
        const send = () => fetch('/api/workspace/uat', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: payload(false), keepalive: true }).then(() => undefined, () => undefined);
        const leaving = (now: boolean) => {
            if (!dirty.current || !latest.current) return;
            dirty.current = false;
            if (now) void send(); else chain.current = chain.current.then(send);
        };
        const onPageHide = () => leaving(true);
        window.addEventListener('pagehide', onPageHide);
        return () => { gone = true; window.removeEventListener('pagehide', onPageHide); if (timer.current) clearTimeout(timer.current); leaving(false); };
    }, [payload]);

    const change = (next: UatAnswers, now = false) => {
        latest.current = next; dirty.current = true; setAnswers(next); setProblem(null);
        if (timer.current) clearTimeout(timer.current);
        if (now) void save(); else timer.current = setTimeout(() => void save(), 800);
    };

    if (loadError) return <Panel><p className="p-4 text-sm sm:p-5">{loadError}</p></Panel>;
    if (!answers) return <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle aria-hidden="true" size={16} className="animate-spin" />Loading…</p>;

    const tasks = tasksFor(admin), done = progress(answers, admin);
    async function submit() {
        const missing = tasks.filter(t => !answers!.tasks[t.id]);
        const unrated = tasks.filter(t => answers!.tasks[t.id]?.result === 'ISSUE' && !answers!.tasks[t.id]?.severity);
        if (missing.length) { setProblem(`Record a result for task ${missing.map(t => t.id).join(', ')} first. “Not done” is a result too.`); return; }
        if (unrated.length) { setProblem(`Choose how serious the issue is for task ${unrated.map(t => t.id).join(', ')}.`); return; }
        if (!await save(true)) setProblem('Your results could not be submitted. Please try again.');
    }

    return <div className="grid min-w-0 gap-4">
        <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] z-10 rounded-2xl lg:top-2 border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-panel)] sm:p-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <p className="font-semibold tabular-nums">{done.recorded} of {done.total} tasks recorded</p>
                {submittedAt ? <span className={`${badge} ${RESULT_TONE.PASS}`}>Submitted {when(submittedAt)}</span> : null}
                <p role="status" aria-live="polite" className="ml-auto text-xs text-[var(--muted)]">
                    {state === 'saving' ? 'Saving…' : state === 'error' ? <span className="font-semibold text-[var(--bad-ink)]">Not saved. <button type="button" className="underline" onClick={() => void save()}>Try again</button></span> : savedAt ? `Saved ${when(savedAt)}` : 'Nothing recorded yet'}
                </p>
            </div>
            <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-sunken)]"><span className="block h-full rounded-full bg-[var(--brand)] transition-[width]" style={{ width: `${(done.recorded / done.total) * 100}%` }} /></div>
        </div>

        <ol className="grid min-w-0 gap-3">{tasks.map(task => {
            const a = answers.tasks[task.id], id = `uat-task-${task.id}`;
            return <li key={task.id} className="min-w-0">
                <details id={id} open={open.has(task.id)} onToggle={e => { const isOpen = (e.currentTarget as HTMLDetailsElement).open; setOpen(s => { if (s.has(task.id) === isOpen) return s; const n = new Set(s); if (isOpen) n.add(task.id); else n.delete(task.id); return n; }); }}
                    className="group min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-panel)]">
                    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-sm font-bold text-[var(--brand-ink)] tabular-nums">{task.id}</span>
                        <span className="min-w-0 flex-1 font-semibold">{task.title}</span>
                        {a ? <span className={`${badge} ${RESULT_TONE[a.result]}`}>{RESULTS[a.result]}{a.severity ? ` · ${SEVERITIES[a.severity].label}` : ''}</span> : <span className="text-xs text-[var(--muted)]">To do</span>}
                    </summary>
                    <div className="grid gap-4 border-t border-[var(--border)] px-4 py-4 text-sm sm:px-5">
                        <ol className="list-decimal space-y-1.5 pl-5 leading-relaxed text-[var(--muted-strong)]">{task.steps.map((s, i) => <li key={i}><Rich text={s} /></li>)}</ol>
                        {task.links.length ? <div className="flex flex-wrap gap-2">{task.links.map(l => <Link key={l.href + l.label} href={l.href} className={button}>{l.label}<ArrowRight aria-hidden="true" size={15} /></Link>)}</div> : null}
                        <p className="rounded-xl bg-[var(--surface-subtle)] px-3 py-2.5 leading-relaxed ring-1 ring-inset ring-[var(--border)]"><strong>What should happen:</strong> {task.expected}</p>
                        <fieldset className="grid gap-3">
                            <legend className="mb-2 font-semibold">How did it go?</legend>
                            <div role="group" aria-label={`Result for task ${task.id}`} className="flex flex-wrap gap-2">
                                {(Object.keys(RESULTS) as UatResult[]).map(r => <button key={r} type="button" aria-pressed={a?.result === r} className={chip(a?.result === r)} onClick={() => change(setTask(answers, task.id, { result: r }), true)}>
                                    {r === 'PASS' ? <CheckCircle2 aria-hidden="true" size={15} /> : r === 'ISSUE' ? <AlertTriangle aria-hidden="true" size={15} /> : <CircleDashed aria-hidden="true" size={15} />}{RESULTS[r]}</button>)}
                            </div>
                            {a ? <div className="grid gap-3 sm:grid-cols-2">
                                <label className="grid gap-1"><span className="text-xs font-semibold text-[var(--muted-strong)]">Kind of finding (optional)</span>
                                    <select className={field} value={a.kind ?? ''} onChange={e => change(setTask(answers, task.id, { kind: (e.target.value || undefined) as UatKind | undefined }), true)}>
                                        <option value="">Not chosen</option>{(Object.keys(KINDS) as UatKind[]).map(k => <option key={k} value={k}>{KINDS[k]}</option>)}</select></label>
                                {a.result === 'ISSUE' ? <label className="grid gap-1"><span className="text-xs font-semibold text-[var(--muted-strong)]">How serious?</span>
                                    <select className={field} value={a.severity ?? ''} onChange={e => change(setTask(answers, task.id, { severity: (e.target.value || undefined) as UatSeverity | undefined }), true)}>
                                        <option value="">Choose…</option>{(Object.keys(SEVERITIES) as UatSeverity[]).map(k => <option key={k} value={k}>{SEVERITIES[k].label}: {SEVERITIES[k].meaning.toLowerCase()}</option>)}</select></label> : null}
                            </div> : null}
                            <label className="grid gap-1"><span className="font-semibold">{task.question}</span>
                                <span className="text-xs text-[var(--muted)]">What you saw, and your answer. No passwords, invitation codes or real financial data.</span>
                                <textarea className={`${field} min-h-24 py-2 leading-relaxed`} maxLength={NOTE_MAX} value={a?.note ?? ''} disabled={!a}
                                    placeholder={a ? '' : 'Choose a result first'}
                                    onChange={e => change(setTask(answers, task.id, { note: e.target.value }))} /></label>
                        </fieldset>
                    </div>
                </details>
            </li>;
        })}</ol>

        <Panel title="Overall questions">
            <div className="grid gap-4 p-4 text-sm sm:p-5">
                <fieldset><legend className="mb-2 font-semibold">{OVERALL.trust}</legend>
                    <div role="group" aria-label="Trust, 1 to 5" className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5].map(n => <button key={n} type="button" aria-pressed={answers.overall.trust === n} className={`${chip(answers.overall.trust === n)} min-w-11 tabular-nums`}
                        onClick={() => change({ ...answers, overall: { ...answers.overall, trust: n } }, true)}>{n}</button>)}</div></fieldset>
                {(['trustWhy', 'useful', 'change', 'other'] as const).map(k => <label key={k} className="grid gap-1"><span className="font-semibold">{OVERALL[k]}</span>
                    <textarea className={`${field} min-h-20 py-2 leading-relaxed`} maxLength={NOTE_MAX} value={answers.overall[k] ?? ''}
                        onChange={e => { const overall = { ...answers.overall }; if (e.target.value) overall[k] = e.target.value; else delete overall[k]; change({ ...answers, overall }); }} /></label>)}
            </div>
        </Panel>

        <Panel>
            <div className="grid gap-3 p-4 text-sm sm:p-5">
                <p className="text-[var(--muted-strong)]">Saved with your answers: {ROLE_LABEL[workspace.session?.role ?? 'FINANCE']} · {device} · the FinGence version. Your organization&apos;s Admins can see your answers.</p>
                {problem ? <p role="alert" className="font-semibold text-[var(--bad-ink)]">{problem}</p> : null}
                <div className="flex flex-wrap items-center gap-3">
                    <button type="button" className={primaryButton} disabled={state === 'saving'} onClick={() => void submit()}><Send aria-hidden="true" size={16} />{submittedAt ? 'Submit again' : 'Submit my results'}</button>
                    <span className="text-xs text-[var(--muted)]">{submittedAt ? 'You can still change any answer: changes save as before.' : 'Submit when every task has a result.'}</span>
                </div>
            </div>
        </Panel>

        <details className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-sm">
            <summary className="min-h-12 cursor-pointer px-4 py-3 font-semibold sm:px-5">Known limitations (no need to report these)</summary>
            <ul className="grid gap-2 border-t border-[var(--border)] px-4 py-4 leading-relaxed text-[var(--muted-strong)] sm:px-5">{KNOWN_LIMITATIONS.map(([head, text]) => <li key={head}><strong className="text-[var(--ink)]">{head}</strong> {text}</li>)}</ul>
        </details>
    </div>;
}

function EveryonesResults() {
    const workspace = useWorkspace();
    const [testers, setTesters] = useState<Tester[] | null>(null), [error, setError] = useState<string | null>(null);
    const load = useCallback(async () => {
        const res = await fetch('/api/workspace/uat/results', { cache: 'no-store' }).catch(() => null);
        const body = await res?.json().catch(() => null) as { testers: Tester[]; code?: string } | null;
        if (!res?.ok || !body) { setError(plainMessage(body?.code)); return; }
        setTesters(body.testers); setError(null);
    }, []);
    useEffect(() => { queueMicrotask(() => void load()); }, [load]);

    if (error) return <Panel><p className="p-4 text-sm sm:p-5">{error}</p></Panel>;
    if (!testers) return <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle aria-hidden="true" size={16} className="animate-spin" />Loading…</p>;
    const all = issues(testers), sign = signOff(testers), submitted = testers.filter(t => t.submittedAt).length;
    function exportCsv() {
        const url = URL.createObjectURL(new Blob([resultsCsv(testers!)], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a'); a.href = url; a.download = `fingence-uat-results-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    const criteria: [boolean, string][] = [
        [sign.financePassing >= sign.financeNeeded, `Tasks 1 to 8 pass for at least two Finance testers: ${sign.financePassing} so far`],
        [sign.blocking === 0, sign.blocking ? `${sign.blocking} issue${sign.blocking === 1 ? ' blocks a task' : 's block a task'}` : 'No issue blocks a task'],
        [sign.wrongResults === 0, sign.wrongResults ? `${sign.wrongResults} “Wrong result” finding${sign.wrongResults === 1 ? '' : 's'} to fix, or explain and agree with SAIC` : 'No “Wrong result” findings'],
    ];

    return <div className="grid min-w-0 gap-4">
        <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-[var(--muted-strong)]">{testers.length} tester{testers.length === 1 ? '' : 's'} in {workspace.session?.organization.name ?? 'the organization'} · {submitted} submitted · {all.length} issue{all.length === 1 ? '' : 's'}</p>
            <span className="ml-auto flex flex-wrap gap-2">
                <button type="button" className={button} onClick={() => void load()}><RefreshCw aria-hidden="true" size={16} />Refresh</button>
                <button type="button" className={primaryButton} disabled={!testers.length} onClick={exportCsv}><Download aria-hidden="true" size={16} />Download CSV</button>
            </span>
        </div>
        <Panel title="Sign-off criteria">
            <ul className="grid gap-2 p-4 text-sm sm:p-5">{criteria.map(([met, text]) => <li key={text} className="flex items-start gap-2">
                {met ? <CheckCircle2 aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-[var(--good)]" /> : <CircleDashed aria-hidden="true" size={17} className="mt-0.5 shrink-0 text-[var(--warn-ink)]" />}<span>{text}</span></li>)}</ul>
        </Panel>
        {testers.length === 0 ? <Panel><p className="flex items-center gap-2.5 p-5 text-sm text-[var(--muted-strong)]"><ClipboardCheck aria-hidden="true" size={18} className="text-[var(--muted)]" />No one has recorded a result yet.</p></Panel> : <>
            <Panel title="By task">
                <div className="overflow-x-auto"><table className="w-full min-w-[30rem] text-sm">
                    <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]"><th className="px-4 py-2 font-semibold sm:px-5">Task</th><th className="px-3 py-2 text-right font-semibold">Pass</th><th className="px-3 py-2 text-right font-semibold">Issue</th><th className="px-3 py-2 text-right font-semibold">Not done</th><th className="px-4 py-2 text-right font-semibold sm:px-5">Not yet</th></tr></thead>
                    <tbody>{UAT_TASKS.map(task => {
                        const asked = testers.filter(t => !task.adminOnly || t.role !== 'FINANCE');
                        const count = (r: UatResult) => asked.filter(t => t.answers.tasks[task.id]?.result === r).length;
                        return <tr key={task.id} className="border-b border-[var(--border)] last:border-0 tabular-nums"><td className="px-4 py-2 sm:px-5">{task.id}. {task.title}</td>
                            <td className="px-3 py-2 text-right">{count('PASS')}</td><td className={`px-3 py-2 text-right ${count('ISSUE') ? 'font-semibold text-[var(--bad-ink)]' : ''}`}>{count('ISSUE')}</td><td className="px-3 py-2 text-right">{count('NOT_DONE')}</td>
                            <td className="px-4 py-2 text-right text-[var(--muted)] sm:px-5">{asked.length - count('PASS') - count('ISSUE') - count('NOT_DONE')}</td></tr>;
                    })}</tbody></table></div>
            </Panel>
            <Panel title="Issues, most serious first">
                {all.length ? <ul className="divide-y divide-[var(--border)] text-sm">{all.map((i, n) => <li key={n} className="grid gap-1 px-4 py-3 sm:px-5">
                    <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">Task {i.task}. {UAT_TASKS.find(t => t.id === i.task)?.title}</span>
                        <span className={`${badge} ${RESULT_TONE.ISSUE}`}>{i.severity ? SEVERITIES[i.severity].label : 'Severity not chosen'}</span>{i.kind ? <span className={`${badge} ${RESULT_TONE.NOT_DONE}`}>{KINDS[i.kind]}</span> : null}
                        <span className="ml-auto text-xs text-[var(--muted)]">{i.tester} · {ROLE_LABEL[i.role]}</span></p>
                    {i.note ? <p className="whitespace-pre-wrap leading-relaxed text-[var(--muted-strong)]">{i.note}</p> : <p className="text-xs text-[var(--muted)]">No note.</p>}
                </li>)}</ul> : <p className="p-4 text-sm text-[var(--muted-strong)] sm:p-5">No issues recorded.</p>}
            </Panel>
            <Panel title="Testers">
                <ul className="divide-y divide-[var(--border)] text-sm">{testers.map(t => {
                    const p = progress(t.answers, t.role !== 'FINANCE');
                    return <li key={t.email}><details className="group">
                        <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
                            <span className="min-w-0 truncate font-semibold">{t.email}{t.mine ? ' (you)' : ''}</span><span className="text-xs text-[var(--muted)]">{ROLE_LABEL[t.role]}{t.active ? '' : ' · access off'}</span>
                            <span className="ml-auto text-xs tabular-nums text-[var(--muted-strong)]">{p.recorded} of {p.total}</span>
                            <span className={`${badge} ${t.submittedAt ? RESULT_TONE.PASS : RESULT_TONE.NOT_DONE}`}>{t.submittedAt ? `Submitted ${when(t.submittedAt)}` : `In progress · ${when(t.updatedAt)}`}</span>
                        </summary>
                        <div className="grid gap-3 border-t border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 sm:px-5">
                            <p className="text-xs text-[var(--muted)]">{t.answers.context.device ?? 'Device not recorded'} · version {t.appVersion}</p>
                            <ol className="grid gap-1.5">{tasksFor(t.role !== 'FINANCE').map(task => { const a = t.answers.tasks[task.id]; return <li key={task.id} className="grid gap-0.5">
                                <p className="flex flex-wrap items-center gap-2"><span>{task.id}. {task.title}</span>{a ? <span className={`${badge} ${RESULT_TONE[a.result]}`}>{RESULTS[a.result]}{a.severity ? ` · ${SEVERITIES[a.severity].label}` : ''}{a.kind ? ` · ${KINDS[a.kind]}` : ''}</span> : <span className="text-xs text-[var(--muted)]">Not yet</span>}</p>
                                {a?.note ? <p className="whitespace-pre-wrap text-[var(--muted-strong)]">{a.note}</p> : null}</li>; })}</ol>
                            {Object.keys(t.answers.overall).length ? <dl className="grid gap-1.5 border-t border-[var(--border)] pt-3">{(Object.keys(OVERALL) as (keyof typeof OVERALL)[]).filter(k => t.answers.overall[k] !== undefined).map(k => <div key={k}>
                                <dt className="text-xs font-semibold text-[var(--muted)]">{OVERALL[k]}</dt><dd className="whitespace-pre-wrap">{String(t.answers.overall[k])}</dd></div>)}</dl> : null}
                        </div>
                    </details></li>;
                })}</ul>
            </Panel>
            <p className="text-xs text-[var(--muted)]">The CSV names testers “Tester 1, 2…” with their role and email domain, not their address, so it can go into the technical report as it is.</p>
        </>}
    </div>;
}
