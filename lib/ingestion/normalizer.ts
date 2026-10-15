import type { DateOrder, NumberFormat, RawCell } from "./models";

export function rawText(value: RawCell | undefined): string {
  if (value == null) return "";
  return typeof value === "object" ? value.value : String(value);
}
export function normalizeText(value: RawCell | undefined): string | null {
  return rawText(value).trim() || null;
}
export function isMissing(value: RawCell | undefined): boolean {
  return normalizeText(value) === null;
}

/** XLSX stores numbers in a locale-independent format, sometimes scientific. */
function expandExcelNumber(value: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(value);
  if (!match) return value;
  const exponent = Number(match[4]);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 128) throw new Error("Numeric exponent exceeds the PoC limit.");
  const digits = match[2] + (match[3] ?? "");
  const position = match[2].length + exponent;
  const expanded = position <= 0
    ? "0." + "0".repeat(-position) + digits
    : position >= digits.length
      ? digits + "0".repeat(position - digits.length)
      : digits.slice(0, position) + "." + digits.slice(position);
  return match[1] + expanded;
}

export function normalizeDecimal(value: RawCell | undefined, format: NumberFormat): string {
  const excelNumber = typeof value === "object" && value?.kind === "excel_number";
  if (typeof value !== "string" && !excelNumber) throw new Error("A numeric value is required.");
  let text = typeof value === "string" ? value.trim() : expandExcelNumber(value.value);
  if (text.length > 128) throw new Error("Numeric value exceeds 128 characters.");
  if (/^\([^()]+\)$/.test(text)) text = "-" + text.slice(1, -1);
  const convention = excelNumber ? "plain" : format;
  const patterns: Record<NumberFormat, RegExp> = {
    plain: /^[+-]?\d+(?:\.\d+)?$/,
    dot_comma: /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/,
    comma_dot: /^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/,
  };
  if (!patterns[convention].test(text)) throw new Error("Unable to parse numeric value with the selected number convention.");
  if (convention === "dot_comma") text = text.replaceAll(",", "");
  if (convention === "comma_dot") text = text.replaceAll(".", "").replace(",", ".");
  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "");
  const parts = unsigned.split(".");
  const whole = parts[0].replace(/^0+(?=\d)/, "");
  const fraction = (parts[1] ?? "").replace(/0+$/, "");
  const result = whole + (fraction ? "." + fraction : "");
  return negative && result !== "0" ? "-" + result : result;
}

export function subtractDecimals(left: string, right: string): string {
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const scale = Math.max(leftParts[1]?.length ?? 0, rightParts[1]?.length ?? 0);
  function scaled(value: string): bigint {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    return BigInt((negative ? "-" : "") + whole + fraction.padEnd(scale, "0"));
  }
  const difference = scaled(left) - scaled(right);
  const digits = (difference < BigInt(0) ? -difference : difference).toString().padStart(scale + 1, "0");
  const result = scale ? digits.slice(0, -scale) + "." + digits.slice(-scale) : digits;
  const [whole, fraction = ""] = result.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return (difference < BigInt(0) ? "-" : "") + whole + (trimmed ? "." + trimmed : "");
}
export function absoluteDecimal(value: string): string {
  return normalizeDecimal(value.replace(/^-/, ""), "plain");
}

export function normalizeDate(value: RawCell | undefined, order: DateOrder): string {
  let text = normalizeText(value);
  if (typeof value === "object" && value?.kind === "excel_date") text = value.value.slice(0, 10);
  if (!text) throw new Error("A date is required.");
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  let year: number, month: number, day: number;
  if (match) {
    [, year, month, day] = match.map(Number);
  } else {
    if (order === "ISO") throw new Error("Use an ISO date or explicitly select DMY/MDY.");
    match = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(text);
    if (!match) throw new Error("Unable to parse date.");
    year = Number(match[3]);
    month = Number(match[order === "DMY" ? 2 : 1]);
    day = Number(match[order === "DMY" ? 1 : 2]);
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) throw new Error("Invalid calendar date.");
  return String(year).padStart(4, "0") + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

/** Known-offset RFC3339 subset; no locale guessing, rollover or precision loss. */
export function normalizeIngestionTimestamp(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error("Use an ISO timestamp with seconds and an explicit timezone.");
  normalizeDate(match[1], "ISO");
  const zone = match[5];
  if (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59
    || zone === "-00:00" || (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))) {
    throw new Error("Invalid time or unknown timezone offset.");
  }
  const normalized = new Date(value).toISOString();
  if (!/^\d{4}-/.test(normalized) || normalized.startsWith("0000-")) throw new Error("UTC instant exceeds supported years 0001–9999.");
  return normalized;
}
