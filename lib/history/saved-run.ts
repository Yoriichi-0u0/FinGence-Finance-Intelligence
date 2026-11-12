import { z } from 'zod';
import { processingConfidence } from '../confidence';
import type { DocumentInput, ProcessingContext } from '../demo/pipeline';
import type { InterpretationResult } from '../interpretation/contracts';
import type { StoredExtraction } from '../processing/extractions';

/**
 * A saved run: what it was, plus the small bundle that, with its documents, reproduces every result exactly (the same
 * deterministic pipeline, the AI's accepted readings replayed, no new model call). Shared by the server (a processing job)
 * and the browser (a run processed in this browser), and checked again on the server before it is stored.
 */
export type RestoreBundle = { interpretations: Record<string, InterpretationResult>; extractions?: Record<string, StoredExtraction>; job?: { id: string; processingId: string } };
export type SavedDocument = { name: string; provenance: DocumentInput['provenance']; sha256: string; bytes: number; contentType: string };
export type SavedRunPayload = {
    processedAt: string; processingId: string; pipelineVersion: string; status: ProcessingContext['status'];
    businessId: string | null; businessName: string | null; period: string | null; currency: string | null;
    documents: SavedDocument[];
    confidence: { status: 'MEASURED' | 'INCOMPLETE'; percent?: number; band?: string; reason?: string };
    report: Record<string, unknown> | null;
    bundle: RestoreBundle;
};

export async function sha256Hex(bytes: Uint8Array) {
    const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function contentTypeOf(name: string, b: Uint8Array) {
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf';
    if (b[0] === 0x89 && b[1] === 0x50) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    if (b[0] === 0x50 && b[1] === 0x4b) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return /\.csv$/i.test(name) ? 'text/csv' : 'application/octet-stream';
}

export async function savedRunPayload(c: ProcessingContext, documents: DocumentInput[], bundle: RestoreBundle, processedAt: string): Promise<SavedRunPayload> {
    const confidence = processingConfidence(c);
    return {
        processedAt, processingId: c.processingId, pipelineVersion: c.version, status: c.status,
        businessId: c.scope?.businessId ?? null, businessName: c.scope?.businessName ?? null, period: c.scope?.period ?? null, currency: c.scope?.currency ?? null,
        documents: await Promise.all(documents.map(async d => ({ name: d.name, provenance: d.provenance, sha256: await sha256Hex(d.bytes), bytes: d.bytes.byteLength, contentType: contentTypeOf(d.name, d.bytes) }))),
        confidence: confidence.status === 'MEASURED' ? { status: 'MEASURED', percent: confidence.percent, band: confidence.band } : { status: 'INCOMPLETE', reason: confidence.reason },
        report: (c.outputs.report as unknown as Record<string, unknown>) ?? null,
        bundle,
    };
}

/** The shape the server accepts from a browser (a run processed in the browser), before it stores anything. */
export const savedRunSchema = z.object({
    processedAt: z.iso.datetime({ offset: true }), processingId: z.string().regex(/^[0-9a-f]{8,64}$/), pipelineVersion: z.string().min(1).max(64),
    status: z.enum(['COMPLETED', 'COMPLETED_WITH_EXCEPTIONS', 'QUARANTINED']),
    businessId: z.string().max(64).nullable(), businessName: z.string().max(200).nullable(), period: z.string().regex(/^\d{4}-\d{2}(\/\d{4}-\d{2})?$/).nullable(), currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    documents: z.array(z.object({ name: z.string().min(1).max(160), provenance: z.enum(['PUBLIC_SYNTHETIC_SAMPLE', 'USER_SUPPLIED']), sha256: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number().int().min(1).max(50_000_000), contentType: z.string().regex(/^[a-z]+\/[a-z0-9.+-]{1,80}$/) }).strict()).min(1).max(20),
    confidence: z.object({ status: z.enum(['MEASURED', 'INCOMPLETE']), percent: z.number().min(0).max(100).optional(), band: z.enum(['HIGH', 'CHECK', 'LOW']).optional(), reason: z.string().max(400).optional() }).strict(),
    report: z.record(z.string(), z.unknown()).nullable(),
    bundle: z.object({ interpretations: z.record(z.string(), z.unknown()), extractions: z.record(z.string(), z.unknown()).optional(), job: z.object({ id: z.string().uuid(), processingId: z.string() }).optional() }).strict(),
}).strict();
