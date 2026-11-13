'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

type Passage = { title: string; heading: string; snippet: string; link: string; score: number };
type Preview = { previewId: string; question: string; passages: Passage[]; payloadHash: string; expiresAt: string };
type Section = { title: string; heading: string; link: string };
type Reply = { status: 'ANSWERED' | 'WITHHELD' | 'FALLBACK'; answerKind: 'GROUNDED_FINANCE' | 'GENERAL_INFORMATION'; groqUsed: boolean; providerAttempted?: boolean; model: string | null; answer: string | null; explanation: string | null; citedSections: Section[] };
type Failure = { groqUsed: boolean; providerAttempted?: boolean; model: string | null; citedSections: Section[]; explanation: string };

export function ChatAvailability({ available }: { available: boolean | null }) {
    return <p role="status"><strong>Groq available:</strong> {available === null ? 'Checking…' : available ? 'Yes' : 'No'}</p>;
}

export function ChatResultView({ result, answerKind, status, answer, children }: {
    result: Reply | Failure; answerKind?: Reply['answerKind']; status?: Reply['status']; answer?: string | null; children?: ReactNode;
}) {
    return <section aria-live="polite" style={{ marginTop: 24, border: '1px solid #b9c8d8', borderRadius: 10, padding: 18 }}>
        <h2>{answerKind === 'GENERAL_INFORMATION' ? 'General information' : 'FinGence'}</h2>
        {status === 'FALLBACK' && <p><strong>Not model-generated.</strong></p>}
        {status === 'WITHHELD' ? <p>{result.explanation}</p> : answer ? <p>{answer}</p> : <p>{result.explanation}</p>}
        {result.explanation && status !== 'WITHHELD' && <p>{result.explanation}</p>}
        <p><strong>Groq used for this reply:</strong> {result.groqUsed ? 'Yes' : 'No'} · <strong>Provider request attempted:</strong> {result.providerAttempted ? 'Yes' : 'No'} · <strong>Model returned by provider:</strong> {result.model ?? 'No valid provider model response'}</p>
        <h3>Sources cited</h3>
        {result.citedSections.length ? <ul>{result.citedSections.map(section => <li key={section.link}><a href={section.link}>{section.title} · {section.heading}</a></li>)}</ul> : <p>No vault sections cited.</p>}
        {children}
    </section>;
}

function failureFrom(body: Partial<Failure> & { code?: string }): Failure {
    return { groqUsed: body.groqUsed ?? false, providerAttempted: body.providerAttempted ?? false, model: body.model ?? null, citedSections: body.citedSections ?? [], explanation: body.explanation ?? body.code ?? 'FinGence could not complete this request.' };
}

export default function ObsidianDemoChat() {
    const [question, setQuestion] = useState('');
    const [preview, setPreview] = useState<Preview | null>(null);
    const [consent, setConsent] = useState(false);
    const [reply, setReply] = useState<Reply | null>(null);
    const [failure, setFailure] = useState<Failure | null>(null);
    const [groqAvailable, setGroqAvailable] = useState<boolean | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let active = true;
        fetch('/api/obsidian-demo/status', { cache: 'no-store' }).then(r => r.ok ? r.json() : null)
            .then(status => { if (active) setGroqAvailable(status?.groqAvailable === true); })
            .catch(() => { if (active) setGroqAvailable(false); });
        return () => { active = false; };
    }, []);

    async function requestPreview(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setBusy(true); setFailure(null); setReply(null); setPreview(null); setConsent(false);
        try {
            const response = await fetch('/api/obsidian-demo/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
            const body = await response.json();
            if (!response.ok) { setFailure(failureFrom(body)); return; }
            setPreview(body as Preview);
        } catch { setFailure(failureFrom({ explanation: 'FinGence could not reach the local demo server. No question was sent to Groq.' })); }
        finally { setBusy(false); }
    }

    async function send() {
        if (!preview || !consent) return;
        setBusy(true); setFailure(null); setReply(null);
        try {
            const response = await fetch('/api/obsidian-demo/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ previewId: preview.previewId, payloadHash: preview.payloadHash, consent: true }) });
            const body = await response.json();
            if (!response.ok) { setFailure(failureFrom(body)); setPreview(null); setConsent(false); return; }
            setReply(body as Reply); setPreview(null); setConsent(false);
        } catch { setFailure(failureFrom({ explanation: 'The local demo server did not return a response. Check the server and try again.' })); }
        finally { setBusy(false); }
    }

    const result = reply ?? failure;
    return <main style={{ maxWidth: 900, margin: '40px auto', padding: 24, color: '#172b45', fontFamily: 'system-ui, sans-serif' }}>
        <h1>Finance chatbot</h1>
        <p>Ask about the synthetic finance summary or ask a general question. Review the exact content before any Groq request.</p>
        <ChatAvailability available={groqAvailable} />
        {!result && <p role="status"><strong>Groq used for this reply:</strong> No reply sent yet</p>}
        <form onSubmit={requestPreview}>
            <label htmlFor="question">Your question</label>
            <textarea id="question" value={question} maxLength={300} onChange={e => { setQuestion(e.target.value); setPreview(null); setConsent(false); }} required rows={3} style={{ display: 'block', width: '100%', margin: '8px 0 12px', padding: 12 }} />
            <button type="submit" disabled={busy || !question.trim()}>{busy ? 'Working…' : 'Preview what will be sent'}</button>
        </form>
        {preview && <section aria-label="Consent preview" style={{ marginTop: 24, border: '1px solid #b9c8d8', borderRadius: 10, padding: 18 }}>
            <h2>Review before sending</h2>
            <p><strong>Question:</strong> {preview.question}</p>
            {preview.passages.length ? preview.passages.map((passage, index) => <article key={`${passage.link}-${index}`} style={{ background: '#f2f6fa', padding: 12, margin: '10px 0' }}>
                <h3>{passage.title} · {passage.heading}</h3><p>{passage.snippet}</p><small>{passage.link} · relevance {passage.score.toFixed(4)}</small>
            </article>) : <p>No source passages matched. Only your question will be sent.</p>}
            <p><small>Payload SHA-256: <code>{preview.payloadHash}</code><br />Preview expires: {new Date(preview.expiresAt).toLocaleString()}</small></p>
            <label style={{ display: 'block', margin: '16px 0' }}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I consent to sending this exact question and the displayed passages to Groq.</label>
            <button type="button" disabled={busy || !consent} onClick={send}>{busy ? 'Sending…' : 'Send to Groq'}</button>
        </section>}
        {result && <ChatResultView result={result} answerKind={reply?.answerKind} status={reply?.status} answer={reply?.answer} />}
        <p style={{ marginTop: 28 }}><small>Local synthetic-data demo. No sign-in, real financial uploads, or hosted access. The API key stays on the server.</small></p>
    </main>;
}
