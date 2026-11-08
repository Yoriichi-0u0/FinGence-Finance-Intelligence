import Papa from "papaparse";
import readXlsxFile from "read-excel-file/universal";
import { IngestionError, type Dataset, type LoadedFile, type RawCell, type RawRow } from "./models";
import { rawText } from "./normalizer";
import { inspectWorkbookArchive, READER_LIMITS, type ReaderLimits } from "./workbook-guard";
export { READER_LIMITS } from "./workbook-guard";

export function sanitizeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "upload").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return base.length <= 160 ? base : base.slice(0, 145) + base.slice(-15);
}
export async function inspectFile(
  input: Uint8Array, metadata: { name: string; delimiter?: "," | ";" | "\t" },
  limits: ReaderLimits = READER_LIMITS,
): Promise<LoadedFile> {
  if (!input.length) throw new IngestionError("EMPTY_FILE", "The file is empty.");
  if (input.length > limits.fileBytes) throw new IngestionError("FILE_LIMIT", "The file exceeds the 10 MiB input limit.");
  const name = sanitizeFilename(metadata.name);
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "xlsx") throw new IngestionError("UNSUPPORTED_FORMAT", "Only CSV and XLSX files are supported.");
  // Own exactly the supplied view, including when input is a pooled Node Buffer.
  const bytes = Uint8Array.from(input);
  const fingerprint = Array.from(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes.buffer)))
    .map(value => value.toString(16).padStart(2, "0")).join("");
  if (extension === "csv") {
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new IngestionError("CSV_ENCODING", "CSV must use valid UTF-8 encoding."); }
    if (text.includes("\u0000") || /^\s*(%PDF-|PK\u0003\u0004)/.test(text)) throw new IngestionError("CSV_CONTENT", "File content does not appear to be text CSV.");
    const parsed = Papa.parse<string[]>(text, {
      header: false, dynamicTyping: false, skipEmptyLines: false,
      delimiter: metadata.delimiter ?? "", delimitersToGuess: [",", ";", "\t"],
      preview: limits.rows + 2,
    });
    const errors = parsed.errors.filter(error => error.code !== "UndetectableDelimiter");
    if (errors.length) throw new IngestionError("CSV_SYNTAX", "CSV has malformed quoting or unreadable record boundaries.");
    const data = parsed.data;
    // Papa emits a virtual final record after a terminal newline. Keep real blank rows.
    if (/[\r\n]$/.test(text) && data.at(-1)?.length === 1 && data.at(-1)?.[0] === "") data.pop();
    if (parsed.meta.truncated || data.length > limits.rows + 1) throw new IngestionError("ROW_LIMIT", "CSV exceeds the 10,000-data-row limit.");
    if (data.some(row => row.length > limits.columns)) throw new IngestionError("COLUMN_LIMIT", "CSV exceeds the 100-column limit.");
    return { name, type: "CSV", fingerprint, sizeBytes: bytes.length, delimiter: parsed.meta.delimiter, sheets: [
      { name: null, index: 0, rows: data.map((cells, i) => ({ rowNumber: i + 1, cells, issues: [] })) },
    ] };
  }
  try {
    inspectWorkbookArchive(bytes, limits);
    const sheets = await readXlsxFile(bytes.buffer, {
      trim: false,
      parseNumber: value => ({ kind: "excel_number" as const, value }),
    });
    return { name, type: "XLSX", fingerprint, sizeBytes: bytes.length, delimiter: null, sheets: sheets.map((sheet, index) => ({
      name: sheet.sheet, index, rows: sheet.data.map((cells, i): RawRow => ({
        rowNumber: i + 1, issues: [],
        cells: cells.map(toRawCell),
      })),
    })) };
  } catch (error) {
    if (error instanceof IngestionError) throw error;
    throw new IngestionError("WORKBOOK_CONTENT", "Unable to read this workbook. Check its content and export a values-only XLSX.");
  }
}

function toRawCell(cell: unknown): RawCell {
  if (cell instanceof Date) return { kind: "excel_date", value: cell.toISOString() };
  if (cell === null || typeof cell === "string" || typeof cell === "boolean") return cell;
  if (typeof cell === "object" && "kind" in cell && cell.kind === "excel_number" && "value" in cell && typeof cell.value === "string") {
    return { kind: "excel_number", value: cell.value };
  }
  throw new IngestionError("WORKBOOK_VALUE", "Workbook contains an unsupported cell value.");
}

export function createDataset(file: LoadedFile, sheetIndex: number, headerRow = 1): Dataset {
  const sheet = file.sheets.find(s => s.index === sheetIndex);
  if (!sheet || !Number.isInteger(headerRow) || headerRow < 1) throw new IngestionError("DATASET_SELECTION", "Choose an existing worksheet and header row.");
  const header = sheet.rows.find(row => row.rowNumber === headerRow);
  if (!header) throw new IngestionError("HEADER_MISSING", "The selected header row does not exist.");
  // Trailing empty XLSX cells are not columns. Interior empty headers are unsafe.
  const cells = [...header.cells];
  while (cells.length && !rawText(cells.at(-1)).trim()) cells.pop();
  const columns = cells.map(rawText);
  if (!columns.length || columns.some(column => !column.trim())) throw new IngestionError("HEADER_EMPTY", "Headers must be non-empty. Choose the correct header row.");
  const keys = columns.map(c => c.trim().toLowerCase());
  if (new Set(keys).size !== keys.length) throw new IngestionError("HEADER_DUPLICATE", "Duplicate column names are unsupported. Rename them before ingestion.");
  const rows = sheet.rows.filter(row => row.rowNumber > headerRow).map(row => {
    const rawCells = file.type === "XLSX" && row.cells.length >= columns.length && row.cells.slice(columns.length).every(cell => !rawText(cell).trim())
      ? row.cells.slice(0, columns.length) : [...row.cells];
    return { ...row, cells: rawCells, issues: rawCells.length === columns.length ? [...row.issues] : [...row.issues, {
      rule: "ROW_WIDTH", category: "technical" as const, severity: "REJECTED" as const,
      field: "record", sourceColumn: null, originalValue: null,
      message: "Record has " + rawCells.length + " cells; expected " + columns.length + ". Original cells are retained.",
    }] };
  });
  if (!rows.length) throw new IngestionError("EMPTY_DATASET", "The selected dataset has no data rows.");
  return { id: file.fingerprint + ":" + sheet.index, file, sheet, headerRow, columns, rows };
}
export function isDuplicateFile(file: LoadedFile, existing: readonly LoadedFile[]): boolean {
  return existing.some(previous => previous.fingerprint === file.fingerprint);
}
