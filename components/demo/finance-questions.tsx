 'use client';
import Link from 'next/link';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Send} from 'lucide-react';
import {PageHeader,Panel} from '@/components/ui';
import type {ProcessingContext} from '@/lib/demo/pipeline';
import {answerQuestion,suggestions,MAX_QUESTION,type QaAnswer} from '@/lib/poc-finance-qa/answer';
import {toCents} from '@/lib/poc-anomalies/source';
import {qaFacts} from '@/lib/demo/questions';
import {askGrounded,gatewayQaModel,qaGatewayStatus,type GroundedRun,type QaGatewayStatus} from '@/lib/grounded-qa/client';
import {groundingIndex} from '@/lib/grounded-qa/tools';
import {GroundedAnswer} from './grounded-answer';
import {useDemoProcessing} from './context';
import {DecisionBadge,SourceStrip,button,money,primaryButton} from './shared';
import styles from './workspace-final.module.css';
const DEMO_LINK: Record<string, string> = { '/transactions': '/transactions', '/anomalies': '/anomalies', '/reconciliation': '/reconciliation', '/forecasting': '/forecasting' };
/** The rule-based answer card (Phase 1); also the fallback under any AI answer that is not accepted. */
function RuleAnswer({ a, href }: { a: QaAnswer; href: (h: string) => string }) {
    return <>
        <header className="flex flex-wrap items-center justify-between gap-2"><DecisionBadge decision={a.status === 'ANSWERED' ? 'AUTO_ACCEPTED' : a.status === 'REFUSED' ? 'QUARANTINED' : 'UNAVAILABLE'} label={a.status === 'ANSWERED' ? 'Answered from source' : a.status === 'REFUSED' ? 'Refused' : 'Unavailable'} /></header>
        <p className="mt-2 text-base font-semibold">{a.headline}</p><p className="mt-1 leading-relaxed text-[var(--muted-strong)]">{a.interpretation}</p>
        <details className={styles.panel}><summary>View Supporting Evidence</summary>        {a.facts.length ? <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{a.facts.filter(f => f.unit !== 'TEXT').map(f => <div key={f.id} className="rounded-lg bg-slate-50 px-3 py-2"><dt className="text-xs text-[var(--muted)]">{f.label}</dt><dd className="font-semibold tabular-nums">{f.unit === 'MONEY' ? money(f.currency ?? '', f.value) : f.unit === 'PERCENT' ? `${f.value}%` : f.value}</dd></div>)}</dl> : null}
        {a.evidence.length ? <p className="mt-3 flex flex-wrap gap-3 text-xs">{a.evidence.map(e => <Link key={e.label} href={href(e.href)} className="font-semibold text-[var(--teal-dark)] underline">{e.label}</Link>)}</p> : null}<div>{a.facts.filter(f=>f.unit==='TEXT').map(f=><p key={f.id}>{f.label}: {f.value}</p>)}{a.records.map((group,i)=><div key={`${group.label}:${i}`}><h3>{group.label}</h3><p>{group.detail}</p><p>{group.recordIds.join(', ')}</p></div>)}</div></details>
    </>;
}
type AskItem = { key: number } & ({ kind: 'RULE'; answer: QaAnswer } | { kind: 'AI'; question: string; run: GroundedRun | null; fallback: QaAnswer });
export default function Ask({ c }: { c: ProcessingContext | null }) {
    const facts = useMemo(() => c ? qaFacts(c) : null, [c]), index = useMemo(() => c ? groundingIndex(c) : null, [c]);
    const [items, setItems] = useState<AskItem[]>([]), [question, setQuestion] = useState(''), [busy, setBusy] = useState(false);
    const [ai, setAi] = useState<QaGatewayStatus>({ available: false }), [mode, setMode] = useState<'RULES' | 'AI'>('RULES'), next = useRef(0), history = useRef<HTMLElement>(null);
    // Probe the Q&A route only when the layout gateway already answered (same switch); otherwise nothing is requested.
    const gateway = useDemoProcessing().ai?.available ?? false;
    useEffect(() => { let live = true; if (gateway) qaGatewayStatus().then(s => { if (live) setAi(s); }); return () => { live = false; }; }, [gateway]);

    useEffect(() => {
        if (!items.length || !history.current) return;
        history.current.scrollTo({ top: history.current.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }, [items]);

    const aiMode = mode === 'AI' && ai.available && !!index;
    const ask = async (q: string) => {
        if (!facts || !q.trim() || q.length > MAX_QUESTION || busy) return;
        const key = next.current++; setQuestion('');
        if (!aiMode) { setItems(list => [...list, { key, kind: 'RULE' as const, answer: answerQuestion(facts, q) }].slice(-8)); return; }
        setBusy(true);
        setItems(list => [...list, { key, kind: 'AI' as const, question: q, run: null, fallback: answerQuestion(facts, q) }].slice(-8));
        const run = await askGrounded(index!, q, gatewayQaModel);
        setItems(list => list.map(i => i.key === key && i.kind === 'AI' ? { ...i, run } : i)); setBusy(false);
    };
    // Evidence links point at this demo's pages; the management report lives on Reports here.
    const href = (h: string) => h.includes('#management-report') ? '/reports' : DEMO_LINK[h.split(/[?#]/)[0]] ?? '/data';
    return <>
        <PageHeader title="Finance Q&A" description={aiMode ? 'AI-assisted answers grounded in the verified processing context. Every figure is filled in from the records; answers that fail the checks are withheld.' : 'Rule-based answers from the verified processing context. Unsupported questions are refused rather than answered with invented figures.'} />
        {aiMode ? <p className={styles.assistantNotice}><strong>AI-assisted ({ai.available ? ai.model : ''} on Groq), verified by deterministic checks.</strong> The model chooses which verified queries to run and words the answer; it never types an amount, date or reference. FinGence fills every figure from the records and withholds any answer that fails a check. Sent: {ai.available ? ai.sends : ''}</p>
            : <p className={styles.assistantNotice}><strong>Rule-based source assistant, not live AI.</strong> A fixed set of question types is answered with figures copied from this processing; profit, ratio, advice, fraud and cause questions are refused.</p>}
        {c ? <SourceStrip compact context={c} /> : <p className={styles.context}>Financial evidence is missing. Questions and source-backed answers become available after documents pass verification.</p>}
        <section ref={history} aria-label="Answers" tabIndex={0} className={`${styles.chat} ${styles.qaHistory}`}>{!items.length && <p className={styles.note}>{facts ? 'Ask a suggested question or enter your own to begin a source-backed conversation.' : 'No answers yet. Verified financial evidence is required.'}</p>}{items.map(item => <div key={item.key}><p className={styles.user}>{item.kind === 'RULE' ? item.answer.question : item.question}</p><article className={`${styles.panel} ${styles.assistant}`}>
            {item.kind === 'RULE' ? <RuleAnswer a={item.answer} href={href} />
                : !item.run ? <p className="text-[var(--muted)]" role="status">{item.question} · Answering from the verified records…</p>
                    : <>
                        <GroundedAnswer run={item.run} />
                        {item.run.status !== 'ANSWERED' ? <div className="mt-3 border-t border-[var(--border)] pt-3"><RuleAnswer a={item.fallback} href={href} /></div> : null}
                    </>}
        </article></div>)}</section>
        <Panel className={styles.qaComposer}>
            <div className="space-y-3 p-4 sm:p-5">
                {ai.available && index ? <div role="group" aria-label="Answer mode" className="flex flex-wrap gap-2">
                    <button type="button" aria-pressed={mode === 'RULES'} className={mode === 'RULES' ? primaryButton : button} onClick={() => setMode('RULES')}>Rule-based</button>
                    <button type="button" aria-pressed={mode === 'AI'} className={mode === 'AI' ? primaryButton : button} onClick={() => setMode('AI')}>AI-assisted (verified)</button>
                </div> : null}
                <div aria-label="Suggested questions" className="flex flex-wrap gap-2">{(aiMode && c ? aiSuggestions(c) : facts ? suggestions(facts) : ['How much cash moved?', 'How many transactions were matched?', 'Show monthly history']).map(q => <button key={q} type="button" className={button} disabled={busy || !facts} onClick={() => ask(q)}>{q}</button>)}</div>
                <form className="flex flex-col gap-2 sm:flex-row" onSubmit={e => { e.preventDefault(); ask(question); }}><label className="sr-only" htmlFor="demo-question">Question</label><input id="demo-question" className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--border-strong)] px-3 text-sm" maxLength={MAX_QUESTION} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask about this processing, for example: How many transactions were matched?" /><button className={primaryButton} disabled={!facts || !question.trim() || busy}><Send aria-hidden="true" size={16} />{busy ? 'Answering…' : 'Ask'}</button></form>
            </div>
        </Panel>

    </>;
}
/** Scope and counterparty come from the same verified context as the answers. */
export function aiSuggestions(c:ProcessingContext) {
 const span=(c.scope?.months.length??0)>1?'over these months':'this month';
 const inflow=new Map<string,bigint>();for(const r of c.outputs.bankRows)if(r.direction==='Credit')inflow.set(r.counterparty,(inflow.get(r.counterparty)??0n)+toCents(r.amount));
 const top=[...inflow.entries()].sort((a,b)=>b[1]>a[1]?1:b[1]<a[1]?-1:0)[0]?.[0];
 return [`Who did we pay the most ${span}?`,...(top?[`How much did we receive from ${top}?`]:[]),'Which reconciliation items still need review, and what reason was recorded?','How much more money came in than went out?'];
}
