import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const manifests = [
  'docs/reconciliation/integrity-manifest.json',
  'docs/reconciliation/ai01-m2-integrity-manifest.json',
  'docs/reconciliation/ai02-integrity-manifest.json',
  'docs/reconciliation/ai03-integrity-manifest.json',
  'docs/reconciliation/ai04-integrity-manifest.json',
  'docs/reconciliation/ai05-integrity-manifest.json',
];
// These are historical source/configuration captures, never benchmark or prediction artifacts.
// Their recorded CRLF checkout hashes are preserved, not replaced by new hashes.
const captures = new Map([
  [manifests[2], new Set(['package.json', 'tsconfig.json'])],
  [manifests[3], new Set(['package.json', 'tsconfig.json'])],
  ['AI05 official freeze', new Set(['package.json', 'pnpm-lock.yaml', 'scripts/db03/vitest.config.mts'])],
]);

export function artifactMatch(context, file, bytes, expected) {
  if (sha256(bytes) === expected) return 'BYTE_EXACT';
  const text = bytes.toString('utf8');
  if (captures.get(context)?.has(file) && !text.includes('\r') && Buffer.from(text, 'utf8').equals(bytes)
      && sha256(Buffer.from(text.replace(/\n/g, '\r\n'), 'utf8')) === expected) {
    return 'CAPTURED_CRLF_SOURCE_FROM_LF_GIT_BLOB';
  }
  throw new Error(`Artifact integrity mismatch: ${context}: ${file}`);
}

export function safePath(file) {
  if (typeof file !== 'string' || !file || file.includes('\\') || file.includes(':')
      || file.startsWith('/') || file.split('/').some(p => !p || p === '.' || p === '..')) {
    throw new Error('Invalid repository-relative manifest path');
  }
  return file;
}

const canonical = value => {
  const sort = v => Array.isArray(v) ? v.map(sort) : v !== null && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, sort(x)])) : v;
  return JSON.stringify(sort(value), null, 2) + '\n';
};

export function verifyPublication(ref = 'INDEX') {
  if (!['INDEX', 'HEAD'].includes(ref) && !/^[a-f0-9]{40}$/.test(ref)) throw new Error('Expected INDEX, HEAD or a full commit SHA');
  const cache = new Map();
  const blob = file => {
    safePath(file);
    if (!cache.has(file)) cache.set(file, execFileSync('git', ['show', ref === 'INDEX' ? ':' + file : ref + ':' + file], { maxBuffer: 32 * 1024 * 1024 }));
    return cache.get(file);
  };
  const json = file => JSON.parse(blob(file).toString('utf8'));
  const evidence = [];
  let checks = 0;
  const verifyMap = (context, kind, entries) => {
    for (const [file, expected] of Object.entries(entries)) {
      const bytes = blob(file);
      if (kind === 'sources') {
        if (sha256(Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'))) !== expected) throw new Error('Source integrity mismatch: ' + file);
      } else {
        const convention = artifactMatch(context, file, bytes, expected);
        if (convention !== 'BYTE_EXACT') evidence.push({ context, file, convention, gitBlobSHA256: sha256(bytes), recordedCheckoutSHA256: expected });
      }
      checks++;
    }
  };
  for (const file of manifests) {
    const m = json(file);
    const sourceRule = m.hashConvention?.sources ?? m.sourceConvention ?? m.sourcesConvention;
    const artifactRule = m.hashConvention?.artifacts ?? m.artifactConvention ?? m.artifactsConvention;
    if (sourceRule !== 'crlf-to-lf-v1' || artifactRule !== 'byte-exact') throw new Error('Unknown manifest convention: ' + file);
    for (const kind of ['sources', 'artifacts', 'externalInputs']) verifyMap(file, kind, m[kind] ?? {});
  }
  const dir = 'docs/reconciliation/evidence/ai05/official/';
  const freeze = json(dir + 'freeze.json'), { fingerprint, ...body } = freeze;
  if (sha256(canonical(body)) !== fingerprint) throw new Error('Official freeze fingerprint mismatch');
  for (const kind of ['sources', 'artifacts']) verifyMap('AI05 official freeze', kind, freeze[kind]);
  const seal = json(dir + 'prediction-seal.json');
  if (seal.phase !== 'PREDICTIONS_FROZEN_BEFORE_TRUTH' || seal.truthLoaded !== false
      || sha256(blob(dir + 'freeze.json')) !== seal.freezeSHA256 || sha256(blob(dir + 'predictions.json')) !== seal.predictionsSHA256) throw new Error('Official prediction seal mismatch');
  const evaluation = json(dir + 'evaluation.json'), { fingerprint: evaluationFingerprint, ...evaluationBody } = evaluation;
  if (sha256(canonical(evaluationBody)) !== evaluationFingerprint || evaluation.freezeFingerprint !== fingerprint
      || evaluation.predictionsSHA256 !== seal.predictionsSHA256) throw new Error('Official evaluation seal mismatch');
  return { status: 'PASSED', ref, referencesVerified: checks, uniqueGitBlobsRead: cache.size, historicalSourceCheckoutProofs: evidence,
    rawArtifacts: 'Byte-exact; no normalization or fallback for datasets, measurements, predictions or other evidence',
    officialFreezeFingerprint: fingerprint, officialEvaluationFingerprint: evaluationFingerprint };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(JSON.stringify(verifyPublication(process.argv[2] ?? 'INDEX'), null, 2));
}
