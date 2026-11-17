'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Expand, LoaderCircle, RotateCcw, Send, X } from 'lucide-react';
import { FinMascot, type FinMood } from './mascot';
import { GroundedAnswer } from '@/components/demo/grounded-answer';
import { useDemoProcessing } from '@/components/demo/context';
import { field, primaryButton } from '@/components/demo/shared';
import { askGrounded, gatewayQaModel, type GroundedRun } from '@/lib/grounded-qa/client';
import { preCheck } from '@/lib/grounded-qa/gates';
import { catalogue, groundingIndex } from '@/lib/grounded-qa/tools';
import { answerQuestion, type QaAnswer } from '@/lib/poc-finance-qa/answer';
import { qaFacts } from '@/lib/demo/questions';
import { FIN_FALLBACK, FIN_NAME, FIN_PAGES, FIN_VERSION, MAX_MESSAGE, MAX_TURNS, finPage, verifiedContext, verifyFinReply, type FinPage, type FinRequest, type FinTurn } from '@/lib/fin/contracts';
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

type FinValue = { open: boolean; setOpen: (open: boolean) => void; messages: FinMessage[]; busy: boolean; send: (text: string) => Promise<void>; reset: () => void; ai: boolean | null };
const FinContext = createContext<FinValue | null>(null);
export const useFin = () => useContext(FinContext);

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
    const pathname = usePathname(), demo = useDemoProcessing();
    const [open, setOpen] = useState(false), [messages, setMessages] = useState<FinMessage[]>([]), [busy, setBusy] = useState(false), [ai, setAi] = useState<boolean | null>(null);
    const next = useRef(1), latest = useRef<FinMessage[]>([]);
    useEffect(() => {
        const list = load(); latest.current = list; next.current = Math.max(0, ...list.map(m => m.id)) + 1;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state after hydration
        setMessages(list);
    }, []);
    useEffect(() => { let live = true; finAvailable().then(a => { if (live) setAi(a); }); return () => { live = false; }; }, []);
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
                if (facts) set({ pending: false, text: FIN_FALLBACK.unavailable, rule: answerQuestion(facts, text.slice(0, MAX_QUESTION)), links: [] });
                else set({ pending: false, text: offlineGuide(finPage(pathname)), links: ['/data'] });
                return;
            }
            const run = index ? catalogue(index).scope : null;
            const req: FinRequest = { version: FIN_VERSION, page: finPage(pathname), turns, run: run ? { businessName: run.businessName, period: run.period, currency: run.currency } : null };
            const answer = await askFin(req);
            if ('code' in answer) {
                if (facts) set({ pending: false, text: FIN_FALLBACK.unavailable, rule: answerQuestion(facts, text.slice(0, MAX_QUESTION)) });
                else set({ pending: false, text: answer.code === 'BUDGET_EXHAUSTED' || answer.code === 'RATE_LIMITED' ? 'I\'ve used up my AI allowance for the moment. Please try again a little later.' : offlineGuide(finPage(pathname)), links: ['/data'] });
                return;
            }
            const verdict = verifyFinReply(answer.content, req);
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
            set({ grounded, rule: grounded.status === 'ANSWERED' || !facts ? undefined : answerQuestion(facts, reply.financeQuestion) });
        } finally { setBusy(false); }
    }, [ai, busy, context, facts, index, pathname, update]);

    const reset = useCallback(() => update(() => []), [update]);
    // Ctrl/⌘ K opens and closes Fin from anywhere; Escape closes it.
    useEffect(() => {
        const key = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(o => !o); }
            else if (e.key === 'Escape') setOpen(false);
        };
        window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
    }, []);
    const value = useMemo(() => ({ open, setOpen, messages, busy, send, reset, ai }), [open, messages, busy, send, reset, ai]);
    return <FinContext.Provider value={value}>{children}</FinContext.Provider>;
}

