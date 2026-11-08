import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { inspectFile, createDataset, READER_LIMITS } from "../../lib/ingestion/readers";
import { approveMapping, overrideMapping, suggestMapping } from "../../lib/ingestion/mapper";
import { consolidate, ingestDataset } from "../../lib/ingestion/pipeline";
import { DEFAULT_OPTIONS, type MonetaryMode } from "../../lib/ingestion/models";
import expected from "../../public/samples/ingestion/expected.json";

function workbook(xml: string, extra: Record<string, Uint8Array> = {}) {
  return zipSync({
    "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    "_rels/.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    "xl/workbook.xml": strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Transactions" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(xml), ...extra,
  });
}
const sheet = (content: string) => '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + content + "</sheetData></worksheet>";
const inline = (address: string, text: string) => '<c r="' + address + '" t="inlineStr"><is><t>' + text + "</t></is></c>";

describe("XLSX evidence and defensive inspection", () => {
  it("reads the public bank fixture with worksheet choice and typed date/numeric evidence", async () => {
    const file = await inspectFile(readFileSync("public/samples/ingestion/bank_statement.xlsx"), { name: "bank.xlsx" });
    expect(file.sheets.map(s => s.name)).toEqual(["Transactions", "Read me"]);
    const data = createDataset(file, 0);
    expect(data.rows).toHaveLength(8);
    expect(data.rows[0].cells[0]).toMatchObject({ kind: "excel_date", value: "2026-09-01T00:00:00.000Z" });
    expect(data.rows[0].cells[4]).toEqual({ kind: "excel_number", value: "125.5" });
  });
  it("preserves exact XML numeric text and whitespace without floating-point conversion", async () => {
    const data = createDataset(await inspectFile(workbook(sheet(
      '<row r="1">' + inline("A1", "Date") + inline("B1", "Amount") + inline("C1", "Reference") + inline("D1", "Narration") + inline("E1", "Currency") + '</row><row r="2">'
      + inline("A2", "2026-09-01") + '<c r="B2"><v>9007199254740993.10</v></c>' + inline("C2", " 001 ") + inline("D2", " Text ") + inline("E2", "MYR") + "</row>"
    )), { name: "exact.xlsx" }), 0);
    const r = ingestDataset(data, approveMapping(suggestMapping(data)), DEFAULT_OPTIONS, { batchId: "exact", ingestedAt: "2026-09-28T00:00:00Z" });
    expect(r.normalized[0].source_amount).toBe("9007199254740993.1");
    expect(r.records[0].raw.cells[2]).toBe(" 001 ");
  });
  it("keeps original worksheet positions including gaps before and after the header", async () => {
    const file = await inspectFile(workbook(sheet('<row r="3">' + inline("A3", "Date") + inline("B3", "Amount") + '</row><row r="7">' + inline("A7", "2026-09-01") + '<c r="B7"><v>2</v></c></row>')), { name: "gaps.xlsx" });
    const d = createDataset(file, 0, 3);
    expect(d.rows.map(r => r.rowNumber)).toEqual([4, 5, 6, 7]);
    expect(d.rows[3].cells[1]).toEqual({ kind: "excel_number", value: "2" });
  });
  it.each([
    ['<row r="1"><c r="A1"><f>1+1</f><v>2</v></c></row>', /values-only/],
    ['<row r="1"><c r="A1" t="e"><v>#DIV\/0!</v></c></row>', /error cells/],
    ['<row r="1000000"><c r="A1000000"><v>1</v></c></row>', /limit/],
    ['<row r="1"><c r="XFD1"><v>1</v></c></row>', /limit/],
  ])("rejects unsafe/unsupported worksheet content", async (xml, message) => {
    await expect(inspectFile(workbook(sheet(xml)), { name: "unsafe.xlsx" })).rejects.toThrow(message);
  });
  it("rejects entity declarations, macros, and expansion beyond the limit", async () => {
    await expect(inspectFile(workbook('<!DOCTYPE worksheet [<!ENTITY a "x">]>' + sheet("")), { name: "a.xlsx" })).rejects.toThrow(/entity/);
    await expect(inspectFile(workbook(sheet(""), { "xl/vbaProject.bin": new Uint8Array([1]) }), { name: "a.xlsx" })).rejects.toThrow(/Macros/);
    await expect(inspectFile(workbook(sheet("")), { name: "a.xlsx" }, { ...READER_LIMITS, expandedBytes: 500 })).rejects.toThrow(/expanded/);
  });
  it("rejects external workbook parts, unsafe archive paths and an encryption flag", async () => {
    await expect(inspectFile(workbook(sheet(""), { "xl/externalLinks/externalLink1.xml": strToU8("<externalLink/>") }), { name: "external.xlsx" })).rejects.toThrow(/external workbook/);
    await expect(inspectFile(workbook(sheet(""), { "../outside.xml": strToU8("<x/>") }), { name: "path.xlsx" })).rejects.toThrow(/unsafe archive paths/);
    const encrypted = workbook(sheet(""));
    const view = new DataView(encrypted.buffer, encrypted.byteOffset, encrypted.byteLength);
    for (let i = 0; i < encrypted.length - 46; i++) {
      if (view.getUint32(i, true) === 0x02014b50) { view.setUint16(i + 8, view.getUint16(i + 8, true) | 1, true); break; }
    }
    await expect(inspectFile(encrypted, { name: "encrypted.xlsx" })).rejects.toThrow(/Encrypted/);
  });
});

