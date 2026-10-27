import { createHash } from 'node:crypto';

export const HASH_CONVENTION = Object.freeze({
  algorithm: 'SHA-256', artifacts: 'byte-exact', sources: 'crlf-to-lf-v1',
});

export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');

/** Remove only CR bytes immediately before LF. Preserve all other bytes. */
export function hashSource(bytes) {
  const source = Buffer.from(bytes);
  const normalized = Buffer.allocUnsafe(source.length);
  let length = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== 13 || source[i + 1] !== 10) normalized[length++] = source[i];
  }
  return hashBytes(normalized.subarray(0, length));
}

export function verifyManifest(manifest, { readArtifact, readSource }) {
  for (const [key, value] of Object.entries(HASH_CONVENTION)) {
    if (manifest.hashConvention?.[key] !== value) throw new Error(`Unsupported hash convention: ${key}`);
  }
  for (const [file, expected] of Object.entries(manifest.artifacts)) {
    if (hashBytes(readArtifact(file)) !== expected) throw new Error(`Artifact hash mismatch: ${file}`);
  }
  for (const [file, expected] of Object.entries(manifest.sources)) {
    if (hashSource(readSource(file)) !== expected) throw new Error(`Source hash mismatch: ${file}`);
  }
  return { artifacts: Object.keys(manifest.artifacts).length, sources: Object.keys(manifest.sources).length };
}
