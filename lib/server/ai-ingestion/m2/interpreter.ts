import 'server-only';
import type { SemanticEvidence } from '../../../ai-ingestion/increment-02/contracts';
import { POLICY_VERSION } from '../../../ai-ingestion/increment-02/contracts';
import { contextRule, headingRule, observedDocumentKind } from '../../../ai-ingestion/increment-02/registry';
import { datesUnambiguous, numbersUnambiguous } from '../../../ai-ingestion/increment-02/conventions';
import { policyHash, prepareRequest, hash, type InterpretationPlan03 } from '../../../ai-ingestion/increment-03/plan';
import type { Provider03, Receipt03 } from '../increment-03/providers';
export interface M2Interpreter {
    mode: 'SIMULATED' | 'LIVE_GROQ';
    propose(evidence: SemanticEvidence): Promise<{
        plan: unknown;
        receipt: Receipt03;
    }>;
}
/** Dynamic offline semantic TEST DOUBLE. Reads evidence/rules only, never gold labels or fixture names. */
export const offlineSemanticAdapter: M2Interpreter = { mode: 'SIMULATED', async propose(evidence) {
        const fields = evidence.tables.flatMap(t => t.headerIds.map(id => ({ headerId: id, ruleId: headingRule(evidence.items.find(i => i.id === id)!.text)?.id ?? null, reason: 'SIMULATED offline rule adapter; not LLM inference' })));
        const roles = fields.map(f => evidence.items.find(i => i.id === f.headerId)!).map(i => headingRule(i.text));
        const targets = new Set(roles.map(r => r?.target));
        const dateValues = evidence.items.filter(i => !i.header && i.table !== null && ['transaction_date', 'posting_date'].includes(headingRule(i.column ?? '')?.role ?? '')).map(i => i.value);
        const numberValues = evidence.items.filter(i => !i.header && i.table !== null && ['amount', 'debit', 'credit', 'balance'].includes(headingRule(i.column ?? '')?.role ?? '')).map(i => i.value);
        const dateOrder = (['ISO', 'DMY', 'MDY'] as const).find(order => datesUnambiguous(dateValues, order));
        const numberFormat = (['plain', 'dot_comma', 'comma_dot'] as const).find(format => numbersUnambiguous(numberValues, format));
        const documentKind = observedDocumentKind(evidence.items.filter(i => i.table === null).map(i => i.text)) ?? 'TRANSACTION_TABLE';
        const monetaryMode = targets.has('source_amount') && !targets.has('debit') && !targets.has('credit') ? (targets.has('entry_side') ? 'amount_direction' : 'signed_amount') : !targets.has('source_amount') && targets.has('debit') && targets.has('credit') && documentKind === 'GENERAL_LEDGER' ? 'debit_credit' : null;
        const plan: InterpretationPlan03 = { version: 'v2-plan-0.3', policyVersion: POLICY_VERSION, policyHash, documentKind, assumptions: [], conventions: dateOrder && numberFormat && monetaryMode ? { dateOrder, numberFormat, dateBasis: 'transaction_date', monetaryMode } : null, fields,
            context: evidence.items.filter(i => i.table === null && i.text.trim()).map(i => ({ evidenceId: i.id, ruleId: contextRule(i.text) ?? 'unknown', disposition: contextRule(i.text) ? 'SUPPORTING_METADATA' : 'UNRESOLVED' })) };
        return { plan, receipt: { mode: 'RECORDED_TEST', model: 'SIMULATED_OFFLINE_SEMANTIC_ADAPTER_V1', requestId: null, inputTokens: null, outputTokens: null, reasoningTokens: null, estimatedUsd: null, retries: 0, durationMs: 0, outputHash: hash(plan) } };
    } };
/** Reuses the existing quota-controlled Groq transport only after separate server authorization.
 * No HTTP field/environment switch in M2 constructs or activates this boundary. */
export function groqReadyBoundary(provider: Provider03, authorized: () => boolean): M2Interpreter {
    return { mode: 'LIVE_GROQ', async propose(evidence) { if (!authorized())
            throw new Error('LIVE_DISPATCH_NOT_AUTHORIZED'); const result = await provider.propose(prepareRequest(evidence)); if (result.receipt.mode !== 'LIVE_GROQ' || result.receipt.finishReason !== 'stop')
            throw new Error('UNSUPPORTED_PROVIDER_RECEIPT'); return result; } };
}
