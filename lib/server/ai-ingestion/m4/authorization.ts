import 'server-only';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { QuotaLedger, QUOTA } from '../increment-03/quota';
import { GroqProvider03 } from '../increment-03/providers';
import { prepareRequest, policyHash, promptRevision } from '../../../ai-ingestion/increment-03/plan';
import type { SemanticEvidence } from '../../../ai-ingestion/increment-02/contracts';
import { InterpretationFailure, type M2InferenceContext } from '../m2/interpreter';
const digest = z.string().regex(/^[a-f0-9]{64}$/), id = z.string().uuid();
export const ownerGrantSchema = z.strictObject({ version: z.literal('m4-owner-dispatch-v1'), id, operationId: id, organizationId: id, userId: id, membershipVersion: z.number().int().positive(), sourceSha256: digest, promptHash: digest, policyHash: digest, promptRevision: z.literal(promptRevision), provider: z.literal('LIVE_GROQ'), model: z.literal('openai/gpt-oss-20b'), plan: z.literal('GROQ_FREE'), maxRequests: z.literal(1), maxUsd: z.literal(0), experimentCeilingUsd: z.number().min(0).max(5), verifiedAt: z.number().int().positive(), expiresAt: z.number().int().positive(), checks: z.strictObject({ ownerDispatch: z.literal(true), syntheticOnly: z.literal(true), freePlan: z.literal(true), privacyRetention: z.literal(true), modelAccess: z.literal(true), accountQuotas: z.literal(true) }), limits: z.strictObject({ rpm: z.number().int().min(1).max(QUOTA.rpm), rpd: z.number().int().min(1).max(QUOTA.rpd), tpm: z.number().int().min(1).max(QUOTA.tpm), tpd: z.number().int().min(1).max(QUOTA.tpd), attempts: z.number().int().min(1).max(QUOTA.attempts) }) });
export type OwnerGrant = z.infer<typeof ownerGrantSchema>;
function safeDirectory(path: string) { const s = lstatSync(path); if (!s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid()))
    throw Error('UNSAFE_DISPATCH_STORAGE'); }
function readPrivate(file: string, maxBytes = 8192) { const before = lstatSync(file); if (before.isSymbolicLink())
    throw Error('UNSAFE_DISPATCH_STORAGE'); const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); try {
    const s = fstatSync(fd);
    if (!s.isFile() || s.dev !== before.dev || s.ino !== before.ino || (s.mode & 0o077) || (process.getuid && s.uid !== process.getuid()) || s.size > maxBytes)
        throw Error('UNSAFE_DISPATCH_STORAGE');
    return JSON.parse(readFileSync(fd, 'utf8'));
}
finally {
    closeSync(fd);
} }
function durableFile(file: string, data: unknown) { const fd = openSync(file, 'wx', 0o600); try {
    writeFileSync(fd, JSON.stringify(data));
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} syncParent(file); }
function syncParent(file: string) { if (process.platform !== 'win32') {
    const fd = openSync(dirname(file), 'r');
    try {
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
} }
/** Resolve the existing shared ledger. Never creates, replaces or resets it. */
export function canonicalQuotaDirectory() { const common = resolve(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()); if (basename(common) !== '.git' || lstatSync(common).isSymbolicLink())
    throw Error('CANONICAL_QUOTA_REQUIRED'); const folder = join(dirname(common), '.ai-local', 'increment-03'); safeDirectory(dirname(folder)); safeDirectory(folder); readPrivate(join(folder, 'quota.json'), 65536); return folder; }
export function readOwnerGrant(folder: string, authorizationId: string) { if (!id.safeParse(authorizationId).success)
    throw Error('OWNER_AUTHORIZATION_REQUIRED'); safeDirectory(folder); safeDirectory(join(folder, 'm4-authorizations')); return ownerGrantSchema.parse(readPrivate(join(folder, 'm4-authorizations', authorizationId + '.json'))); }
/** Live factory only. Neither HTTP handlers nor evaluation controls call this. No grant/key creation. */
export function prepareAuthorizedGroq(evidence: SemanticEvidence, context: M2InferenceContext, options: {
    folder: string;
    authorizationId: string;
    now?: () => number;
}) {
    if (process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.FINGENCE_M4_SINGLE_DISPATCH_AUTHORIZED !== '1' || process.env.FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED !== '1' || process.env.FINGENCE_AI03_FREE_PLAN_CONFIRMED !== '1' || !process.env.GROQ_API_KEY)
        throw Error('OWNER_AUTHORIZATION_REQUIRED');
    const grant = readOwnerGrant(options.folder, options.authorizationId), now = (options.now ?? Date.now)(), request = prepareRequest(evidence);
    if (grant.verifiedAt > now || now - grant.verifiedAt > 15 * 60000 || grant.expiresAt <= now || grant.expiresAt > grant.verifiedAt + 15 * 60000 || grant.operationId !== context.operationId || grant.organizationId !== context.principal.organization_id || grant.userId !== context.principal.user_id || grant.membershipVersion !== context.principal.version || grant.sourceSha256 !== evidence.sourceId || context.sourceSha256 !== evidence.sourceId || grant.promptHash !== request.promptHash || grant.policyHash !== policyHash || grant.promptRevision !== promptRevision)
        throw Error('OWNER_AUTHORIZATION_MISMATCH');
    const ledger = new QuotaLedger(options.folder), status = ledger.summary();
    if (status.inFlight || status.unknownCount)
        throw Error('PREVIOUS_DISPATCH_UNRESOLVED');
    const pending = join(options.folder, 'm4-dispatch.pending');
    if (existsSync(pending))
        throw Error('PREVIOUS_DISPATCH_UNRESOLVED');
    const provider = new GroqProvider03(ledger, undefined, { authorizationId: grant.id, sourceSha256: evidence.sourceId }, grant.limits);
    let claimed = false;
    return { authorizationId: grant.id, provider: { async propose(input: typeof request) { if (input.promptHash !== grant.promptHash)
                throw Error('OWNER_AUTHORIZATION_MISMATCH'); try {
                durableFile(pending, { version: 'm4-dispatch-pending-v1', authorizationId: grant.id, operationId: context.operationId, sourceSha256: evidence.sourceId, promptHash: request.promptHash });
                claimed = true;
            }
            catch {
                throw new InterpretationFailure('PROVIDER_NOT_EXECUTED', false);
            } return provider.propose(input); } },
        settle(known: boolean) { if (known && claimed) {
            const marker = readPrivate(pending) as {
                authorizationId?: string;
            };
            if (marker.authorizationId !== grant.id)
                throw Error('DISPATCH_FENCE_MISMATCH');
            unlinkSync(pending);
            syncParent(pending);
            claimed = false;
        } }, grant };
}
