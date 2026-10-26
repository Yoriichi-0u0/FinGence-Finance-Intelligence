import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectFile } from "../../ingestion/readers";
import { rawText } from "../../ingestion/normalizer";
import { detectFormat } from "../extract";
import type { EvidenceItem } from "../contracts";
import { workerEvidenceSchema, type SemanticEvidence } from "./contracts";
import { headingRule } from "./registry";
const execute = promisify(execFile);
const blank = { page: null, sheet: null, row: null, column: null, address: null, box: null, width: null, height: null, coordinateSystem: null, table: null, header: false, confidence: null };
export async function extractSemanticEvidence(input: Uint8Array, filename: string): Promise<SemanticEvidence> {
  const bytes = Uint8Array.from(input); const format = detectFormat(bytes, filename); const start = performance.now();
  const sourceId = createHash("sha256").update(bytes).digest("hex"); let items: EvidenceItem[] = []; let warnings: string[] = []; let coverage: SemanticEvidence["coverage"] = "TABLE_ROWS";
  let extractor = "FinGence unchanged CSV/XLSX readers + 0.2 evidence adapter";
  if (format === "CSV" || format === "XLSX") {
    const file = await inspectFile(bytes, { name: filename });
    if (file.sheets.length > 4) throw new Error("Maximum four worksheets.");
    for (const sheet of file.sheets) {
      if (sheet.rows.length > 61 || sheet.rows.some(r => r.cells.length > 16)) throw new Error("Maximum 50 data rows, 10 header/preamble rows and 16 columns.");
      for (const row of sheet.rows) for (const [col, value] of row.cells.entries()) items.push({ ...blank, id: `${sourceId}:02:${sheet.index}:${row.rowNumber}:${col}`, value, text: rawText(value), sheet: sheet.name, row: row.rowNumber, table: `sheet:${sheet.index}`, column: String(col), address: `${String.fromCharCode(65 + col)}${row.rowNumber}`, method: format === "CSV" ? "csv-parser" : "xlsx-parser" });
    }
  } else {
    const python = process.env.FINGENCE_AI_PYTHON;
    if (!python) throw new Error("Configure the external local extraction interpreter.");
    const directory = await mkdtemp(join(tmpdir(), "fingence-02-"));
    try {
      const path = join(directory, format === "PDF" ? "source.pdf" : bytes[0] === 0x89 ? "source.png" : "source.jpg"); await writeFile(path, bytes, { mode: 0o600 });
      const output = await execute(python, [resolve("scripts/ai-extract-02.py"), path], { timeout: 120000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, OMP_NUM_THREADS: "2", OPENBLAS_NUM_THREADS: "2" } }).catch(() => { throw new Error("Bounded local document extraction failed."); });
      const data = workerEvidenceSchema.parse(JSON.parse(output.stdout));
      if (data.items.some(i => i.box && (!i.width || !i.height || i.box[0] < 0 || i.box[1] < 0 || i.box[2] > i.width || i.box[3] > i.height || i.box[0] > i.box[2] || i.box[1] > i.box[3]))) throw new Error("Invalid source coordinates.");
      items = data.items.map((i, n) => ({ ...i, id: `${sourceId}:02:region:${n}` })); warnings = data.warnings; coverage = data.coverage; extractor = data.extractor;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  const tables: SemanticEvidence["tables"] = [];
  for (const id of new Set(items.map(i => i.table).filter((x): x is string => x !== null))) {
    const table = items.filter(i => i.table === id); const rows = [...new Set(table.map(i => i.row).filter((r): r is number => r !== null))].sort((a, b) => a - b);
    const candidates = rows.slice(0, 10).filter(row => {
      const roles = table.filter(i => i.row === row).map(i => headingRule(i.text)?.role);
      return (roles.includes("transaction_date") || roles.includes("posting_date")) && roles.some(r => ["amount", "debit", "credit", "bank_in", "bank_out"].includes(r ?? "")) || roles.filter(r => r === "invoice_field").length >= 2;
    });
    if (candidates.length !== 1) { warnings.push("Incomplete/ambiguous financial header selection; preserve evidence for review."); coverage = "REGIONS_ONLY"; continue; }
    const headerRow = candidates[0]; const header = table.filter(i => i.row === headerRow);
    tables.push({ id, headerRow, headerIds: header.map(i => i.id) });
    const columns = new Map(header.map((i, n) => [i.column ?? String(n), i.text]));
    for (const i of table) {
      if (i.row! < headerRow) { i.table = null; i.header = false; }
      else { i.header = i.row === headerRow; i.column = columns.get(i.column ?? "") ?? i.column; }
    }
  }
  if (items.some(i => i.text.length > 2000) || items.length > 2000 || new Set(items.filter(i => i.table && !i.header && i.text.trim()).map(i => `${i.table}:${i.row}`)).size > 50) throw new Error("Experimental evidence limits exceeded.");
  if (!items.some(i => i.text.trim())) { warnings.push("Unreadable source."); coverage = "REGIONS_ONLY"; }
  return { version: "v2-evidence-0.2", sourceId, filename: filename.split(/[\\/]/).pop()!.slice(0, 160), format, bytes: bytes.length, items, tables, warnings, coverage, extractor, durationMs: Math.round(performance.now() - start) };
}
