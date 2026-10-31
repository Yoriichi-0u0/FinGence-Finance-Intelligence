import { readFileSync } from "node:fs";
import type { Truth } from "../../research/reconciliation/m2/types";
import type { Features, Input, InputRecord } from "../../research/reconciliation/ai02/types";
import { prepareDevelopment } from "../../research/reconciliation/ai02/adapter";
export const config = { date: { field: "canonicalDate" as const, maxDays: 2 }, threshold: .75, margin: .1 };
export function row(id: string, role: InputRecord["role"], overrides: Partial<Features> = {}): InputRecord {
  return { candidateId: id, role, features: { amount: "100.00", currency: "MYR", direction: "OUTFLOW", transactionDate: "2024-01-17", postingDate: "2024-01-18", canonicalDate: "2024-01-17", description: "Equipment repair", counterparty: "Example Supplier", reference: "INV-123", ...overrides } };
}
export const input = (...candidates: InputRecord[]): Input => ({ version: "ai01-m2/1.1.0", split: "train", candidates });
export function frozen(split: "train" | "development") {
  if (!["train", "development"].includes(split)) throw new Error("No held-out fixture loader");
  const read = (p: string) => JSON.parse(readFileSync(new URL("../../research/reconciliation/m2/fixtures/" + p, import.meta.url), "utf8"));
  return { input: prepareDevelopment(read(`inputs/${split}.json`)), truth: read(`annotations/${split}.json`) as Truth };
}
