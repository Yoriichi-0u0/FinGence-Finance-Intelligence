import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/reconciliation/ai02-integrity-manifest.json'), 'utf8'));
if (manifest.algorithm !== 'SHA-256' || manifest.sourceConvention !== 'crlf-to-lf-v1' || manifest.artifactConvention !== 'byte-exact') throw new Error('Unsupported integrity convention');
let count = 0;
for (const kind of ['sources', 'artifacts']) for (const [file, expected] of Object.entries(manifest[kind])) {
  const resolved = path.resolve(root, file);
  if (!resolved.startsWith(root + path.sep)) throw new Error('Manifest path outside repository');
  const original = fs.readFileSync(resolved);
  const bytes = kind === 'sources' ? Buffer.from(original.toString('utf8').replace(/\r\n/g, '\n'), 'utf8') : original;
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('Integrity mismatch: ' + file);
  count++;
}
process.stdout.write(`Verified ${count} AI02 package source/reference/artifact hashes.\n`);
