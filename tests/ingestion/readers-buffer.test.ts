import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createDataset, inspectFile } from "../../lib/ingestion/index";

function paddedView(source: Uint8Array, kind: "Buffer" | "Uint8Array") {
  const padding = 32;
  const backing = kind === "Buffer"
    ? Buffer.allocUnsafe(source.length + padding * 2).fill(0x7f)
    : new Uint8Array(source.length + padding * 2).fill(0x7f);
  backing.set(source, padding);
  const input = backing.subarray(padding, padding + source.length);
  expect(input.byteOffset).toBeGreaterThan(0);
  expect(input.buffer.byteLength).toBeGreaterThan(input.byteLength);
  expect(Buffer.isBuffer(input)).toBe(kind === "Buffer");
  return { backing, input, before: Uint8Array.from(backing) };
}

describe("reader ownership of supplied byte views", () => {
  it.each(["Buffer", "Uint8Array"] as const)("hashes and parses only a CSV %s view", async kind => {
    const source = new TextEncoder().encode("Date,Amount,Reference\n2026-09-01,100.25,001\n2026-09-02,-5.50,0002\n");
    const { backing, input, before } = paddedView(source, kind);
    if (kind === "Buffer") {
      // This small allocation uses Node's pool, not just a larger owned buffer.
      expect(backing.buffer.byteLength).toBeGreaterThan(backing.byteLength);
    }
    const file = await inspectFile(input, { name: "view.csv" });
    expect(file.fingerprint).toBe(createHash("sha256").update(source).digest("hex"));
    expect(file.fingerprint).toBe(createHash("sha256").update(input).digest("hex"));
    expect(file.sizeBytes).toBe(source.length);
    const dataset = createDataset(file, 0);
    expect(dataset.columns).toEqual(["Date", "Amount", "Reference"]);
    expect(dataset.rows.map(row => row.cells)).toEqual([
      ["2026-09-01", "100.25", "001"], ["2026-09-02", "-5.50", "0002"],
    ]);
    expect(dataset.rows.map(row => row.rowNumber)).toEqual([2, 3]);
    expect(Uint8Array.from(backing)).toEqual(before);
  });

  it.each(["Buffer", "Uint8Array"] as const)("hashes and parses only an XLSX %s view", async kind => {
    const source = readFileSync(new URL("../../public/samples/ingestion/bank_statement.xlsx", import.meta.url));
    const { backing, input, before } = paddedView(source, kind);
    const file = await inspectFile(input, { name: "view.xlsx" });
    expect(file.fingerprint).toBe(createHash("sha256").update(source).digest("hex"));
    expect(file.fingerprint).toBe(createHash("sha256").update(input).digest("hex"));
    expect(file.sizeBytes).toBe(source.length);
    expect(file.sheets.map(sheet => sheet.name)).toEqual(["Transactions", "Read me"]);
    const dataset = createDataset(file, 0);
    expect(dataset.rows).toHaveLength(8);
    expect(dataset.rows[0].cells[0]).toEqual({ kind: "excel_date", value: "2026-09-01T00:00:00.000Z" });
    expect(dataset.rows[0].cells[4]).toEqual({ kind: "excel_number", value: "125.5" });
    expect(Uint8Array.from(backing)).toEqual(before);
  });
});
