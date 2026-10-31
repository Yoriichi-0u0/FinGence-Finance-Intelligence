/** Exact, bounded decimal arithmetic for the isolated research module. No Number money conversion. */
export function isDecimal(value: unknown): value is string {
  return typeof value === "string" && value.length <= 128 && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && !/^-0(?:\.0+)?$/.test(value);
}
function parts(value: string): { units: bigint; scale: number } {
  if (!isDecimal(value)) throw new Error("Invalid exact decimal");
  const [whole, fraction = ""] = value.split(".");
  return { units: BigInt(whole + fraction), scale: fraction.length };
}
export function sumDecimals(values: readonly string[]): string {
  const parsed = values.map(parts);
  const scale = Math.max(0, ...parsed.map(p => p.scale));
  const units = parsed.reduce((sum, p) => sum + p.units * 10n ** BigInt(scale - p.scale), 0n);
  const sign = units < 0n ? "-" : "";
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, "0");
  if (!scale) return sign + digits;
  const fraction = digits.slice(-scale).replace(/0+$/, "");
  return sign + digits.slice(0, -scale) + (fraction ? "." + fraction : "");
}
export function equalDecimals(a: string, b: string): boolean {
  return sumDecimals([a]) === sumDecimals([b]);
}
