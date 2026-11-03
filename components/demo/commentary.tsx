'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle, Sparkles } from 'lucide-react';
import { Panel } from '@/components/ui';
import { gatewayQaModel, qaGatewayStatus, type GroundedRun, type QaGatewayStatus } from '@/lib/grounded-qa/client';
import { writeCommentary } from '@/lib/grounded-qa/commentary';
import { groundingIndex } from '@/lib/grounded-qa/tools';
import type { ProcessingContext } from '@/lib/demo/pipeline';
import { useDemoProcessing } from './context';
import { GroundedAnswer } from './grounded-answer';
import { button } from './shared';

/**
 * Optional AI-written commentary above the deterministic management summary. Shown only when the AI gateway is
 * on; the model words sentences over verified facts and FinGence fills every figure, or the text is withheld.
 */
export function AiCommentary({ context, onResult }: { context: ProcessingContext; onResult: (run: GroundedRun | null) => void }) {
    const gateway = useDemoProcessing().ai?.available ?? false;
    const [ai, setAi] = useState<QaGatewayStatus>({ available: false });
    const [result, setResult] = useState<{ processingId: string; run: GroundedRun } | null>(null), [busy, setBusy] = useState(false);
    useEffect(() => { let live = true; if (gateway) qaGatewayStatus().then(s => { if (live) setAi(s); }); return () => { live = false; }; }, [gateway]);
    const index = groundingIndex(context), run = result?.processingId === context.processingId ? result.run : null;
    if (!ai.available || !index) return null;
    async function write() {
        setBusy(true);
        const next = await writeCommentary(index!, gatewayQaModel);
        setResult({ processingId: context.processingId, run: next }); onResult(next.status === 'ANSWERED' ? next : null); setBusy(false);
    }
    return <div className="mb-5"><Panel title="AI management commentary" eyebrow={`${ai.model} on Groq · every figure filled in by FinGence`}>
        <div className="space-y-3 p-4 text-sm sm:p-5">
            {run ? <GroundedAnswer run={run} heading="Commentary on the verified figures below" fallback="The management summary below is computed without AI and is unaffected." />
                : <p className="text-[var(--muted-strong)]">A language model can word a short commentary on this period. FinGence runs fixed queries over the verified records and sends only their results; the model never types an amount, date or count, and a commentary that fails any check is withheld.</p>}
            <button type="button" className={`${button} print:hidden`} disabled={busy} onClick={() => void write()}>{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <Sparkles aria-hidden="true" size={16} />}{busy ? 'Writing…' : run ? 'Write again' : 'Write commentary with AI'}</button>
        </div>
    </Panel></div>;
}
