import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyManifest } from './integrity.mjs';

const [folder, mode] = process.argv.slice(2);
if (!folder || (mode !== undefined && mode !== '--staged')) {
  throw new Error('Usage: node scripts/db01/verify.mjs <repository-relative-run-folder> [--staged]');
}
const manifestFile = join(folder, 'manifest.json').replaceAll('\\', '/');
const manifest = JSON.parse(mode === '--staged'
  ? execFileSync('git', ['show', `:${manifestFile}`]) : readFileSync(manifestFile));
let staged;
if (mode === '--staged') {
  const files = [...Object.keys(manifest.artifacts).map(file => join(folder, file).replaceAll('\\', '/')),
    ...Object.keys(manifest.sources)];
  if (files.some(file => /[\r\n]/.test(file))) throw new Error('Invalid manifest path');
  const output = execFileSync('git', ['cat-file', '--batch'], {
    input: files.map(file => `:${file}\n`).join(''), maxBuffer: 32 * 1024 * 1024,
  });
  staged = new Map();
  let offset = 0;
  for (const file of files) {
    const end = output.indexOf(10, offset);
    const header = output.subarray(offset, end).toString();
    const match = /^[0-9a-f]+ blob (\d+)$/.exec(header);
    if (!match) throw new Error(`Missing staged blob: ${file}`);
    const length = Number(match[1]);
    staged.set(file, output.subarray(end + 1, end + 1 + length));
    offset = end + 1 + length + 1;
  }
}
const read = file => mode === '--staged' ? staged.get(file.replaceAll('\\', '/')) : readFileSync(file);
console.log(JSON.stringify({ mode: mode || 'working-tree', ...verifyManifest(manifest, {
  readArtifact: file => read(join(folder, file)), readSource: read,
}) }));
