import type { Features } from "../ai02/types";
/** Both roles use the same whitelisted textual evidence. No references, money or IDs. */
export function semanticText(features: Features): string {
  const clean = (s: string) => s.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (typeof features.description !== "string" || !features.description.trim() || (features.counterparty !== null && typeof features.counterparty !== "string")) throw new Error("Invalid semantic text");
  const text = "query: " + clean(features.description) + (features.counterparty?.trim() ? " | " + clean(features.counterparty) : "");
  if (text.length > 2048 || text.includes("\0")) throw new Error("Semantic text exceeds research bound");
  return text;
}
export function normalized(vector: readonly number[]): number[] {
  if (!Array.isArray(vector) || vector.length !== 384 || vector.some(v => !Number.isFinite(v))) throw new Error("Invalid 384-dimensional embedding");
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm < 1e-12) throw new Error("Invalid embedding norm");
  return vector.map(v => v / norm);
}
export function cosine(a: readonly number[], b: readonly number[]): number {
  const x = normalized(a), y = normalized(b);
  return Math.max(-1, Math.min(1, x.reduce((sum,v,i) => sum + v*y[i],0)));
}
