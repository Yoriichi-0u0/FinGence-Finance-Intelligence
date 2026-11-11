import { z } from 'zod';

/**
 * One AI call, as the Technical log keeps it: what was called, by which feature and key, how big and how it ended.
 * Metadata only. The schema is strict, so a prompt, an answer, document text or an amount cannot be added to it by
 * mistake: an unknown field is rejected, and every text field is a short code or name with a fixed pattern.
 */
export const AI_CALL_STATUSES = ['OK', 'REFUSED', 'RATE_LIMITED', 'FAILED'] as const;
/** What the calling feature's own checks decided, when it decides on the server. Optional. */
export const AI_CALL_VERDICTS = ['ACCEPTED', 'QUARANTINED', 'ANSWERED', 'WITHHELD'] as const;

const slug = /^[a-z][a-z0-9-]{1,40}$/;
const code = /^[A-Z][A-Z0-9_]{0,59}$/;
export const aiCallSchema = z.strictObject({
    /** A registered feature slug (lib/ai-calls/features.ts), e.g. "finance-qa". */
    feature: z.string().regex(slug),
    /** Upper-case provider name, e.g. "GROQ". */
    provider: z.string().regex(/^[A-Z][A-Z0-9_]{1,20}$/),
    model: z.string().min(1).max(100).regex(/^[A-Za-z0-9._:/-]+$/),
    /** Which key paid for it: a name such as "jason-groq" or "key-2", never the key itself. */
    keyLabel: z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/).nullable(),
    requestId: z.string().max(100).regex(/^[A-Za-z0-9._:-]+$/).nullable(),
    status: z.enum(AI_CALL_STATUSES),
    verdict: z.enum(AI_CALL_VERDICTS).nullable(),
    /** Why it was refused, failed or withheld, as a code (e.g. PROVIDER_HTTP_400, RATE_LIMITED). */
    reasonCode: z.string().regex(code).nullable(),
    inputTokens: z.number().int().min(0).max(10_000_000).nullable(),
    outputTokens: z.number().int().min(0).max(10_000_000).nullable(),
    estimatedUsd: z.number().min(0).max(1_000).nullable(),
    latencyMs: z.number().int().min(0).max(3_600_000),
    /** The processing the call belongs to, when there is one (its ID, a hex fingerprint). */
    processingId: z.string().regex(/^[0-9a-f]{8,64}$/).nullable(),
});
export type AiCall = z.infer<typeof aiCallSchema>;

/** Who made the call: set once per request by the route (or job) and picked up by every call inside it. */
export type AiCaller = { organizationId: string; memberId: string | null; jobId: string | null };