function Avatar({ size = 32, mood = 'idle' }: { size?: number; mood?: FinMood }) {
    return <span aria-hidden="true" className="grid shrink-0 place-items-center" style={{ width: size, height: size }}><FinMascot size={size} mood={mood} /></span>;
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
    const submit = () => { const t = draft; setDraft(''); void fin.send(t); };
    const hasRun = !!(demo.context && groundingIndex(demo.context));
    return <div className="flex min-h-0 flex-1 flex-col">
        <div className={`min-h-0 flex-1 space-y-4 overflow-y-auto ${compact ? 'px-4 py-4' : 'py-2'}`} aria-live="polite">
            <div className="flex gap-2.5"><Avatar /><div className="rounded-2xl rounded-tl-md bg-[var(--surface-subtle)] px-3.5 py-2.5 text-sm leading-relaxed ring-1 ring-inset ring-[var(--border)]">{FIN_FALLBACK.greeting}</div></div>
            {fin.messages.map(m => m.role === 'user'
                ? <div key={m.id} className="flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-[var(--brand-solid)] px-3.5 py-2.5 text-sm leading-relaxed text-white">{m.text}</p></div>
                : <div key={m.id} className="flex gap-2.5"><Avatar mood={m.pending || m.grounded === 'PENDING' ? 'thinking' : 'idle'} />
                    <div className="min-w-0 flex-1 space-y-2">
                        {m.pending ? <p role="status" className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md bg-[var(--surface-subtle)] px-3.5 py-2.5 text-sm text-[var(--muted)] ring-1 ring-inset ring-[var(--border)]"><LoaderCircle aria-hidden="true" size={15} className="animate-spin" />{FIN_NAME} is thinking…</p>
                            : <div className="rounded-2xl rounded-tl-md bg-[var(--surface-subtle)] px-3.5 py-2.5 text-sm leading-relaxed ring-1 ring-inset ring-[var(--border)]">
                                <p className="whitespace-pre-wrap">{m.text}</p>
                                {m.links.length ? <p className="mt-2 flex flex-wrap gap-2">{m.links.map(href => <Link key={href} href={href} onClick={() => compact && fin.setOpen(pathname === href)} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-[var(--brand-line)] bg-[var(--surface)] px-3 text-xs font-semibold text-[var(--brand-ink)] hover:bg-[var(--brand-soft)]">{FIN_PAGES[href].label}<ArrowUpRight aria-hidden="true" size={13} /></Link>)}</p> : null}
                            </div>}
                        {m.grounded === 'PENDING' ? <p role="status" className="inline-flex items-center gap-2 text-xs text-[var(--muted)]"><LoaderCircle aria-hidden="true" size={13} className="animate-spin" />Reading the verified records…</p>
                            : m.grounded ? <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm">{m.run && m.run.id !== demo.context?.processingId ? <p className="mb-2 rounded-lg bg-[var(--warn-soft)] px-2.5 py-1.5 text-xs text-[var(--warn-ink)]">From an earlier run: {m.run.label}. Your current figures may differ.</p> : null}<GroundedAnswer run={m.grounded} fallback={m.rule ? 'Here is FinGence\'s fixed-rule answer instead.' : ''} /></div> : null}
                        {m.rule ? <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 text-sm"><p className="font-semibold">{m.rule.headline}</p><p className="mt-1 text-[var(--muted-strong)]">{m.rule.interpretation}</p></div> : null}
                    </div>
                </div>)}
            {fin.messages.length === 0 ? <div className="flex flex-wrap gap-2 pl-[42px]" aria-label="Suggestions">{suggestionsFor(finPage(pathname), hasRun).map(q => <button key={q} type="button" disabled={fin.busy} onClick={() => void fin.send(q)} className="min-h-10 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left text-[13px] font-medium text-[var(--muted-strong)] hover:border-[var(--brand-line)] hover:bg-[var(--brand-soft)] hover:text-[var(--ink)]">{q}</button>)}</div> : null}
            <div ref={end} />
        </div>
        <form className={`border-t border-[var(--border)] ${compact ? 'p-3' : 'pt-3'}`} onSubmit={e => { e.preventDefault(); submit(); }}>
            <div className="flex items-end gap-2">
                <label htmlFor={compact ? 'fin-input-panel' : 'fin-input-page'} className="sr-only">Message {FIN_NAME}</label>
                <textarea id={compact ? 'fin-input-panel' : 'fin-input-page'} ref={input} rows={1} maxLength={MAX_MESSAGE} value={draft} onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
                    placeholder={`Message ${FIN_NAME}`} className={`${field} max-h-32 min-h-11 resize-none py-2.5 leading-snug`} />
                <button type="submit" className={`${primaryButton} size-11 shrink-0 px-0`} disabled={!draft.trim() || fin.busy} aria-label="Send">{fin.busy ? <LoaderCircle aria-hidden="true" size={17} className="animate-spin" /> : <Send aria-hidden="true" size={17} />}</button>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-[var(--muted)]">{fin.ai === false ? 'AI is off here, so Fin answers with fixed rules. ' : ''}{FIN_NAME} never types a figure: every number comes from your verified records.</p>
        </form>
    </div>;
}

/** The floating button and side panel, mounted once by the app shell; desktop only (phones use the Chat tab and the full page). */
export function FinDock() {
    const fin = useFin(), pathname = usePathname(), launcher = useRef<HTMLButtonElement>(null), wasOpen = useRef(false);
    useEffect(() => { if (wasOpen.current && !fin?.open) launcher.current?.focus(); wasOpen.current = !!fin?.open; }, [fin?.open]);
    if (!fin || pathname === '/chatbot') return null;
    return <>
        {fin.open ? null : <button ref={launcher} type="button" onClick={() => fin.setOpen(true)} aria-label={`Ask ${FIN_NAME}, your FinGence assistant`} title={`Ask ${FIN_NAME} (Ctrl K)`}
            className="fixed bottom-6 right-6 z-40 hidden h-14 items-center gap-2 rounded-full bg-[var(--brand-solid)] pl-2 pr-5 text-sm font-semibold text-white shadow-lg ring-4 ring-[var(--canvas)] transition-transform hover:-translate-y-0.5 hover:bg-[var(--brand-solid-hover)] lg:inline-flex print:hidden">
            <span className="grid size-11 place-items-center rounded-full bg-white"><FinMascot size={38} /></span>Ask {FIN_NAME}
        </button>}
        {fin.open ? <section role="dialog" aria-modal="false" aria-label={`${FIN_NAME}, your FinGence assistant`}
            className="fixed inset-0 z-50 flex flex-col bg-[var(--surface)] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] lg:inset-auto lg:bottom-6 lg:right-6 lg:h-[min(680px,calc(100dvh-3rem))] lg:w-[420px] lg:rounded-3xl lg:border lg:border-[var(--border)] lg:shadow-2xl print:hidden">
            <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
                <Avatar size={42} mood={fin.busy ? 'thinking' : 'happy'} />
                <div className="min-w-0 flex-1"><h2 className="text-base font-semibold leading-tight">{FIN_NAME}</h2><p className="truncate text-xs text-[var(--muted)]">Your FinGence guide and assistant</p></div>
                <button type="button" onClick={fin.reset} disabled={!fin.messages.length || fin.busy} className="grid size-11 place-items-center rounded-xl text-[var(--muted-strong)] hover:bg-[var(--surface-subtle)] disabled:opacity-40" aria-label="Start a new conversation" title="New conversation"><RotateCcw aria-hidden="true" size={18} /></button>
                <Link href="/chatbot" onClick={() => fin.setOpen(false)} className="hidden size-11 place-items-center rounded-xl text-[var(--muted-strong)] hover:bg-[var(--surface-subtle)] lg:grid" aria-label="Open the full page" title="Full page"><Expand aria-hidden="true" size={18} /></Link>
                <button type="button" onClick={() => fin.setOpen(false)} className="grid size-11 place-items-center rounded-xl text-[var(--muted-strong)] hover:bg-[var(--surface-subtle)]" aria-label={`Close ${FIN_NAME}`}><X aria-hidden="true" size={20} /></button>
            </header>
            <FinConversation compact />
        </section> : null}
    </>;
}

/** The full-page conversation on /chatbot. */
export function FinPage() {
    return <div className="mx-auto flex h-[calc(100dvh-14rem-env(safe-area-inset-bottom))] max-w-3xl flex-col lg:h-[calc(100dvh-7rem)]">
        <header className="mb-4 flex items-center gap-4"><FinPageAvatar /><div><p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Assistant</p><h1 className="text-2xl font-semibold">{FIN_NAME}</h1><p className="text-sm text-[var(--muted-strong)]">Your guide to FinGence, and a colleague who reads your verified figures with you.</p></div></header>
        <FinConversation />
    </div>;
}

function FinPageAvatar() {
    const fin = useFin();
    return <span className="grid size-16 shrink-0 place-items-center rounded-3xl bg-[var(--brand-soft)] ring-1 ring-inset ring-[var(--brand-line)]"><FinMascot size={52} mood={fin?.busy ? 'thinking' : 'happy'} /></span>;
}
