#!/usr/bin/env node
/**
 * After `next build`: proves the server processing job route can read PDFs and scans from its traced files alone, as a
 * hosted function would. Copies only the route's traced node_modules files into an empty temporary folder, then, from
 * there, reads a text PDF with pdf.js (its worker included), draws a page on pdf.js's Node canvas, and reads a scan by
 * OCR (tesseract.js worker, engine and English data). Exits non-zero when anything is missing.
 *
 *   pnpm build && node scripts/verify-job-trace.mjs
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const root = process.cwd(), base = join(root, '.next/server/app/api/processing/jobs');
const files = JSON.parse(readFileSync(join(base, 'route.js.nft.json'), 'utf8')).files;
const dest = mkdtempSync(join(tmpdir(), 'fingence-job-trace-'));
let copied = 0;
for (const rel of files) {
    const src = normalize(resolve(base, rel));
    if (!src.startsWith(join(root, 'node_modules'))) continue;
    const out = join(dest, relative(root, src));
    mkdirSync(dirname(out), { recursive: true });
    if (lstatSync(src).isSymbolicLink()) { if (!existsSync(out)) symlinkSync(readlinkSync(src), out); }
    else if (lstatSync(src).isFile()) copyFileSync(src, out);
    copied++;
}
writeFileSync(join(dest, 'package.json'), '{"type":"module"}');
const probe = `
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const req = createRequire(join(process.cwd(), 'package.json'));
const pnpm = join(process.cwd(), 'node_modules/.pnpm'), dir = p => readdirSync(pnpm).find(d => d.startsWith(p));
const lib = await import(join(pnpm, dir('pdfjs-dist@'), 'node_modules/pdfjs-dist/legacy/build/pdf.mjs'));
const doc = await lib.getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), disableFontFace: true }).promise;
const page = await doc.getPage(1), items = (await page.getTextContent()).items.length, view = page.getViewport({ scale: 1 });
const { canvas, context } = doc.canvasFactory.create(Math.ceil(view.width), Math.ceil(view.height));
await page.render({ canvasContext: context, canvas, viewport: view, intent: 'print' }).promise;
const png = canvas.toBuffer('image/png').length;
const { createWorker } = createRequire(join(pnpm, dir('tesseract.js@'), 'node_modules/tesseract.js/package.json'))('./src/index.js');
const langPath = join(dirname(req.resolve(['@tesseract.js-data', 'eng', 'package.json'].join('/'))), '4.0.0');
const worker = await createWorker('eng', 1, { langPath, gzip: true, cacheMethod: 'none' });
const words = (await worker.recognize(readFileSync(process.argv[3]))).data.text.split(/\\s+/).filter(Boolean).length;
await worker.terminate();
console.log(JSON.stringify({ items, png, words }));
`;
writeFileSync(join(dest, 'probe.mjs'), probe);
try {
    const out = JSON.parse(execFileSync(process.execPath, ['probe.mjs', join(root, 'public/demo/unfamiliar/bank-statement-march-2026.pdf'), join(root, 'public/demo/unfamiliar/general-ledger-cash-march-2026-scan.jpg')], { cwd: dest, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim().split('\n').at(-1));
    const ok = out.items > 0 && out.png > 1000 && out.words > 100;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${copied} traced files: PDF text items ${out.items}, page drawn ${out.png} bytes, OCR words ${out.words}`);
    process.exitCode = ok ? 0 : 1;
} catch (error) {
    console.log(`FAIL ${copied} traced files: ${String(error.message).slice(0, 300)}`);
    process.exitCode = 1;
} finally { rmSync(dest, { recursive: true, force: true }); }
