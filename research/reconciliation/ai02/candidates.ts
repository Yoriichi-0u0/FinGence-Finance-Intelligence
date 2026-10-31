import { equalDecimals, isDecimal } from "../decimal";
import type { Config, Features, Input, Pair } from "./types";
export const lex = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const featureKeys = ["amount", "currency", "direction", "transactionDate", "postingDate", "canonicalDate", "description", "counterparty", "reference"].sort();
const hasKeys = (v: object, names: string[]) => Object.keys(v).sort().join("|") === [...names].sort().join("|");
export function epochDay(s: unknown): number | null {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const time = Date.parse(s + "T00:00:00.000Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === s ? time / 86400000 : null;
}
export function validateInput(input: Input, config: Config): void {
  if (!input || !hasKeys(input, ["version", "split", "candidates"]) || input.version !== "ai01-m2/1.1.0" || !["train", "development"].includes(input.split) || !Array.isArray(input.candidates)) throw new Error("Unsupported development input/version/split");
  if (!config || !hasKeys(config, ["date", "threshold", "margin"]) || !config.date || !hasKeys(config.date, ["field", "maxDays"]) || !["canonicalDate", "transactionDate", "postingDate"].includes(config.date.field) || !Number.isInteger(config.date.maxDays) || config.date.maxDays < 0 || config.date.maxDays > 31 || ![config.threshold, config.margin].every(n => Number.isFinite(n) && n >= 0 && n <= 1)) throw new Error("Invalid experimental configuration");
  const ids = new Set<string>();
  for (const r of input.candidates) {
    if (!r || !hasKeys(r, ["candidateId", "role", "features"]) || typeof r.candidateId !== "string" || !r.candidateId || ids.has(r.candidateId) || !["BANK", "LEDGER"].includes(r.role)) throw new Error("Invalid or duplicate source identity");
    ids.add(r.candidateId);
    const f = r.features;
    if (!f || !hasKeys(f, featureKeys) || !isDecimal(f.amount) || f.amount.startsWith("-") || equalDecimals(f.amount, "0") || !["MYR", "USD"].includes(f.currency) || !["INFLOW", "OUTFLOW"].includes(f.direction)) throw new Error("Invalid financial features");
    if (epochDay(f.canonicalDate) === null || [f.transactionDate, f.postingDate].some(d => d !== null && epochDay(d) === null)) throw new Error("Invalid date");
    if (typeof f.description !== "string" || !f.description.trim() || [f.description, f.counterparty, f.reference].some(v => v !== null && (typeof v !== "string" || v.length > 512 || v.includes("\0")))) throw new Error("Invalid text features");
  }
}
export function blockedReason(b: Features, l: Features, config: Config): string | null {
  if (b.currency !== l.currency) return "CURRENCY";
  if (!equalDecimals(b.amount, l.amount)) return "AMOUNT";
  if (b.direction !== l.direction) return "DIRECTION";
  const bd = epochDay(b[config.date.field]), ld = epochDay(l[config.date.field]);
  if (bd === null || ld === null) return "MISSING_SELECTED_DATE";
  return Math.abs(bd - ld) > config.date.maxDays ? "DATE_WINDOW" : null;
}
export function generateCandidates(input: Input, config: Config) {
  validateInput(input, config);
  const banks = input.candidates.filter(r => r.role === "BANK").sort((a, b) => lex(a.candidateId, b.candidateId));
  const ledgers = input.candidates.filter(r => r.role === "LEDGER").sort((a, b) => lex(a.candidateId, b.candidateId));
  const pairs: Pair[] = [], blocked: Record<string, number> = {};
  for (const b of banks) for (const l of ledgers) {
    const why = blockedReason(b.features, l.features, config);
    if (why) blocked[why] = (blocked[why] ?? 0) + 1;
    else pairs.push({ bankId: b.candidateId, ledgerId: l.candidateId, dateGapDays: Math.abs(epochDay(b.features[config.date.field])! - epochDay(l.features[config.date.field])!) });
  }
  return { pairs, blocked, blockedCount: banks.length * ledgers.length - pairs.length };
}
