'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Check, Expand, LoaderCircle, RotateCcw, Send, SlidersHorizontal, X } from 'lucide-react';
import { AssistantFace, AssistantLook, type FinMood } from './mascot';
import { GroundedAnswer } from '@/components/demo/grounded-answer';
import { useDemoProcessing } from '@/components/demo/context';
import { button, field, periodLabel, primaryButton } from '@/components/demo/shared';
import { plainMessage, useWorkspace } from '@/components/workspace/context';
import { TypingDots } from '@/components/waiting';
import { askGrounded, gatewayQaModel, type GroundedRun } from '@/lib/grounded-qa/client';
import { preCheck } from '@/lib/grounded-qa/gates';
import { catalogue, groundingIndex } from '@/lib/grounded-qa/tools';
import { answerQuestion, type QaAnswer } from '@/lib/poc-finance-qa/answer';
import { qaFacts } from '@/lib/demo/questions';
import { attentionCounts } from '@/lib/demo/attention';
import { processingConfidence } from '@/lib/confidence';
import { assistantMood, issueOf, MASCOT_FACE, type Issue, type MoodView } from '@/lib/fin/mood';
import { DEFAULT_PREFS, FIN_FALLBACK, FIN_NAME, FIN_PAGES, FIN_VERSION, MAX_MESSAGE, MAX_NAME, MAX_TURNS, cleanAssistantName, finGreeting, finPage, prefsOf, storedPrefs, verifiedContext, verifyFinReply, type AssistantPrefs, type FinPage, type FinRequest, type FinTurn, type Tone } from '@/lib/fin/contracts';
import { MAX_QUESTION } from '@/lib/grounded-qa/contracts';

/**
 * Fin, on every page: a floating button (or Ctrl/⌘ K) opens a side panel that keeps the conversation while you move
 * between pages and knows which page you are on. Fin's own words never contain a figure; a money question goes to
 * the grounded Q&A, so every figure on screen was filled in by FinGence from the verified records.
 */
export type FinMessage =
    | { id: number; role: 'user'; text: string }
    | { id: number; role: 'fin'; text: string; links: FinPage[]; pending?: boolean; grounded?: GroundedRun | 'PENDING'; rule?: QaAnswer; run?: { id: string; label: string } };

const STORE = 'fingence-fin-v1', KEEP = 30;
function load(): FinMessage[] {
    try { const raw = sessionStorage.getItem(STORE); const list = raw ? JSON.parse(raw) as FinMessage[] : []; return Array.isArray(list) ? list.slice(-KEEP).map(m => m.role === 'fin' ? { ...m, pending: false, grounded: m.grounded === 'PENDING' ? undefined : m.grounded } : m) : []; }
    catch { return []; }
}
function save(list: FinMessage[]) { try { sessionStorage.setItem(STORE, JSON.stringify(list.slice(-KEEP))); } catch { /* storage unavailable: the conversation lasts for this page only */ } }

type FinValue = {
    open: boolean; setOpen: (open: boolean) => void; messages: FinMessage[]; busy: boolean; send: (text: string) => Promise<void>; reset: () => void; ai: boolean | null;
    /** The assistant's name: the one this person gave it, or Fin. */
    name: string;
    /** Rename the assistant, or return to Fin with null. Resolves to an error message, or null when saved. */
    rename: (next: string | null) => Promise<string | null>;
    /** The person's choices: name, tone, quiet, character and motion. */
    prefs: AssistantPrefs;
    /** Change some of those choices. Resolves to an error message, or null when saved. */
    savePrefs: (patch: Partial<AssistantPrefs>) => Promise<string | null>;
    /** The assistant's mood, from what FinGence knows right now (lib/fin/mood.ts). */
    mood: MoodView;
};
const FinContext = createContext<FinValue | null>(null);
export const useFin = () => useContext(FinContext);

/** With the workspace off, the choices are kept in this browser; signed in, they are kept for the member (workspace v9, v10). */
const PREFS_STORE = 'fingence-assistant-v1';
const NAME_RULE = `Choose a name of up to ${MAX_NAME} letters. Spaces, hyphens and apostrophes are fine; numbers and symbols are not.`;
function browserPrefs(): AssistantPrefs {
    try { return prefsOf(JSON.parse(localStorage.getItem(PREFS_STORE) ?? 'null')); }
    catch { return DEFAULT_PREFS; }
}
async function memberPrefs(): Promise<AssistantPrefs | null> {
    try {
        const r = await fetch('/api/workspace/assistant', { cache: 'no-store' });
        if (!r.ok) return null;
        return prefsOf((await r.json() as { settings?: unknown }).settings);
    } catch { return null; }
}

