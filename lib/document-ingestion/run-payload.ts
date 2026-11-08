/**
 * The stored form of one ingestion run: every document's fingerprints, decision, model receipt, gate checks and
 * notes, and each accepted document's verified records. Never the uploaded file. Built in the browser from a
 * completed processing context and validated again by the server before it is written.
 */
import { z } from 'zod';
import type { ProcessingContext } from '../demo/pipeline';
import { fromCents, toCents } from '../poc-anomalies/source';

const sha = z.string().regex(/^[0-9a-f]{64}$/);
const text = (max: number) => z.string().max(max);
const record = z.strictObject({
    recordId: z.string().min(1).max(64), businessId: z.string().min(1).max(64), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), currency: z.string().regex(/^[A-Z]{3}$/),
    signedCents: z.string().regex(/^-?\d{1,15}$/), reference: text(200), description: text(500), counterparty: text(200),
});
const check = z.strictObject({ id: text(64), label: text(200), passed: z.boolean(), detail: text(600) });
export const runPayloadSchema = z.strictObject({
    pipelineVersion: text(64), processingId: z.string().regex(/^[0-9a-f]{8,64}$/),
    scope: z.strictObject({ businessId: text(64), period: text(32), currency: text(3) }).nullable(),
    documents: z.array(z.strictObject({
        name: z.string().min(1).max(160), fileSha256: sha, tableSha256: sha, format: z.enum(['CSV', 'XLSX', 'PDF_TEXT', 'OCR']),
        role: z.enum(['BANK_STATEMENT', 'GENERAL_LEDGER', 'BANK_HISTORY']).nullable(), decision: z.enum(['AUTO_ACCEPTED', 'QUARANTINED', 'UNAVAILABLE']), reason: text(2000),
        method: z.enum(['EXACT_SIGNATURE', 'AI_LAYOUT_PROPOSAL', 'NONE']),
        model: text(80).nullable(), modelRequestId: text(120).nullable(), receiptMode: z.enum(['LIVE', 'REPLAYED']).nullable(),
        inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable(), estimatedUsd: z.number().nonnegative().nullable(),
        mapping: z.array(z.strictObject({ field: text(32), column: z.number().int(), heading: text(160), agreement: text(16).nullable() })).max(32),
        checks: z.array(check).max(64), disclosures: z.array(text(600)).max(32), notes: z.array(text(400)).max(32),
        canonicalSha256: sha.nullable(), records: z.array(record).max(5000),
    })).min(1).max(20),
});
export type RunPayload = z.infer<typeof runPayloadSchema>;

const clip = (v: string, n: number) => v.length > n ? v.slice(0, n) : v;
/** The run as it will be stored. Records come from the verified, normalized rows every page reads. */
export function runPayload(c: ProcessingContext): RunPayload {
    const o = c.outputs;
    const recordsFor = (role: string | null): RunPayload['documents'][number]['records'] => {
        if (role === 'BANK_STATEMENT') return o.bankRows.map(r => ({ recordId: r.rowId, businessId: r.businessId, date: r.date, currency: r.currency, signedCents: toCents(r.signedAmount).toString(), reference: clip(r.reference, 200), description: clip(r.description, 500), counterparty: clip(r.counterparty, 200) }));
        if (role === 'GENERAL_LEDGER') return (o.ledger?.rows ?? []).map(r => ({ recordId: r.recordId, businessId: r.businessId, date: r.date, currency: r.currency, signedCents: r.signedCents, reference: clip(r.reference, 200), description: clip(r.description, 500), counterparty: '' }));
        if (role === 'BANK_HISTORY' && o.history.accepted) return o.history.rows.slice(0, 5000).map(r => ({ recordId: r.rowId, businessId: r.businessId, date: r.date, currency: r.currency, signedCents: toCents(r.signedAmount).toString(), reference: clip(r.reference, 200), description: clip(r.description, 500), counterparty: clip(r.counterparty, 200) }));
        return [];
    };
    return {
        pipelineVersion: c.version, processingId: c.processingId,
        scope: c.scope ? { businessId: c.scope.businessId, period: c.scope.period, currency: c.scope.currency } : null,
        documents: c.documents.slice(0, 20).map(d => {
            const i = d.interpretation, r = i?.receipt ?? null, s = d.source;
            const format = s?.kind === 'WORKSHEET' ? 'XLSX' as const : s?.kind ?? 'CSV' as const;
            return {
                name: clip(d.name, 160), fileSha256: s?.kind === 'WORKSHEET' ? s.workbookSha256 : s ? s.fileSha256 : d.sha256, tableSha256: d.sha256, format,
                role: d.role, decision: d.decision, reason: clip(d.reason, 2000), method: i ? 'AI_LAYOUT_PROPOSAL' as const : d.role ? 'EXACT_SIGNATURE' as const : 'NONE' as const,
                model: r?.model ?? null, modelRequestId: r?.requestId ?? null, receiptMode: r?.mode ?? null, inputTokens: r?.inputTokens ?? null, outputTokens: r?.outputTokens ?? null, estimatedUsd: r?.estimatedUsd ?? null,
                mapping: (i?.mapping ?? []).slice(0, 32).map(m => ({ field: m.field, column: m.column, heading: clip(m.heading, 160), agreement: m.agreement })),
                checks: (i?.checks ?? []).slice(0, 64).map(k => ({ id: clip(k.id, 64), label: clip(k.label, 200), passed: k.passed, detail: clip(k.detail, 600) })),
                disclosures: (i?.disclosures ?? []).slice(0, 32).map(x => clip(x, 600)), notes: (s?.notes ?? []).slice(0, 32).map(x => clip(x, 400)),
                canonicalSha256: i?.canonicalSha256 ?? null,
                records: d.decision === 'AUTO_ACCEPTED' ? recordsFor(d.role) : [],
            };
        }),
    };
}
/** Net of a stored record set, for display. */
export const recordsNet = (records: { signedCents: string }[]) => fromCents(records.reduce((n, r) => n + BigInt(r.signedCents), 0n));
