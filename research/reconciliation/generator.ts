import { createHash } from "node:crypto";
import { CASES, defineGroundTruth } from "./ground-truth";
import { SOURCE_TEMPLATES } from "./schemas";
import type { Dataset, ResearchRecord, Role } from "./types";

export const GENERATOR_VERSION = "ai01-m1/1.0.1";
// Retain existing record identities and exact monetary fixtures across this review correction.
const SEED_NAMESPACE = "ai01-m1/1.0.0";
export const DEFAULT_SEED = "fingence-ai01-pilot-001";
const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/** Stable JSON key sorting; arrays retain intentional order. No timestamps or machine paths. */
export function serializeDataset(dataset: Dataset): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
    return value;
  };
  return JSON.stringify(canonical(dataset), null, 2) + "\n";
}
export const datasetFingerprint = (dataset: Dataset): string => digest(serializeDataset(dataset));

export function generateDataset(config: { seed?: string } = {}): Dataset {
  const seed = config.seed === undefined ? DEFAULT_SEED : config.seed;
  if (typeof seed !== "string" || seed.length === 0 || seed.length > 128 || /[\u0000-\u001f]/.test(seed)) throw new Error("Seed must be 1–128 printable characters");
  if (Object.keys(config).some(k => k !== "seed")) throw new Error("Unsupported pilot configuration");
  const records: ResearchRecord[] = [], ids: Record<string, string> = {};
  const counters: Record<Role, number> = { BANK: 0, LEDGER: 0 };
  const rowCounters = new Map<string, number>();
  const token = (key: string): string => digest(JSON.stringify([SEED_NAMESPACE, seed, key]));
  CASES.forEach((c, caseIndex) => {
    const offset = BigInt("0x" + token("money").slice(0, 8)) % 1000n;
    const ordinaryAmount = `${1000n + offset + BigInt(caseIndex) * 71n}.25`;
    for (const role of ["BANK", "LEDGER"] as const) {
      for (const key of role === "BANK" ? c.bankKeys : c.ledgerKeys) {
        const template = SOURCE_TEMPLATES[(role === "BANK" ? 0 : 2) + counters[role]++ % 2];
        const row = (rowCounters.get(template.id) ?? 0) + 1;
        rowCounters.set(template.id, row);
        const id = "syn-" + token("record:" + key).slice(0, 24); ids[key] = id;
        const direction = c.family === "A" && caseIndex % 2 === 0 ? "INFLOW" : "OUTFLOW";
        let amount = ordinaryAmount;
        if (caseIndex === 0) amount = "9007199254740993.123456789";
        if (c.family === "D" || c.family === "I") amount = "125.00";
        if (c.family === "E") amount = role === "BANK" ? "88.10" : "88.11";
        if (c.family === "J") amount = role === "LEDGER" ? "300.00" : key === "j0b" ? "125.00" : "175.00";
        const reference = ["D", "G", "H", "I"].includes(c.family) ? null : "SYN-" + token("reference:" + caseIndex).slice(0, 10).toUpperCase();
        let description = "Synthetic settlement " + token("merchant:" + caseIndex).slice(0, 6);
        if (c.family === "B") description = role === "BANK" ? "TRF ABC SDN BHD" : "ABC Supplier Invoice";
        if (c.family === "C") description = role === "BANK" ? "SYNT  UTIL  PMT" : "Synthetic utilities payment";
        if (c.family === "D") description = "Synthetic monthly subscription";
        if (c.family === "I") description = "Synthetic subscription settlement";
        const debitActive = template.monetaryBasis === "CASH_DEBIT_CREDIT" ? direction === "INFLOW" : direction === "OUTFLOW";
        const ledger = role === "LEDGER";
        const transactionDate = c.family === "D" ? "2026-02-17" : template.dateBasis === "POSTING_DATE" && row % 2 !== 0 ? null : "2026-02-17";
        const postingDate = c.family === "D" ? "2026-02-17" : template.dateBasis === "TRANSACTION_DATE" && row % 2 !== 0 ? null : "2026-02-18";
        records.push({ id, role, systemId: template.systemId, templateId: template.id,
          sourceRowId: `${template.id}:row-${row}`, sourceTransactionId: c.family === "D" || row % 5 === 0 ? null : "SYN-TX-" + token("source:" + key).slice(0, 12),
          provenance: { file: `synthetic-${template.id}.csv`, sheet: null, row, synthetic: true },
          amount, sourceAmount: ledger ? null : template.monetaryBasis === "SIGNED_CASH" && direction === "OUTFLOW" ? "-" + amount : amount,
          debit: ledger && debitActive ? amount : null, credit: ledger && !debitActive ? amount : null,
          currency: c.family === "F" && role === "LEDGER" ? "USD" : "MYR", monetaryBasis: template.monetaryBasis,
          direction, accountId: template.accountId, transactionDate, postingDate,
          canonicalDate: (template.dateBasis === "TRANSACTION_DATE" ? transactionDate : postingDate)!, canonicalDateBasis: template.dateBasis,
          description, counterparty: ["G", "H"].includes(c.family) ? null : "Synthetic Counterparty",
          reference: c.family === "C" && role === "LEDGER" ? reference!.toLowerCase().replace("-", " ") : reference });
      }
    }
  });
  // Seed-dependent opaque ordering prevents author case sequence becoming an accidental feature.
  records.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return { generatorVersion: GENERATOR_VERSION, config: { seed, pilot: "M1" },
    templates: structuredClone([...SOURCE_TEMPLATES]), records, groundTruth: defineGroundTruth(ids) };
}