const HOPPED = 'fingence-assistant-hopped';
function hoppedBefore(runId: string) {
    if (typeof window === 'undefined') return true;
    try { return (JSON.parse(sessionStorage.getItem(HOPPED) ?? '[]') as string[]).includes(runId); } catch { return false; }
}
function rememberHop(runId: string) {
    try { const list = JSON.parse(sessionStorage.getItem(HOPPED) ?? '[]') as string[]; sessionStorage.setItem(HOPPED, JSON.stringify([...list.filter(id => id !== runId), runId].slice(-20))); }
    catch { /* storage unavailable: it may hop again on the next page, which is harmless */ }
}

/** Without the model, Fin still says what the current page is for, and where to start. */
function offlineGuide(page: FinPage | null) {
    const here = page && page !== '/chatbot' ? ` You're on ${FIN_PAGES[page].label}, which shows ${FIN_PAGES[page].about}.` : '';
    return `I can't reach my AI right now, so here's the short version.${here} To get started, process a sample or your own documents on Data, and I can answer questions about the figures.`;
}

async function finAvailable() {
    try { const r = await fetch('/api/ai/fin', { cache: 'no-store' }); return r.ok && (await r.json() as { available?: unknown }).available === true; }
    catch { return false; }
}
async function askFin(req: FinRequest): Promise<{ content: unknown } | { code: string }> {
    try {
        const r = await fetch('/api/ai/fin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req) });
        const body = await r.json().catch(() => null) as { content?: unknown; code?: string } | null;
        return r.ok && body && 'content' in body ? { content: body.content } : { code: body?.code ?? `HTTP_${r.status}` };
    } catch { return { code: 'UNREACHABLE' }; }
}

export function FinProvider({ children }: { children: React.ReactNode }) {
    const pathname = usePathname(), demo = useDemoProcessing(), workspace = useWorkspace();
    const [prefs, setPrefsState] = useState<AssistantPrefs>(DEFAULT_PREFS), prefsNow = useRef(DEFAULT_PREFS);
    const setPrefs = useCallback((p: AssistantPrefs) => { prefsNow.current = p; setPrefsState(p); }, []);
    const name = prefs.name;
    // Bumped by every change, so a load that started before it can never put back the old choices.
    const prefEdits = useRef(0);
    // What the assistant's last turn ran into: it decides the paused and unsure moods until the next turn goes through.
    const [issue, setIssue] = useState<Issue>(null);
    const [open, setOpen] = useState(false), [messages, setMessages] = useState<FinMessage[]>([]), [busy, setBusy] = useState(false), [ai, setAi] = useState<boolean | null>(null);
    const next = useRef(1), latest = useRef<FinMessage[]>([]);
    useEffect(() => {
        const list = load(); latest.current = list; next.current = Math.max(0, ...list.map(m => m.id)) + 1;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state after hydration
        setMessages(list);
    }, []);
    useEffect(() => { let live = true; finAvailable().then(a => { if (live) setAi(a); }); return () => { live = false; }; }, []);
    // The choices follow the person: from the workspace when signed in, from this browser when the workspace is off.
    const email = workspace.session?.email ?? null;
    useEffect(() => {
        if (workspace.loading) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only state, read after hydration
        if (!workspace.enabled) { setPrefs(browserPrefs()); return; }
        if (!email) { setPrefs(DEFAULT_PREFS); return; }
        let live = true;
        const edits = prefEdits.current;
        void memberPrefs().then(p => { if (live && p && prefEdits.current === edits) setPrefs(p); });
        return () => { live = false; };
    }, [workspace.enabled, workspace.loading, email, setPrefs]);
    const savePrefs = useCallback(async (patch: Partial<AssistantPrefs>) => {
        let nextName = prefsNow.current.name;
        if (patch.name !== undefined) { const clean = cleanAssistantName(patch.name); if (!clean) return NAME_RULE; nextName = clean; }
        const nextPrefs: AssistantPrefs = { ...prefsNow.current, ...patch, name: nextName };
        const settings = storedPrefs(nextPrefs);
        if (!workspace.enabled) {
            try { if (settings) localStorage.setItem(PREFS_STORE, JSON.stringify(settings)); else localStorage.removeItem(PREFS_STORE); }
            catch { prefEdits.current++; setPrefs(nextPrefs); return 'This browser does not let FinGence keep your choices, so they last until you leave this page.'; }
            prefEdits.current++; setPrefs(nextPrefs); return null;
        }
        try {
            const r = await fetch('/api/workspace/assistant', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) });
            if (!r.ok) { const code = (await r.json().catch(() => ({})) as { code?: string }).code; return code === 'INVALID_SETTINGS' && patch.name !== undefined ? NAME_RULE : plainMessage(code); }
        } catch { return plainMessage('WORKSPACE_UNAVAILABLE'); }
        prefEdits.current++; setPrefs(nextPrefs); return null;
    }, [workspace.enabled, setPrefs]);
    const rename = useCallback((next: string | null) => savePrefs({ name: next ?? FIN_NAME }), [savePrefs]);
    // The person's own motion choice, applied to the mascot and every waiting animation (app/globals.css).
    useEffect(() => {
        const root = document.documentElement;
        if (prefs.motion === 'off') root.dataset.assistantMotion = 'off'; else delete root.dataset.assistantMotion;
    }, [prefs.motion]);
    const update = useCallback((fn: (list: FinMessage[]) => FinMessage[]) => { setMessages(prev => { const list = fn(prev); latest.current = list; save(list); return list; }); }, []);

    const context = demo.context;
    const index = useMemo(() => context ? groundingIndex(context) : null, [context]);
    const facts = useMemo(() => context ? qaFacts(context) : null, [context]);

    const send = useCallback(async (raw: string) => {
        const text = raw.trim().slice(0, MAX_MESSAGE);
        if (!text || busy) return;
        const userId = next.current++, finId = next.current++;
        // The words sent are the conversation so far plus this message (Fin's figures-free replies and the user's own text).
        // A verified answer's names travel with Fin's turn so "them" or "that payee" can be resolved; its figures do not.
        const turns: FinTurn[] = [...latest.current.filter(m => m.text).map(m => ({ role: m.role, text: (m.role === 'fin' ? [m.text, verifiedContext(m.grounded)].filter(Boolean).join(' ') : m.text).slice(0, MAX_MESSAGE) })), { role: 'user' as const, text }].slice(-MAX_TURNS);
        update(list => [...list, { id: userId, role: 'user', text }, { id: finId, role: 'fin', text: '', links: [], pending: true }]);
        const set = (patch: Partial<Extract<FinMessage, { role: 'fin' }>>) => update(list => list.map(m => m.id === finId && m.role === 'fin' ? { ...m, ...patch } : m));
        setBusy(true);
        try {
            // Without the AI, Fin still answers money questions with FinGence's fixed rules, and points to Data first.
            if (!ai) {
                setIssue(null);
                if (facts) set({ pending: false, text: FIN_FALLBACK.unavailable, rule: answerQuestion(facts, text.slice(0, MAX_QUESTION)), links: [] });
                else set({ pending: false, text: offlineGuide(finPage(pathname)), links: ['/data'] });
                return;
            }
            const run = index ? catalogue(index).scope : null;
            const req: FinRequest = { version: FIN_VERSION, name, tone: prefs.tone, page: finPage(pathname), turns, run: run ? { businessName: run.businessName, period: run.period, currency: run.currency } : null };
            const answer = await askFin(req);
            if ('code' in answer) {
                const issue = issueOf(answer.code);
                setIssue(issue);
                if (facts) set({ pending: false, text: FIN_FALLBACK.unavailable, rule: answerQuestion(facts, text.slice(0, MAX_QUESTION)) });
                else set({ pending: false, text: issue === 'LIMITED' ? 'I\'ve used up my AI allowance for the moment. Please try again a little later.' : offlineGuide(finPage(pathname)), links: ['/data'] });
                return;
            }
            const verdict = verifyFinReply(answer.content, req);
            setIssue(verdict.decision === 'WITHHELD' && verdict.reason !== 'NO_RUN' ? 'WITHHELD' : null);
            if (verdict.decision === 'WITHHELD') { set({ pending: false, text: verdict.reason === 'NO_RUN' ? FIN_FALLBACK.noRun : FIN_FALLBACK.withheld, links: verdict.reason === 'NO_RUN' ? ['/data'] : [] }); return; }
            const reply = verdict.reply;
            if (reply.kind !== 'FINANCE' || !index || !reply.financeQuestion) { set({ pending: false, text: reply.reply, links: reply.links }); return; }
            // The answer is tied to the run it was read from, so it is labelled if you switch runs while it is pending.
            const cat = catalogue(index), source = { id: context?.processingId ?? '', label: `${cat.scope.businessName} · ${cat.scope.period} · ${cat.scope.currency}` };
            set({ pending: false, text: reply.reply, links: reply.links, grounded: 'PENDING', run: source });
            // FinGence's deterministic refusals apply to the user's own words too, so a rewrite can never erase one
            // (for example "which supplier…" rewritten as "who…").
            const refusedAsAsked = preCheck(text, cat.counterparties);
            const grounded: GroundedRun = refusedAsAsked
                ? { question: text, status: 'REFUSED', refusal: { reason: refusedAsAsked, by: 'PRE_CHECK' }, queries: [], planChecks: [], facts: [], verdict: null, receipts: [], error: null }
                : await askGrounded(index, reply.financeQuestion, gatewayQaModel);
            // The verified Q&A makes its own AI calls: a limit or outage there pauses the assistant too.
            if (grounded.status === 'WITHHELD') setIssue('WITHHELD');
            else if (grounded.status === 'UNAVAILABLE') setIssue(issueOf(grounded.error ?? 'UNREACHABLE'));
            set({ grounded, rule: grounded.status === 'ANSWERED' || !facts ? undefined : answerQuestion(facts, reply.financeQuestion) });
        } finally { setBusy(false); }
    }, [ai, busy, context, facts, index, name, pathname, prefs.tone, update]);

    const reset = useCallback(() => update(() => []), [update]);
    // Ctrl/⌘ K opens and closes Fin from anywhere; Escape closes it.
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
            else if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
    }, []);
    // The mood comes from FinGence's own signals: processing, the reply in flight, the AI's state, the last turn's outcome,
    // what needs a person in this run and its confidence. Counts are code's; the model never sets a mood.
    const processing = demo.status === 'processing';
    const mood = useMemo(() => {
        // Confidence is measured for any finished run, so a run set aside before reconciliation is "unsure" and says why;
        // what needs a person is only counted when there are results.
        const ready = !!context?.scope && !!context.outputs.reconciliation;
        const confidence = context ? processingConfidence(context) : null;
        return assistantMood({
            processing, busy, ai, issue,
            attention: ready ? attentionCounts(context) : null,
            confidence: !confidence ? null : confidence.status === 'MEASURED' ? confidence.band : 'INCOMPLETE',
            period: context?.scope ? periodLabel(context.scope.period) : null,
        });
    }, [processing, busy, ai, issue, context]);
    // "Pleased" hops once per run, not on every page or panel open: it is meant to be rare.
    const runId = context?.processingId ?? null;
    const [hoppedRun, setHoppedRun] = useState<string | null>(null);
    const hop = mood.mood === 'pleased' && !prefs.quiet && !!runId && runId !== hoppedRun && !hoppedBefore(runId);
    useEffect(() => {
        if (!hop || !runId) return;
        const timer = setTimeout(() => { rememberHop(runId); setHoppedRun(runId); }, 1200);
        return () => clearTimeout(timer);
    }, [hop, runId]);
    const value = useMemo(() => ({ open, setOpen, messages, busy, send, reset, ai, name, rename, prefs, savePrefs, mood }), [open, messages, busy, send, reset, ai, name, rename, prefs, savePrefs, mood]);
    const look = useMemo(() => ({ character: prefs.character, hop }), [prefs.character, hop]);
    // Only "found something" is announced, once per change, on every screen size, so screen-reader users hear what needs
    // them and no chatter.
    const announce = !prefs.quiet && mood.mood === 'found' ? mood.line ?? '' : '';
    return <FinContext.Provider value={value}><AssistantLook.Provider value={look}>
        {children}
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </AssistantLook.Provider></FinContext.Provider>;
}

