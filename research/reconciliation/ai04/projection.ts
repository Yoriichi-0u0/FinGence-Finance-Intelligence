import type { SplitInput } from "../m2/types";
import type { VerificationInput } from "./types";
export const RECORD_KEYS = ["id","role","templateId","systemId","accountId","sourceRowId","sourceTransactionId","provenance","eligibility","amount","sourceAmount","debit","credit","currency","monetaryBasis","direction","transactionDate","postingDate","canonicalDate","canonicalDateBasis","counterparty","reference"];
export function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function keys(value: unknown, allowed: readonly string[]): boolean { return object(value) && Object.keys(value).length === allowed.length && Object.keys(value).every(k=>allowed.includes(k)); }
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const v of Object.values(value)) freeze(v); Object.freeze(value); }
  return value;
}
/** Source-only adapter. Does not import the AI01 validator (which also imports annotations). */
export function project(input: SplitInput): VerificationInput {
  if (!keys(input,["version","seed","split","period","templates","records"]) || input.version !== "ai01-m2/1.1.0" || !["train","development"].includes(input.split) || !Array.isArray(input.records)) throw new Error("Unsupported source envelope or forbidden fields/split");
  const records = input.records.map(r => {
    if (!keys(r,[...RECORD_KEYS,"description"])) throw new Error("Unexpected source field (annotations are forbidden)");
    const copy = structuredClone(r);
    const { description, ...evidence } = copy;
    void description;
    return evidence;
  });
  return freeze({version: input.version, split: input.split, records}) as VerificationInput;
}
