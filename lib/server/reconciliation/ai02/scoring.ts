/** Locale-independent lexical normalization, no translation dictionaries or benchmark lookups. */
export const normalizeText = (s: string | null) => (s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
export const normalizeReference = (s: string | null) => normalizeText(s).replace(/ /g, "");
function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  return 2 * [...a].filter(x => b.has(x)).length / (a.size + b.size);
}
/** Equal-weight token Dice and Unicode-code-point bigram Dice, bounded [0,1]. */
export function similarity(a: string | null, b: string | null): number {
  const x = normalizeText(a), y = normalizeText(b);
  if (!x || !y) return 0;
  const grams = (s: string) => { const c = [...s]; return new Set(c.length === 1 ? c : c.slice(1).map((v, i) => c[i] + v)); };
  return (dice(new Set(x.split(" ")), new Set(y.split(" "))) + dice(grams(x), grams(y))) / 2;
}