function Avatar({ size = 32, mood = 'idle' }: { size?: number; mood?: FinMood }) {
    return <span aria-hidden="true" className="grid shrink-0 place-items-center" style={{ width: size, height: size }}><AssistantFace size={size} mood={mood} /></span>;
}

/** The face for the assistant's current mood; quiet mode keeps it resting. Used by the dock, the page and the phone tab. */
export function useFace(): FinMood {
    const fin = useFin();
    if (!fin) return 'idle';
    return fin.prefs.quiet && fin.mood.mood !== 'working' ? 'idle' : MASCOT_FACE[fin.mood.mood];
}

const TONE_OF_MOOD: Record<MoodView['mood'], string> = {
    found: 'bg-[var(--warn-soft)] text-[var(--warn-ink)]', unsure: 'bg-[var(--surface-subtle)] text-[var(--muted-strong)]',
    paused: 'bg-[var(--surface-subtle)] text-[var(--muted-strong)]', pleased: 'bg-[var(--good-soft)] text-[var(--good-ink)]',
    working: 'bg-[var(--brand-soft)] text-[var(--brand-ink)]', resting: '',
};

/** One line under the assistant's header saying what it noticed, from code, with a link to where to look. Not in quiet mode. */
function MoodLine({ className = '', onNavigate }: { className?: string; onNavigate?: () => void }) {
    const fin = useFin(), here = finPage(usePathname());
    if (!fin || fin.prefs.quiet || !fin.mood.line) return null;
    const { mood, line } = fin.mood, link = fin.mood.link === here ? null : fin.mood.link;
    return <p className={`rise-in flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] leading-snug ${TONE_OF_MOOD[mood]} ${className}`}>
        <span>{line}</span>
        {link ? <Link href={link} onClick={onNavigate} className="inline-flex min-h-8 items-center gap-1 font-semibold underline decoration-current/40 underline-offset-2">Open {FIN_PAGES[link].label}<ArrowUpRight aria-hidden="true" size={13} /></Link> : null}
    </p>;
}

