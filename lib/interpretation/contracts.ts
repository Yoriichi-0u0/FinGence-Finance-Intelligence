/**
 * Layout interpretation contract. A model PROPOSES how an unfamiliar document is laid out; it never
 * transcribes amounts. Every proposal is untrusted input: it is schema-validated and then accepted
 * only when the deterministic gates in `gates.ts` re-derive and confirm it from the original bytes.
 */
import { z } from 'zod';

export const INTERPRETATION_VERSION = 'fingence-layout-interpretation-v1';
export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'DD-Mon-YYYY', 'D Mon YYYY', 'YYYYMMDD'] as const;
export const NUMBER_FORMATS = ['PLAIN', 'COMMA_THOUSANDS_DOT_DECIMAL', 'DOT_THOUSANDS_COMMA_DECIMAL'] as const;
export const REPRESENTATIONS = ['SIGNED_AMOUNT', 'AMOUNT_AND_DIRECTION', 'SPLIT_IN_OUT', 'DEBIT_CREDIT'] as const;
export const ROLES = ['BANK_STATEMENT', 'GENERAL_LEDGER', 'UNSUPPORTED'] as const;

const column = z.number().int().min(0).max(63).nullable();
const evidence = z.strictObject({ line: z.number().int().min(0).max(4999), literal: z.string().min(1).max(160) }).nullable();

/**
 * The flat layout form the gates judge. It is also the legacy (v1) wire format, still accepted for replays of
 * proposals stored before v2. Strict-mode friendly: every property required, optional values are nullable.
 */
export const proposalSchema = z.strictObject({
    role: z.enum(ROLES),
    headerLine: z.number().int().min(0).max(40),
    columns: z.strictObject({
        recordId: column, date: column, reference: column, description: column, counterparty: column,
        amount: column, direction: column, moneyIn: column, moneyOut: column, debit: column, credit: column,
        balance: column, account: column, currency: column, businessId: column, businessName: column,
    }),
    representation: z.enum(REPRESENTATIONS).nullable(),
    directionTokens: z.strictObject({ inflow: z.array(z.string().min(1).max(24)).max(6), outflow: z.array(z.string().min(1).max(24)).max(6) }),
    dateFormat: z.enum(DATE_FORMATS).nullable(),
    numberFormat: z.enum(NUMBER_FORMATS).nullable(),
    scope: z.strictObject({ businessId: evidence, businessName: evidence, currency: evidence, statementPeriod: evidence }),
    rationale: z.string().max(600),
    unresolved: z.array(z.string().max(200)).max(8),
});
export type LayoutProposal = z.infer<typeof proposalSchema>;

/*
 * v2 model contract: the money mapping is a union keyed by representation, nested in a union keyed by role, so
 * strict constrained decoding cannot emit a contradictory combination (amount + direction under SPLIT_IN_OUT, one
 * column as both money-in and debit, debit/credit slots on a bank statement, DR/CR without tokens). The gates
 * still check everything: the schema removes a class of model error, it does not establish correctness.
 */
export const PROPOSAL_VERSION = 'fingence-layout-proposal-v2';
const index = z.number().int().min(0).max(63);
const tokens = z.array(z.string().min(1).max(24)).min(1).max(6);
const signedAmount = z.strictObject({ representation: z.literal('SIGNED_AMOUNT'), amount: index });
const amountAndDirection = z.strictObject({ representation: z.literal('AMOUNT_AND_DIRECTION'), amount: index, direction: index, inflowTokens: tokens, outflowTokens: tokens });
const splitInOut = z.strictObject({ representation: z.literal('SPLIT_IN_OUT'), moneyIn: index, moneyOut: index });
const debitCredit = z.strictObject({ representation: z.literal('DEBIT_CREDIT'), debit: index, credit: index });
const textColumns = { recordId: column, date: index, reference: index, description: index, counterparty: column, balance: column, currency: column, businessId: column, businessName: column };
const table = {
    headerLine: z.number().int().min(0).max(40),
    dateFormat: z.enum(DATE_FORMATS).nullable(),
    numberFormat: z.enum(NUMBER_FORMATS).nullable(),
    scope: z.strictObject({ businessId: evidence, businessName: evidence, currency: evidence, statementPeriod: evidence }),
};
export const modelProposalSchema = z.strictObject({
    layout: z.union([
        z.strictObject({ role: z.literal('BANK_STATEMENT'), ...table, columns: z.strictObject(textColumns), money: z.union([signedAmount, amountAndDirection, splitInOut]) }),
        z.strictObject({ role: z.literal('GENERAL_LEDGER'), ...table, columns: z.strictObject({ ...textColumns, account: column }), money: z.union([signedAmount, amountAndDirection, debitCredit]) }),
        z.strictObject({ role: z.literal('UNSUPPORTED') }),
    ]),
    rationale: z.string().max(600),
    unresolved: z.array(z.string().max(200)).max(8),
});
export type ModelProposal = z.infer<typeof modelProposalSchema>;

