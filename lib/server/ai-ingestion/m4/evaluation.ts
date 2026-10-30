import 'server-only';
import type { SemanticEvidence, SemanticVerification } from '../../../ai-ingestion/increment-02/contracts';
import { scoreEvaluation, type GoldCase } from '../increment-i2/evaluation';
import { requestPlanSchema } from '../../../ai-ingestion/increment-03/plan';
/** Evaluation-only composition; labels are read only after processing has finished. */
export function scoreM4(evidence: SemanticEvidence, proposal: unknown, verification: SemanticVerification | null, gold: GoldCase, origin: 'RECORDED_TEST' | 'LIVE_GROQ', state: string, receipt: unknown) {
    const score = scoreEvaluation(evidence, proposal, verification, gold, origin);
    const r = receipt as {
        mode?: string;
        model?: string;
        requestId?: string;
        finishReason?: string;
        inputTokens?: number;
        outputTokens?: number;
    } | null;
    const completed = state === 'COMPLETED' && r?.finishReason === 'stop';
    return { ...score, providerState: state, completedGeneration: completed, unsupportedConventionAbstention: gold.conventions === null ? (proposal as {
            conventions?: unknown;
        } | null)?.conventions === null : null,
        // Callers cannot establish live transport provenance by handing this pure scorer a receipt.
        genuineModelPerformance: null, rawOrigin: origin, receipt, dispatchFailure: state === 'UNKNOWN' || state === 'DISPATCHING', schemaDenominator: state === 'COMPLETED' ? 1 : 0, schemaCompliant: completed && requestPlanSchema(evidence).safeParse(proposal).success ? 1 : 0,
        liveCandidateMetrics: origin === 'LIVE_GROQ' && completed ? { mappings: score.mappings, conventionsCorrect: score.conventionsCorrect, documentKindCorrect: score.documentKindCorrect, context: score.context } : null };
}
