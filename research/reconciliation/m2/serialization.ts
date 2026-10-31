import { createHash } from "node:crypto";
export const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export function canonicalJSON(value: unknown): string {
  const sort = (v: unknown): unknown => Array.isArray(v) ? v.map(sort) : v !== null && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, sort(x)])) : v;
  return JSON.stringify(sort(value), null, 2) + "\n";
}
export function validSeed(seed: unknown): seed is string {
  return typeof seed === "string" && seed.length > 0 && seed.length <= 128 && !/[\u0000-\u001f\u007f]/.test(seed);
}
