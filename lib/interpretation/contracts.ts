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

/** Strict-mode friendly: every property required, optional values are nullable. */
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