describe("independent golden consultation fixtures", () => {
  it("matches all statuses, source rows, examples and quality statistics", async () => {
    const results = [];
    for (const fixture of expected.files) {
      const file = await inspectFile(readFileSync("public/samples/ingestion/" + fixture.file), { name: fixture.file });
      const data = createDataset(file, fixture.sheet_index);
      let mapping = suggestMapping(data);
      if (fixture.manual_mapping) mapping = overrideMapping(mapping, data.columns.indexOf("Details"), "reference");
      const result = ingestDataset(data, approveMapping(mapping), {
        ...DEFAULT_OPTIONS, sourceSystem: fixture.sourceSystem, monetaryMode: fixture.monetaryMode as MonetaryMode,
        dateBasis: fixture.dateBasis as "transaction_date" | "posting_date",
      }, { batchId: "golden", ingestedAt: "2026-09-28T00:00:00Z" });
      expect(result.summary).toMatchObject(fixture.expected);
      results.push(result);
    }
    const combined = consolidate(results);
    expect(combined.summary).toMatchObject(expected.consolidated);
    for (const field of ["successRate", "cleanValidityRate", "requiredCompleteness"] as const) {
      expect(combined.summary[field]?.toFixed(2) + "%").toBe(expected.rates_displayed[field]);
    }
    expect(combined.rejected.map(r => r.provenance.source_row_number)).toEqual(expected.quarantine_source_rows);
    expect(results[0].normalized[0]).toMatchObject(expected.canonical_examples.ledger_first_dates);
    expect(results[1].normalized[0]).toMatchObject(expected.canonical_examples.bank_first_dates);
    expect(results[0].normalized[0].derived_ledger_net).toBe(expected.canonical_examples.ledger_first_derived_net);
    expect(results[0].normalized[1].derived_ledger_net).toBe(expected.canonical_examples.ledger_second_derived_net);
    expect(results[0].normalized[0].account_code).toBe(expected.canonical_examples.ledger_account_code);
    expect(results[1].normalized[0].source_amount).toBe(expected.canonical_examples.bank_first_amount);
    expect(results[1].normalized.map(row => row.source_amount)).toEqual(expected.canonical_examples.bank_source_amounts);
    expect(results[1].normalized[0].entry_side).toBe(expected.canonical_examples.bank_first_entry_side);
    expect(results.reduce((n, r) => n + r.records.length, 0)).toBe(combined.summary.valid + combined.summary.warning + combined.summary.rejected);
  });
});
