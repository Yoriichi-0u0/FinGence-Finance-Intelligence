/**
 * Grounded Finance Q&A contracts. Two strict-schema model calls per question:
 *  PLAN   — the model sees the question and a value-free CATALOGUE and chooses deterministic tool queries
 *           (or a typed refusal). Filter values are enums built from the catalogue, so a model cannot name
 *           a counterparty or month that the verified records do not contain.
 *  ANSWER — the model sees verified FACTS and writes sentences whose figures are placeholders ({F3},
 *           {F3.date}, {D1}); typed derivations are computed by code. Gates in `gates.ts` decide.
 * Both are untrusted until the gates pass; nothing here establishes correctness.
 */
import { z } from 'zod';
import { reconciliationStatuses } from '../poc-reconciliation/contracts';

export const QA_VERSION = 'fingence-grounded-qa-v1';
export const MAX_QUESTION = 300;
export const MAX_QUERIES = 4;
export const MAX_FACTS = 48;
export const DERIVED_IDS = ['D1', 'D2', 'D3', 'D4'] as const;
export const REFUSALS = ['ADVICE', 'ALLEGATION', 'CAUSE_NOT_RECORDED', 'CLASSIFICATION_NOT_RECORDED', 'OUTSIDE_SCOPE', 'UNSUPPORTED_MEASURE', 'NOT_A_FINANCE_QUESTION'] as const;
export type Refusal = typeof REFUSALS[number];
export const RECONCILIATION_FILTERS = ['ALL_EXCEPTIONS', ...reconciliationStatuses] as const;

/** A month (YYYY-MM), or a multi-month processing's range (YYYY-MM/YYYY-MM). */
const PERIOD_OR_RANGE = /^\d{4}-(0[1-9]|1[0-2])(\/\d{4}-(0[1-9]|1[0-2]))?$/;
export const catalogueSchema = z.strictObject({
    version: z.literal(QA_VERSION),
    scope: z.strictObject({ businessId: z.string().max(64), businessName: z.string().max(120), period: z.string().regex(PERIOD_OR_RANGE), currency: z.string().regex(/^[A-Z]{3}$/) }),
    // Observed months; a multi-month processing also lists its whole range, which cash_summary answers for all statement records.
    months: z.array(z.string().regex(PERIOD_OR_RANGE)).min(1).max(25),
    counterparties: z.array(z.string().min(1).max(120)).max(60),
    reconciliationStatuses: z.array(z.enum(RECONCILIATION_FILTERS)).max(8),
    anomalySeverities: z.array(z.enum(['HIGH', 'MEDIUM'])).max(2),
});
/** Everything the PLAN call may see: scope and allowed filter values. No amounts, dates or records. */
export type Catalogue = z.infer<typeof catalogueSchema>;

const enumOf = (values: readonly string[]) => z.enum(values as [string, ...string[]]);
/** The tool-call union, with catalogue members as enums. */
export function toolCallSchema(c: Pick<Catalogue, 'months' | 'counterparties'>) {
    const direction = z.enum(['IN', 'OUT', 'ANY']);
    const counterparty = c.counterparties.length ? enumOf(c.counterparties).nullable() : z.null();
    return z.union([
        z.strictObject({ tool: z.literal('cash_summary'), period: enumOf(c.months) }),
        z.strictObject({ tool: z.literal('transactions'), direction, counterparty, sort: z.enum(['LARGEST', 'EARLIEST', 'LATEST']), limit: z.number().int().min(1).max(8) }),
        z.strictObject({ tool: z.literal('counterparties'), direction, limit: z.number().int().min(1).max(10) }),
        z.strictObject({ tool: z.literal('reconciliation'), status: z.enum(RECONCILIATION_FILTERS) }),
        z.strictObject({ tool: z.literal('anomalies'), severity: z.enum(['ANY', 'HIGH', 'MEDIUM']) }),
        z.strictObject({ tool: z.literal('monthly_history') }),
        z.strictObject({ tool: z.literal('forecast') }),
    ]);
}
export type ToolCall = z.infer<ReturnType<typeof toolCallSchema>>;

export function planSchema(c: Pick<Catalogue, 'months' | 'counterparties'>) {
    return z.strictObject({
        plan: z.union([
            z.strictObject({ kind: z.literal('QUERY'), queries: z.array(toolCallSchema(c)).min(1).max(MAX_QUERIES) }),
            z.strictObject({ kind: z.literal('REFUSE'), reason: z.enum(REFUSALS) }),
        ]),
        rationale: z.string().max(300),
    });
}
export type Plan = z.infer<ReturnType<typeof planSchema>>;

/** Fact references the ANSWER call may use: the IDs of this run's facts plus the derivation slots. */
export function answerSchema(factIds: string[]) {
    const ref = enumOf([...factIds, ...DERIVED_IDS]);
    return z.strictObject({
        answer: z.union([
            z.strictObject({
                kind: z.literal('ANSWERED'),
                sentences: z.array(z.strictObject({ text: z.string().min(1).max(400), cites: z.array(ref).min(1).max(6) })).min(1).max(5),
                derived: z.array(z.strictObject({ id: z.enum(DERIVED_IDS), op: z.enum(['DIFFERENCE', 'SUM', 'SHARE_PERCENT']), a: enumOf(factIds), aField: z.string().max(24).nullable(), b: enumOf(factIds), bField: z.string().max(24).nullable() })).max(4),
            }),
            z.strictObject({ kind: z.literal('INSUFFICIENT'), missing: z.string().max(200) }),
        ]),
    });
}
export type Answer = z.infer<ReturnType<typeof answerSchema>>;

/** Gateway request bodies (validated server-side before any provider call). */
export const askRequestSchema = z.union([
    z.strictObject({ stage: z.literal('plan'), question: z.string().min(1).max(MAX_QUESTION), catalogue: catalogueSchema }),
    z.strictObject({
        stage: z.literal('answer'), question: z.string().min(1).max(MAX_QUESTION), scope: catalogueSchema.shape.scope,
        facts: z.array(z.strictObject({ id: z.string().regex(/^F\d{1,2}$/), label: z.string().max(160), primary: z.string().max(24), fields: z.record(z.string().max(24), z.string().max(400)) })).min(1).max(MAX_FACTS),
    }),
]);
export type AskRequest = z.infer<typeof askRequestSchema>;
