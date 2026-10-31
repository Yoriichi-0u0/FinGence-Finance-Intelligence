import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'docs/reconciliation/ai04-integrity-manifest.json'), 'utf8'));
if (manifest.algorithm !== 'SHA-256' || manifest.sourcesConvention !== 'crlf-to-lf-v1' || manifest.artifactsConvention !== 'byte-exact') throw new Error('Unsupported AI04 manifest convention');
let count = 0;
for (const kind of ['sources', 'artifacts', 'externalInputs']) {
  for (const [file, expected] of Object.entries(manifest[kind])) {
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(root + path.sep)) throw new Error('Manifest path outside repository');
    const raw = fs.readFileSync(resolved);
    const bytes = kind === 'sources' ? Buffer.from(raw.toString('utf8').replace(/\r\n/g, '\n')) : raw;
    if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error('AI04 integrity mismatch: ' + file);
    count++;
  }
}
console.log(`Verified ${count} AI04 source/reference/artifact/input hashes. External input records and truth are not included in the review ZIP.`);
