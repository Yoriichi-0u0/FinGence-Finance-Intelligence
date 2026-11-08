import { describe, expect, it } from "vitest";
import { inspectFile, createDataset, isDuplicateFile, READER_LIMITS } from "../../lib/ingestion/readers";
import { profileDataset } from "../../lib/ingestion/profiler";
import { suggestMapping, overrideMapping, approveMapping, mappingErrors } from "../../lib/ingestion/mapper";
import { DEFAULT_OPTIONS } from "../../lib/ingestion/models";
const bytes = (text: string) => new TextEncoder().encode(text);

describe("CSV inspection and raw evidence", () => {
  it("handles BOM, quotes, multiline values, blank rows, and record coordinates", async () => {
    const file = await inspectFile(bytes('\uFEFFDate,Amount,Details\n2026-09-01,2," first\nsecond "\n,,\n2026-09-02,-3,last\n'), { name: "../ledger.csv" });
    const data = createDataset(file, 0, 1);
    expect(file.name).toBe("ledger.csv");
    expect(data.rows.map(r => r.rowNumber)).toEqual([2, 3, 4]);
    expect(data.rows[0].cells[2]).toBe(" first\nsecond ");
    expect(data.rows).toHaveLength(3);
    expect(file.sizeBytes).toBe(bytes('\uFEFFDate,Amount,Details\n2026-09-01,2," first\nsecond "\n,,\n2026-09-02,-3,last\n').length);
    expect(file).not.toHaveProperty("bytes");
  });
  it("profiles without coercion and counts extra duplicate occurrences", async () => {
    const file = await inspectFile(bytes("Date,Amount,Reference\n2026-09-01,2,001\n2026-09-01,2,001\n2026-09-02,,\n"), { name: "p.csv" });
    const data = createDataset(file, 0);
    const profile = profileDataset(data);
    expect(profile.rowCount).toBe(3);
    expect(profile.duplicateRowCount).toBe(1);
    expect(profile.duplicateRowNumbers).toEqual([3]);
    expect(profile.columns[1].missing).toBe(1);
    expect(data.rows[0].cells[2]).toBe("001");
  });
  it("warns on identical bytes independently of filename", async () => {
    const a = await inspectFile(bytes("Date,Amount\n2026-09-01,1"), { name: "a.csv" });
    const b = await inspectFile(bytes("Date,Amount\n2026-09-01,1"), { name: "b.csv" });
    expect(isDuplicateFile(b, [a])).toBe(true);
    expect(a.fingerprint).toHaveLength(64);
  });
  it.each([
    ["secret.exe", "Date,Amount"],
    ["fake.xlsx", "Date,Amount"],
    ["binary.csv", "\u0000\u0001"],
    ["empty.csv", ""],
    ["bad.csv", 'Date,Amount\n"unterminated,1'],
  ])("fails safely for %s", async (name, text) => {
    await expect(inspectFile(bytes(text), { name })).rejects.toThrow();
  });
  it("rejects invalid UTF-8 instead of replacing source characters", async () => {
    await expect(inspectFile(new Uint8Array([0xff, 0xfe]), { name: "a.csv" })).rejects.toThrow();
  });
  it("requires unambiguous headers and preserves malformed-width rows", async () => {
    const duplicate = await inspectFile(bytes("Date, Date \n1,2"), { name: "a.csv" });
    expect(() => createDataset(duplicate, 0)).toThrow();
    const width = createDataset(await inspectFile(bytes("Date,Amount\n2026-09-01,1,extra"), { name: "b.csv" }), 0);
    expect(width.rows[0].cells).toHaveLength(3);
    expect(width.rows[0].issues[0].rule).toBe("ROW_WIDTH");
  });
  it("supports explicit separators and enforces reader bounds without dropping rows", async () => {
    const csv = "Date;Amount\n2026-09-01;1\n2026-09-02;2\n";
    const limits = { ...READER_LIMITS, rows: 2, columns: 2 };
    const file = await inspectFile(bytes(csv), { name: "a.csv", delimiter: ";" }, limits);
    expect(file.delimiter).toBe(";");
    expect(createDataset(file, 0).rows).toHaveLength(2);
    await expect(inspectFile(bytes(csv + "2026-09-03;3\n"), { name: "a.csv" }, limits)).rejects.toThrow(/row/);
    await expect(inspectFile(bytes("A,B,C\n1,2,3"), { name: "a.csv" }, limits)).rejects.toThrow(/column/);
    await expect(inspectFile(bytes(csv), { name: "a.csv" }, { ...limits, fileBytes: 4 })).rejects.toThrow(/input limit/);
  });
});

describe("deterministic mapping and approval", () => {
  const dataset = async () => createDataset(await inspectFile(bytes("transaction_date,Txn Date,Transaction Details,mystery\n2026-09-01,2026-09-01,A,X"), { name: "map.csv" }), 0);
  it("distinguishes exact, alias, normalized, and unknown columns", async () => {
    const d = await dataset();
    const mapping = suggestMapping(d);
    expect(mapping[0]).toMatchObject({ target: "transaction_date", method: "exact_match", confidence: 1 });
    expect(mapping[1]).toMatchObject({ target: "transaction_date", method: "alias_match", confidence: 0.95 });
    expect(mapping[2].target).toBe("description");
    expect(mapping[3]).toMatchObject({ target: null, method: "unmapped", confidence: null });
    d.columns[0] = "TRANSACTION-DATE";
    expect(suggestMapping(d)[0].method).toBe("normalized_match");
  });
  it("requires confirmation and rejects target collisions", async () => {
    const d = await dataset();
    expect(mappingErrors(d, suggestMapping(d), DEFAULT_OPTIONS)).toContain("Review and approve every column mapping.");
    expect(mappingErrors(d, approveMapping(suggestMapping(d)), DEFAULT_OPTIONS).some(m => m.includes("assigned more than once"))).toBe(true);
  });
  it("retains manual provenance and uses a corrected target", async () => {
    const mapping = overrideMapping(suggestMapping(await dataset()), 2, "reference");
    expect(mapping[2]).toMatchObject({ target: "reference", method: "manual", confidence: null, userConfirmed: false });
    expect(approveMapping(mapping)[2].userConfirmed).toBe(true);
  });
});
