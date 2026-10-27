import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { inspectFile, createDataset } from "../ingestion/readers";
import { rawText } from "../ingestion/normalizer";
import { EVIDENCE_VERSION, type EvidenceBundle, type EvidenceItem, type Format } from "./contracts";

const execute = promisify(execFile);
const finite = z.number().finite();
const workerSchema = z.object({
  items: z.array(z.object({ value: z.string().max(2000), text: z.string().max(2000), page: z.number().int().min(1).max(4).nullable(), sheet: z.string().nullable(),
    row: z.number().int().min(1).max(51).nullable(), column: z.string().max(200).nullable(), address: z.string().nullable(),
    box: z.tuple([finite, finite, finite, finite]).nullable(), width: finite.positive().nullable(), height: finite.positive().nullable(),
    coordinateSystem: z.enum(["TOP_LEFT_POINTS", "TOP_LEFT_PIXELS"]).nullable(), table: z.string().nullable(), header: z.boolean(), method: z.string(), confidence: finite.min(0).max(1).nullable(),
  })).max(2000), warnings: z.array(z.string().max(500)).max(100), coverage: z.enum(["TABLE_ROWS", "REGIONS_ONLY"]), extractor: z.string().max(200),
});
export function detectFormat(bytes: Uint8Array, filename: string): Format {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error("Input must contain between 1 byte and 10 MiB.");
  const head = Buffer.from(bytes.subarray(0, 8)); const extension = filename.split(".").pop()?.toLowerCase();
  const actual = head.subarray(0, 5).toString() === "%PDF-" ? "PDF"
    : head.toString("hex").startsWith("89504e470d0a1a0a") || head.toString("hex").startsWith("ffd8ff") ? "IMAGE"
    : head.subarray(0, 4).toString("hex") === "504b0304" ? "XLSX" : "CSV";
  const compatible = actual === "PDF" ? extension === "pdf" : actual === "XLSX" ? extension === "xlsx"
    : actual === "IMAGE" ? ["png", "jpg", "jpeg"].includes(extension ?? "") : extension === "csv";
  if (!compatible) throw new Error("File signature and supported filename type do not agree.");
  return actual;
}
const emptyLocation = { page: null, sheet: null, row: null, column: null, address: null, box: null, width: null, height: null, coordinateSystem: null, table: null, header: false, confidence: null };
function address(column: number, row: number): string {
  let letters = ""; for (let n = column + 1; n; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
  return letters + row;
}
export async function extractDocument(input: Uint8Array, filename: string, engine = "pdfplumber"): Promise<EvidenceBundle> {
  const bytes = Uint8Array.from(input); const format = detectFormat(bytes, filename); const started = performance.now();
  const sourceId = createHash("sha256").update(bytes).digest("hex");
  let items: EvidenceItem[] = []; let warnings: string[] = []; let coverage: EvidenceBundle["coverage"] = "TABLE_ROWS";
  let extractor = "FinGence 1.0 readers (unchanged)";
  if (format === "CSV" || format === "XLSX") {
    const loaded = await inspectFile(bytes, { name: filename });
    if (loaded.sheets.length > 4) throw new Error("Experimental limit: four worksheets.");
    let totalRows = 0;
    for (const sheet of loaded.sheets) {
      if (sheet.rows.every(r => r.cells.every(c => !rawText(c).trim()))) continue;
      const dataset = createDataset(loaded, sheet.index);
      totalRows += dataset.rows.length;
      if (totalRows > 50 || dataset.columns.length > 16) throw new Error("Experimental limit: 50 financial rows total and 16 columns.");
      const table = "sheet:" + sheet.index;
      for (const row of sheet.rows) for (const [i, value] of row.cells.entries()) {
        items.push({ ...emptyLocation, id: `${sourceId}:${sheet.index}:${row.rowNumber}:${i}`, value, text: rawText(value),
          sheet: sheet.name, row: row.rowNumber, column: dataset.columns[i] ?? null, address: format === "XLSX" ? address(i, row.rowNumber) : null,
          table, header: row.rowNumber === dataset.headerRow, method: format === "CSV" ? "csv-parser" : "xlsx-parser" });
      }
    }
  } else {
    if (!["pdfplumber", "docling"].includes(engine)) throw new Error("Unsupported extraction engine.");
    const directory = await mkdtemp(join(tmpdir(), "fingence-v2-"));
    try {
      const path = join(directory, format === "PDF" ? "input.pdf" : bytes[0] === 0x89 ? "input.png" : "input.jpg");
      await writeFile(path, bytes, { mode: 0o600 });
      // The local worker is an external runtime, never a bundled production asset.
      const python = process.env.FINGENCE_AI_PYTHON;
      if (!python) throw new Error("Configure the local extraction runtime using pnpm ai:demo or the evaluation CLI.");
      const result = await execute(python, [resolve("scripts/ai-extract.py"), path, "--engine", engine], {
        timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
        // Extraction receives no API, database or other application credentials.
        encoding: "utf8",
        env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, OMP_NUM_THREADS: "2", OPENBLAS_NUM_THREADS: "2" },
      }).catch(() => { throw new Error("Document extraction failed or exceeded its 120-second limit. Check the local extraction environment."); });
      const parsed = workerSchema.parse(JSON.parse(result.stdout));
      if (parsed.items.some(i => i.box && (!i.width || !i.height || i.box[0] < 0 || i.box[1] < 0 || i.box[2] > i.width || i.box[3] > i.height || i.box[2] < i.box[0] || i.box[3] < i.box[1]))) throw new Error("Invalid source region coordinates.");
      items = parsed.items.map((item, index) => ({ ...item, id: `${sourceId}:region:${index}` }));
      warnings = parsed.warnings; coverage = parsed.coverage; extractor = parsed.extractor;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  if (new Set(items.filter(i => !i.header && i.row !== null).map(i => `${i.table}:${i.row}`)).size > 50) throw new Error("Experimental limit: 50 financial rows total.");
  if (!items.length) warnings.push("No readable evidence was extracted. No financial values can be accepted.");
  return { version: EVIDENCE_VERSION, sourceId, filename: filename.split(/[\\/]/).pop()!.slice(0, 160), format, bytes: bytes.length,
    items, warnings, coverage, extractor, durationMs: Math.round(performance.now() - started) };
}
export async function extractPath(path: string, engine?: string) { return extractDocument(await readFile(path), path.split(/[\\/]/).pop()!, engine); }