function suggestionsFor(page: FinPage | null, hasRun: boolean) {
    const here = page && page !== '/chatbot' ? [`What am I looking at on ${FIN_PAGES[page].label}?`] : ['What can FinGence do for me?'];
    return hasRun ? [...here, 'Who did we pay the most?', 'What still needs my review?', 'What does the confidence figure mean?']
        : [...here, 'How do I process my first document?', 'What does "set aside" mean?'];
}

/** The conversation itself: used by the side panel and by the full-page /chatbot. */
export function FinConversation({ compact = false }: { compact?: boolean }) {
    const fin = useFin(), pathname = usePathname(), demo = useDemoProcessing();
    const [draft, setDraft] = useState(''), input = useRef<HTMLTextAreaElement>(null), end = useRef<HTMLDivElement>(null);
    const messages = fin?.messages, open = fin?.open;
    useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages]);
    useEffect(() => { if (open || !compact) input.current?.focus(); }, [open, compact]);
    if (!fin) return null;
    // While Fin is answering, Enter keeps what you typed instead of clearing it; send it when the reply is in.
    const submit = () => { if (fin.busy || !draft.trim()) return; const t = draft; setDraft(''); void fin.send(t); };
    const hasRun = !!(demo.context && groundingIndex(demo.context));
    return <div className="flex min-h-0 flex-1 flex-col">
        <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto ${compact ? 'px-4 py-4' : 'py-2'}`} aria-live="polite">
            <div className="flex gap-2.5"><Avatar /><div className="rounded-2xl rounded-tl-md bg-[var(--surface-subtle)] px-3.5 py-2.5 text-sm leading-relaxed ring-1 ring-inset ring-[var(--border)]">{finGreeting(fin.name)}</div></div>
            {fin.messages.map(m => m.role === 'user'
                ? <div key={m.id} className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-[var(--brand-solid)] px-3.5 py-2.5 text-sm leading-relaxed text-white">{m.text}</p></div>
                : <div key={m.id} className="flex gap-2.5"><Avatar mood={m.pending || m.grounded === 'PENDING' ? 'thinking' : typeof m.grounded === 'object' && m.grounded.status === 'WITHHELD' ? 'unsure' : 'idle'} />
                    <div className="min-w-0 flex-1 space-y-2">
                        {m.pending ? <p role="status" className="rise-in inline-flex items-center gap-2.5 rounded-2xl rounded-tl-md bg-[var(--surface-subtle)] px-3.5 py-3 text-sm text-[var(--muted)] ring-1 ring-inset ring-[var(--border)]"><TypingDots className="text-[var(--brand)]" /><span>{fin.name} is thinking</span></p>
                            : <div className="rounded-2xl rounded-tl-md bg-[var(--surface-subtle)] px-3.5 py-2.5 text-sm leading-relaxed ring-1 ring-inset ring-[var(--border)]">
                                <p className="whitespace-pre-wrap">{m.text}</p>
                                {m.links.length ? <p className="mt-2 flex flex-wrap gap-2">{m.links.map(href => <Link key={href} href={href} onClick={() => compact && fin.setOpen(pathname === href)} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-[var(--brand-line)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--brand-ink)] hover:bg-[var(--brand-soft)]">{FIN_PAGES[href].label}<ArrowUpRight aria-hidden="true" size={13} /></Link>)}</p> : null}
                            </div>}
                        {m.grounded === 'PENDING' ? <p role="status" className="rise-in inline-flex items-center gap-2 text-xs text-[var(--muted)]"><TypingDots className="text-[var(--brand)]" />Reading the verified records</p>
                            : m.grounded ? <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm">{m.run && m.run.id !== demo.context?.processingId ? <p className="mb-2 rounded-lg bg-[var(--warn-soft)] px-2.5 py-1.5 text-xs text-[var(--warn-ink)]">From an earlier run: {m.run.label}. Your current figures may differ.</p> : null}<GroundedAnswer run={m.grounded} fallback={m.rule ? 'Here is FinGence\'s fixed-rule answer instead.' : ''} /></div> : null}
                        {m.rule ? <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm"><p className="font-semibold">{m.rule.headline}</p><p className="mt-1 text-[var(--muted-strong)]">{m.rule.interpretation}</p></div> : null}
                    </div>
                </div>)}
            {fin.messages.length === 0 ? <div className="flex flex-wrap gap-2 pl-[42px]" aria-label="Suggestions">{suggestionsFor(finPage(pathname), hasRun).map(q => <button key={q} type="button" disabled={fin.busy} onClick={() => void fin.send(q)} className="min-h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-[13px] font-medium text-[var(--muted-strong)] hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)] hover:text-[var(--ink)]">{q}</button>)}</div> : null}
            <div ref={end} />
        </div>
        <form className={`border-t border-[var(--border)] ${compact ? 'p-3' : 'pt-3'}`} onSubmit={e => { e.preventDefault(); submit(); }}>
            <div className="flex items-end gap-2">
                <label htmlFor={compact ? 'fin-input-panel' : 'fin-input-page'} className="sr-only">Message {fin.name}</label>
                <textarea id={compact ? 'fin-input-panel' : 'fin-input-page'} ref={input} rows={1} maxLength={MAX_MESSAGE} value={draft} onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
                    placeholder={`Message ${fin.name}`} className={`${field} max-h-32 min-h-11 resize-none py-2.5 leading-snug`} />
                <button type="submit" className={`${primaryButton} size-11 shrink-0 px-0`} disabled={!draft.trim() || fin.busy} aria-label="Send">{fin.busy ? <LoaderCircle aria-hidden="true" size={17} className="animate-spin" /> : <Send aria-hidden="true" size={17} />}</button>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">{fin.ai === false ? `AI is off here, so ${fin.name} answers with fixed rules. ` : ''}{fin.name} is an AI and never types a figure: every number comes from your verified records.</p>
        </form>
    </div>;
}

/** The floating button and side panel, mounted once by the app shell; desktop only (phones use the Chat tab and the full page). */
export function FinDock() {
    const fin = useFin(), pathname = usePathname(), face = useFace(), launcher = useRef<HTMLButtonElement>(null), wasOpen = useRef(false);
    const [settings, setSettings] = useState(false);
    useEffect(() => { if (wasOpen.current && !fin?.open) launcher.current?.focus(); wasOpen.current = !!fin?.open; }, [fin?.open]);
    if (!fin || pathname === '/chatbot') return null;
    const { count, line } = fin.mood;
    return <>
        {fin.open ? null : <button ref={launcher} type="button" onClick={() => fin.setOpen(true)} aria-label={`Ask ${fin.name}, your FinGence AI assistant${count && line ? `. ${line}` : ''}`} title={`Ask ${fin.name} (Ctrl K)`}
            className="fixed bottom-6 right-6 z-40 hidden h-14 items-center gap-2 rounded-full bg-[var(--brand-solid)] pl-2 pr-5 text-sm font-semibold text-white shadow-lg ring-4 ring-[var(--canvas)] transition-transform hover:-translate-y-0.5 hover:bg-[var(--brand-solid-hover)] lg:inline-flex print:hidden">
            <span className="relative grid size-11 place-items-center rounded-full bg-white"><AssistantFace size={38} mood={face} />
                {count ? <span aria-hidden="true" className="absolute -left-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--caution)] px-1 text-[11px] font-bold tabular-nums text-white ring-2 ring-[var(--brand-solid)]">{count > 99 ? '99+' : count}</span> : null}
            </span>Ask {fin.name}
        </button>}
        {fin.open ? <section role="dialog" aria-modal="false" aria-label={`${fin.name}, your FinGence AI assistant`}
            className="fixed inset-0 z-50 flex flex-col bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] lg:inset-auto lg:bottom-6 lg:right-6 lg:h-[min(680px,calc(100dvh-3rem))] lg:w-[420px] lg:rounded-3xl lg:border lg:border-[var(--border)] lg:shadow-2xl print:hidden">
            <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
                <Avatar size={42} mood={face} />
                <div className="min-w-0 flex-1"><h2 className="truncate text-base font-semibold leading-tight">{fin.name}</h2><p className="truncate text-xs text-[var(--muted)]">Your AI assistant</p></div>
                <button type="button" onClick={() => setSettings(o => !o)} aria-expanded={settings} className="grid size-11 place-items-center rounded-xl text-[var(--muted-strong)] hover:bg-[var(--surface-subtle)]" aria-label={`${fin.name}'s settings`} title="Settings"><SlidersHorizontal aria-hidden="true" size={17} /></button>
                <button type="button" onClick={fin.reset} disabled={!fin.messages.length || fin.busy} className="grid size-11 place-items-center rounded-xl text-[var(--muted-strong)] hover:bg-[var(--surface-subtle)] disabled:opacity-40" aria-label="Start a new conversation" title="New conversation"><RotateCcw aria-hidden="true" size={18} /></button>
                <Link href="/chatbot" onClick={() => fin.setOpen(false)} className="hidden size-11 place-items-center rounded-xl text-[var(--muted-strong)] hover:bg-[var(--surface-subtle)] lg:grid" aria-label="Open the full page" title="Full page"><Expand aria-hidden="true" size={18} /></Link>
                <button type="button" onClick={() => fin.setOpen(false)} className="grid size-11 place-items-center rounded-xl text-[var(--muted-strong)] hover:bg-[var(--surface-subtle)]" aria-label={`Close ${fin.name}`}><X aria-hidden="true" size={20} /></button>
            </header>
            {settings ? <AssistantSettingsPanel onDone={() => setSettings(false)} className="min-h-0 flex-1 overflow-y-auto px-4 py-4" />
                : <><MoodLine className="border-b border-[var(--border)] px-4 py-2.5" onNavigate={() => fin.setOpen(false)} /><FinConversation compact /></>}
        </section> : null}
    </>;
}

