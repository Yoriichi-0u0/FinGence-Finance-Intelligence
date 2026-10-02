import { describe, expect, it } from "vitest";
import { normalizeDate, normalizeDecimal, subtractDecimals, absoluteDecimal, normalizeText } from "../../lib/ingestion/normalizer";

describe("strict value normalization", () => {
  it("preserves identifiers and trims only surrounding whitespace", () => {
    expect(normalizeText(" 00120 ")).toBe("00120");
    expect(normalizeText(" NA ")).toBe("NA");
    expect(normalizeText("  ")).toBeNull();
    expect(normalizeText(null)).toBeNull();
  });
  it("does exact monetary arithmetic beyond the safe integer range", () => {
    expect(normalizeDecimal("9007199254740993.10", "plain")).toBe("9007199254740993.1");
    expect(subtractDecimals("9007199254740993.1", "0.09")).toBe("9007199254740993.01");
    expect(absoluteDecimal("-0.010")).toBe("0.01");
  });
  it("requires a selected separator convention and checks grouping", () => {
    expect(() => normalizeDecimal("1,250.00", "plain")).toThrow();
    expect(normalizeDecimal("1,250.00", "dot_comma")).toBe("1250");
    expect(normalizeDecimal("1.250,05", "comma_dot")).toBe("1250.05");
    expect(() => normalizeDecimal("12,50.00", "dot_comma")).toThrow();
    expect(() => normalizeDecimal("NaN", "plain")).toThrow();
    expect(() => normalizeDecimal("1e3", "plain")).toThrow();
    expect(normalizeDecimal("(12.50)", "plain")).toBe("-12.5");
  });
  it("validates calendars and never guesses date order", () => {
    expect(normalizeDate("2026-09-03", "ISO")).toBe("2026-09-03");
    expect(() => normalizeDate("03/09/2026", "ISO")).toThrow();
    expect(normalizeDate("03/09/2026", "DMY")).toBe("2026-09-03");
    expect(normalizeDate("03/09/2026", "MDY")).toBe("2026-03-09");
    expect(() => normalizeDate("2026-02-29", "ISO")).toThrow();
    expect(() => normalizeDate("31/31/2026", "DMY")).toThrow();
    expect(normalizeDate("2024-02-29", "ISO")).toBe("2024-02-29");
  });
  it("keeps Excel calendar dates independent of local timezone", () => {
    expect(normalizeDate({ kind: "excel_date", value: "2026-09-03T00:00:00.000Z" }, "ISO")).toBe("2026-09-03");
  });
});
