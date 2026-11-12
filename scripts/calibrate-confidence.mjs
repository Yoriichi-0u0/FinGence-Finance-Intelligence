// Calibrates the "read reliably" rule of lib/confidence against saved ingestion-benchmark results (no model calls).
// Usage: node scripts/calibrate-confidence.mjs <results.json> [more.json ...]
// Later files replace earlier rows with the same corpus and id (a rerun supersedes its run). Prints counts only.
import { readFileSync } from 'node:fs';

const OCR_MIN_CONFIDENCE = 90; // keep equal to lib/confidence/index.ts
const files = process.argv.slice(2);
if (!files.length) { console.error('Usage: node scripts/calibrate-confidence.mjs <results.json> [...]'); process.exit(1); }
const latest = new Map();
for (const f of files) for (const r of JSON.parse(readFileSync(f, 'utf8')).results) latest.set(`${r.corpus}/${r.id}`, r);
const rows = [...latest.values()], accepted = rows.filter(r => String(r.outcome).startsWith('ACCEPTED'));
const exact = r => r.outcome === 'ACCEPTED_EXACT' && !r.firstMismatch;
const reliable = r => r.source !== 'OCR' || (r.ocrConfidence ?? 0) >= OCR_MIN_CONFIDENCE;
const count = (f) => accepted.filter(f).length;
console.log(JSON.stringify({
    documents: rows.length, accepted: accepted.length, quarantined: rows.length - accepted.length,
    reliableExact: count(r => reliable(r) && exact(r)), reliableWrong: count(r => reliable(r) && !exact(r)),
    notReliableExact: count(r => !reliable(r) && exact(r)), notReliableWrong: count(r => !reliable(r) && !exact(r)),
    acceptedOcrConfidences: accepted.filter(r => r.source === 'OCR').map(r => r.ocrConfidence).sort((a, b) => a - b),
}, null, 2));
