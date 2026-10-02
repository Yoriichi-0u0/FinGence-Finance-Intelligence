import { Unzip, UnzipInflate } from "fflate";
import { IngestionError } from "./models";

export interface ReaderLimits { fileBytes: number; expandedBytes: number; entries: number; rows: number; columns: number }
export const READER_LIMITS: ReaderLimits = {
  fileBytes: 10 * 1024 * 1024, expandedBytes: 50 * 1024 * 1024,
  entries: 1000, rows: 10000, columns: 100,
};
const fail = (message: string): never => { throw new IngestionError("UNSAFE_WORKBOOK", message); };

/** Check declared sizes before inflation, then count actual streamed output. */
export function inspectWorkbookArchive(bytes: Uint8Array, limits: ReaderLimits): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50) fail("XLSX content is not a supported ZIP workbook.");
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { end = i; break; }
  }
  if (end < 0) fail("Workbook ZIP directory is missing or corrupt.");
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) fail("Multi-volume workbooks are unsupported.");
  const count = view.getUint16(end + 10, true);
  if (!count || count > limits.entries || count !== view.getUint16(end + 8, true)) fail("Workbook exceeds the archive-entry limit.");
  const directorySize = view.getUint32(end + 12, true);
  let position = view.getUint32(end + 16, true);
  const directoryEnd = position + directorySize;
  if (directoryEnd !== end) fail("Workbook ZIP directory is invalid (ZIP64 is unsupported).");
  const entries = new Map<string, number>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (position + 46 > directoryEnd || view.getUint32(position, true) !== 0x02014b50) fail("Workbook ZIP entry is corrupt.");
    if (view.getUint16(position + 8, true) & 0x41) fail("Encrypted workbooks are unsupported.");
    const method = view.getUint16(position + 10, true);
    if (method !== 0 && method !== 8) fail("Unsupported workbook compression.");
    const size = view.getUint32(position + 24, true);
    const nameLength = view.getUint16(position + 28, true);
    const length = 46 + nameLength + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
    if (position + length > directoryEnd) fail("Workbook ZIP entry is truncated.");
    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength));
    if (entries.has(name) || /(^\/|\\|(^|\/)\.\.(\/|$))/.test(name)) fail("Workbook contains duplicate or unsafe archive paths.");
    if (/vbaProject|xl\/externalLinks\//i.test(name)) fail("Macros and external workbook links are unsupported.");
    declaredTotal += size;
    if (declaredTotal > limits.expandedBytes) fail("Workbook exceeds the expanded-content limit.");
    entries.set(name, size);
    position += length;
  }
  if (position !== directoryEnd || !entries.has("[Content_Types].xml") || !entries.has("xl/workbook.xml")) fail("Required XLSX workbook parts are missing.");
  let actualTotal = 0;
  let guardFailure: IngestionError | null = null;
  const completed = new Set<string>();
  const unzip = new Unzip(file => {
    const expected = entries.get(file.name) ?? fail("Workbook archive entries do not match its directory.");
    if (completed.has(file.name)) fail("Workbook archive entries do not match its directory.");
    const xml = /\.xml$|\.rels$/i.test(file.name);
    const chunks: Uint8Array[] = [];
    let actualSize = 0;
    file.ondata = (error, chunk, final) => {
      if (guardFailure) return;
      // fflate catches exceptions thrown from ondata and reports them as
      // decompression errors. Keep policy failures outside that callback.
      try {
      if (error) fail("Unable to decompress workbook content.");
      actualSize += chunk.length;
      actualTotal += chunk.length;
      if (actualTotal > limits.expandedBytes || actualSize > expected) fail("Workbook exceeds the expanded-content limit.");
      if (xml) chunks.push(chunk);
      if (final) {
        if (actualSize !== expected) fail("Workbook entry size does not match its directory.");
        completed.add(file.name);
        if (xml) {
          const content = new Uint8Array(actualSize);
          let offset = 0;
          for (const part of chunks) { content.set(part, offset); offset += part.length; }
          inspectXML(decoder.decode(content), file.name, limits);
        }
      }
      } catch (error) {
        guardFailure = error instanceof IngestionError ? error : new IngestionError("UNSAFE_WORKBOOK", "Workbook XML content is unreadable.");
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 4096) {
    unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
    if (guardFailure) throw guardFailure;
  }
  if (completed.size !== entries.size) fail("Workbook ZIP content is incomplete.");
}

function inspectXML(xml: string, name: string, limits: ReaderLimits): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("XML document types and entity definitions are unsupported.");
  if (name === "[Content_Types].xml" && /macroEnabled|vbaProject/i.test(xml)) fail("Macro-enabled workbooks are unsupported.");
  if (!/^xl\/worksheets\/.*\.xml$/.test(name)) return;
  if (/<(?:[A-Za-z_][\w.-]*:)?f(?:\s|\/?>)/.test(xml)) fail("Formula cells are unsupported. Export a values-only workbook.");
  if (/<(?:[A-Za-z_][\w.-]*:)?c\b[^>]*\bt\s*=\s*["']e["']/.test(xml)) fail("Workbook error cells are unsupported. Correct errors before ingestion.");
  for (const match of xml.matchAll(/\b(?:r|ref)\s*=\s*["']([^"']+)["']/g)) {
    if (/^\d+$/.test(match[1]) && Number(match[1]) > limits.rows + 1) fail("Workbook exceeds the row-position limit.");
    for (const coordinate of match[1].matchAll(/([A-Z]+)(\d+)/g)) {
      let column = 0;
      for (const letter of coordinate[1]) column = column * 26 + letter.charCodeAt(0) - 64;
      if (column > limits.columns || Number(coordinate[2]) > limits.rows + 1) fail("Workbook exceeds the row/column-position limits.");
    }
  }
}
