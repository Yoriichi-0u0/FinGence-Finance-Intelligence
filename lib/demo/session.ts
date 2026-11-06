import { browserDemoRunner } from './pipeline';
import { replayExtractor, type StoredExtraction } from '../processing/extractions';
import { replayInterpreter } from '../interpretation/client';
import type { DocumentInput } from './pipeline';
import type { InterpretationResult } from '../interpretation/contracts';

// The existing tab-scoped storage contract. No derived financial outputs are stored.
const STORAGE_KEY = 'fingence-demo-documents-v1';
export type Stored = { processedAt: string; documents: { name: string; provenance: DocumentInput['provenance']; base64: string }[]; interpretations?: Record<string, InterpretationResult>; job?: { id:string; processingId:string }; extractions?: Record<string, StoredExtraction> };
export const toBase64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export function readStored(storage?: Pick<Storage, 'getItem'>): Stored | null {
    try { const raw = (storage ?? sessionStorage).getItem(STORAGE_KEY); return raw ? JSON.parse(raw) as Stored : null; } catch { return null; }
}
export function writeStored(value: Stored | null, storage?: Pick<Storage, 'setItem' | 'removeItem'>) {
    try { const target = storage ?? sessionStorage; if (value) target.setItem(STORAGE_KEY, JSON.stringify(value)); else target.removeItem(STORAGE_KEY); return true; } catch { return false; }
}
/** Restore by replaying the existing gates, never by trusting stored financial results or calling AI. */
export function restoreStored(stored: Stored) {
    return browserDemoRunner.run(stored.documents.map(d => ({ name: d.name, provenance: d.provenance, bytes: fromBase64(d.base64) })), undefined, { interpreter: replayInterpreter(stored.interpretations ?? {}, null), job:stored.job ? { id:stored.job.id, runner:'BACKEND_JOB_RUNNER' } : null, extract:stored.extractions ? replayExtractor(stored.extractions) : undefined });
}