/** The full-page conversation on /chatbot. */
export function FinPage() {
    const fin = useFin(), face = useFace(), [settings, setSettings] = useState(false);
    const name = fin?.name ?? FIN_NAME;
    return <div className="mx-auto flex h-[calc(100dvh-14rem-env(safe-area-inset-bottom))] max-w-3xl flex-col lg:h-[calc(100dvh-7rem)]">
        <header className="mb-4 flex items-center gap-4"><span className="grid size-16 shrink-0 place-items-center rounded-3xl bg-[var(--brand-soft)] ring-1 ring-inset ring-[var(--brand-line)]"><AssistantFace size={52} mood={face} /></span>
            <div className="min-w-0 flex-1"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">AI assistant</p><h1 className="truncate text-2xl font-semibold">{name}</h1><p className="text-sm text-[var(--muted-strong)]">Your guide to FinGence, and a colleague who reads your verified figures with you.</p></div>
            {fin ? <button type="button" onClick={() => setSettings(o => !o)} aria-expanded={settings} className={`${button} shrink-0`}><SlidersHorizontal aria-hidden="true" size={16} />Settings</button> : null}</header>
        {settings ? <AssistantSettingsPanel onDone={() => setSettings(false)} className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4" /> : <MoodLine className="mb-4 rounded-xl px-3.5 py-2.5" />}
        <FinConversation />
    </div>;
}

function Switch({ id, checked, label, detail, disabled, onChange }: { id: string; checked: boolean; label: string; detail: string; disabled: boolean; onChange: (next: boolean) => void }) {
    return <div className="flex items-center justify-between gap-3 py-2">
        <div className="min-w-0"><p id={`${id}-label`} className="text-sm font-medium">{label}</p><p id={`${id}-detail`} className="text-xs leading-snug text-[var(--muted)]">{detail}</p></div>
        <button type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-label`} aria-describedby={`${id}-detail`} disabled={disabled} onClick={() => onChange(!checked)}
            className="grid min-h-11 shrink-0 place-items-center rounded-xl px-1 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]">
            <span aria-hidden="true" className={`relative block h-6 w-11 rounded-full transition-colors ${checked ? 'bg-[var(--brand-solid)]' : 'bg-[var(--border-strong)]'}`}>
                <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[22px]' : 'left-0.5'}`} />
            </span>
        </button>
    </div>;
}

