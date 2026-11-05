/**
 * What a server job read from each PDF or scan (the words placed into a table), kept so the browser can re-check the
 * job on exactly the same table: OCR engines and image decoders differ between a server and a browser, so a second
 * OCR pass is not a re-check of the first. Every gate and the arithmetic anchor still run in full on the replayed table.
 */
import { extractDocument, type ExtractedSource, type Extractor } from '../interpretation/extract';

export type StoredExtraction = { base64: string; source: ExtractedSource };
const toBase64 = (bytes: Uint8Array) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const fromBase64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));

/** Reads as usual and records each successful reading by the file's SHA-256. */
export function recordingExtractor(record: Record<string, StoredExtraction>, base: Extractor = extractDocument): Extractor {
    return async (name, bytes, sha256) => {
        const read = await base(name, bytes, sha256);
        if (!('error' in read)) record[sha256] = { base64: toBase64(read.bytes), source: read.source };
        return read;
    };
}
/** Replays a recorded reading for the same file bytes; a file without one is read as usual. */
export function replayExtractor(saved: Record<string, StoredExtraction>, fallback: Extractor = extractDocument): Extractor {
    return async (name, bytes, sha256) => {
        const hit = saved[sha256];
        return hit && hit.source.fileSha256 === sha256 ? { bytes: fromBase64(hit.base64), source: hit.source } : fallback(name, bytes, sha256);
    };
}