const COLUMN_ORDER = Object.keys(proposalSchema.shape.columns.shape) as (keyof LayoutProposal['columns'])[];
const NO_MONEY = { amount: null, direction: null, moneyIn: null, moneyOut: null, debit: null, credit: null };
/** v2 → the flat form; flat (legacy v1) proposals pass through. Anything else is a schema failure. */
export function parseProposal(raw: unknown): { success: true; data: LayoutProposal; version: 'v1' | 'v2' } | { success: false; issues: string[] } {
    const v2 = modelProposalSchema.safeParse(raw);
    if (v2.success) {
        const { layout, rationale, unresolved } = v2.data;
        if (layout.role === 'UNSUPPORTED') return { success: true, version: 'v2', data: {
            role: 'UNSUPPORTED', headerLine: 0, columns: { recordId: null, date: null, reference: null, description: null, counterparty: null, ...NO_MONEY, balance: null, account: null, currency: null, businessId: null, businessName: null },
            representation: null, directionTokens: { inflow: [], outflow: [] }, dateFormat: null, numberFormat: null, scope: { businessId: null, businessName: null, currency: null, statementPeriod: null }, rationale, unresolved } };
        const { representation, ...money } = layout.money;
        const directionTokens = 'inflowTokens' in money ? { inflow: money.inflowTokens, outflow: money.outflowTokens } : { inflow: [], outflow: [] };
        const fields = Object.fromEntries(Object.entries(money).filter(([k]) => k !== 'inflowTokens' && k !== 'outflowTokens'));
        const merged: Record<string, number | null> = { account: null, ...layout.columns, ...NO_MONEY, ...fields };
        // Same key order as the flat schema, so the mapping key (and therefore identity) is form-independent.
        const columns = Object.fromEntries(COLUMN_ORDER.map(k => [k, merged[k] ?? null])) as LayoutProposal['columns'];
        return { success: true, version: 'v2', data: {
            role: layout.role, headerLine: layout.headerLine, columns,
            representation, directionTokens, dateFormat: layout.dateFormat, numberFormat: layout.numberFormat, scope: layout.scope, rationale, unresolved } };
    }
    const v1 = proposalSchema.safeParse(raw);
    if (v1.success) return { success: true, version: 'v1', data: v1.data };
    return { success: false, issues: v2.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`) };
}

/** What the model is shown: a bounded window of the document plus per-column profiles, never the whole file. */
const lineSchema = z.strictObject({ line: z.number().int().min(0).max(4999), cells: z.array(z.string().max(80)).max(24) });
export const evidenceSchema = z.strictObject({
    version: z.literal(INTERPRETATION_VERSION),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    fileName: z.string().max(80),
    delimiter: z.enum([',', ';', '\t', '|']),
    totalLines: z.number().int().min(1).max(5000),
    head: z.array(lineSchema).max(18),
    tail: z.array(lineSchema).max(3),
    profiles: z.array(z.strictObject({
        column: z.number().int().min(0).max(63), header: z.string().max(80), samples: z.array(z.string().max(60)).max(5),
        nonEmpty: z.number().int().min(0), numericLike: z.number().int().min(0), dateLike: z.number().int().min(0),
    })).max(24),
    profileHeaderLine: z.number().int().min(0).max(4999),
});
export type LayoutEvidence = z.infer<typeof evidenceSchema>;

export type ModelReceipt = {
    provider: 'GROQ'; model: string; requestId: string | null; latencyMs: number;
    inputTokens: number | null; outputTokens: number | null; estimatedUsd: number | null;
    /** LIVE: returned by this call. REPLAYED: an earlier live proposal re-checked after reload (no new call). */
    mode: 'LIVE' | 'REPLAYED';
};
export type InterpretationResult = { proposal: unknown; receipt: ModelReceipt };
export interface LayoutInterpreter { propose(evidence: LayoutEvidence): Promise<InterpretationResult> }
/** `retryAfterSeconds` is set only for a provider refusal (HTTP 429), which is never billed and may be retried. */
export class InterpreterUnavailable extends Error { constructor(readonly code: string, readonly retryAfterSeconds?: number) { super(code); } }