function Choice<T extends string>({ legend, value, options, disabled, onChange }: { legend: string; value: T; options: { value: T; label: string }[]; disabled: boolean; onChange: (next: T) => void }) {
    return <fieldset className="py-2"><legend className="text-sm font-medium">{legend}</legend>
        <div className="mt-1.5 inline-flex rounded-xl bg-[var(--surface-subtle)] p-1 ring-1 ring-inset ring-[var(--border)]">
            {options.map(o => <button key={o.value} type="button" aria-pressed={value === o.value} disabled={disabled} onClick={() => onChange(o.value)}
                className={`min-h-9 rounded-lg px-3 text-[13px] font-semibold transition-colors disabled:opacity-50 ${value === o.value ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted-strong)] hover:text-[var(--ink)]'}`}>{o.label}</button>)}
        </div>
    </fieldset>;
}

/**
 * The person's own choices for their assistant: its name, how it writes, whether it stays quiet, whether it is drawn at
 * all, and whether it moves. Kept for them on every device when signed in, in this browser otherwise.
 */
function AssistantSettingsPanel({ onDone, className = '' }: { onDone: () => void; className?: string }) {
    const fin = useFin(), { enabled } = useWorkspace();
    const [draft, setDraft] = useState(fin?.name ?? FIN_NAME), [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
    if (!fin) return null;
    const apply = async (patch: Partial<AssistantPrefs>, close = false) => {
        setSaving(true); setError(null);
        const problem = await fin.savePrefs(patch);
        setSaving(false);
        if (problem) setError(problem); else if (close) onDone();
    };
    const p = fin.prefs;
    return <div className={className} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onDone(); } }}>
        <form onSubmit={e => { e.preventDefault(); void apply({ name: draft }); }}>
            <label htmlFor="assistant-name" className="text-sm font-semibold">Your assistant&apos;s name</label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <input id="assistant-name" ref={input} value={draft} maxLength={MAX_NAME} onChange={e => { setDraft(e.target.value); setError(null); }} aria-invalid={!!error} aria-describedby="assistant-name-help" autoComplete="off" spellCheck={false} className={`${field} min-h-11 w-40 flex-1`} />
                <button type="submit" disabled={saving || !draft.trim() || draft.trim() === p.name} className={`${primaryButton} min-h-11`}>{saving ? <LoaderCircle aria-hidden="true" size={16} className="animate-spin" /> : <Check aria-hidden="true" size={16} />}Save</button>
                {p.name !== FIN_NAME ? <button type="button" disabled={saving} onClick={() => { setDraft(FIN_NAME); void apply({ name: FIN_NAME }); }} className={`${button} min-h-11`}>Use {FIN_NAME}</button> : null}
            </div>
            <p id="assistant-name-help" className="mt-1.5 text-xs leading-snug text-[var(--muted)]">Letters only, up to {MAX_NAME}.</p>
        </form>
        <div className="mt-2 divide-y divide-[var(--border)]">
            <Choice<Tone> legend="How it writes" value={p.tone} disabled={saving} onChange={tone => void apply({ tone })} options={[{ value: 'concise', label: 'Concise' }, { value: 'friendly', label: 'Friendly' }]} />
            <Switch id="assistant-quiet" checked={p.quiet} disabled={saving} onChange={quiet => void apply({ quiet })} label="Quiet mode" detail="No status line or announcements. The count on the button stays." />
            <Switch id="assistant-character" checked={p.character} disabled={saving} onChange={character => void apply({ character })} label={`Show ${p.name}`} detail="Off shows a plain chat icon instead of the character." />
            <Choice<'device' | 'off'> legend="Motion" value={p.motion} disabled={saving} onChange={motion => void apply({ motion })} options={[{ value: 'device', label: 'Follow my device' }, { value: 'off', label: 'Off' }]} />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
            <p className={`text-xs leading-snug ${error ? 'text-[var(--bad-ink)]' : 'text-[var(--muted)]'}`} role={error ? 'alert' : undefined}>{error ?? (enabled ? 'Only you see these choices, on any device you sign in on.' : 'Kept in this browser.')}</p>
            <button type="button" onClick={onDone} className={`${button} min-h-10 shrink-0`}>Done</button>
        </div>
    </div>;
}
