import { createHash } from "node:crypto";
import type { SemanticEvidence } from "../increment-02/contracts";
import { terminologyRegistry } from "../increment-02/registry";
import { planSchema } from "./plan";
const heading = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Evaluation-only utilities; inference and verification never import labels or this module. */
export function scoreExtraction(bundle: SemanticEvidence | null, truth: { headers: string[]; rows: string[][] }) {
  const groups = new Map<string, Map<string, string>>();
  for (const i of bundle?.items ?? []) if (i.table !== null && !i.header && i.row !== null) {
    const key = `${i.table}:${i.row}`; if (!groups.has(key)) groups.set(key, new Map()); groups.get(key)!.set(heading(i.column ?? ""), i.text);
  }
  const remaining = [...groups.values()]; let exactFields = 0, exactRows = 0;
  for (const expected of truth.rows) {
    const n = remaining.findIndex(g => g.get(heading(truth.headers[0])) === expected[0]);
    if (n < 0) continue; const actual = remaining.splice(n, 1)[0];
    const count = expected.filter((v, c) => actual.get(heading(truth.headers[c])) === v).length; exactFields += count; if (count === expected.length) exactRows++;
  }
  return { exactFields, expectedFields: truth.rows.reduce((n, r) => n + r.length, 0), exactRows, expectedRows: truth.rows.length };
}
export function scoreAccepted(rows: { financial: object }[], expected: Record<string, unknown>[]) {
  const remaining = [...expected]; let exactAccepted = 0;
  for (const row of rows) {
    const n = remaining.findIndex(x => Object.entries(x).every(([k, v]) => (row.financial as Record<string, unknown>)[k] === v));
    if (n >= 0) { exactAccepted++; remaining.splice(n, 1); }
  }
  return { exactAccepted, falseAccepted: rows.length - exactAccepted, eligibleWithheld: remaining.length };
}
/** Score the proposed header rules even if conventions/context prevent materialization. */
export function scorePlanMappings(bundle: SemanticEvidence | null, proposal: unknown, truth: { headers: string[]; roles: string[] }) {
  const parsed = planSchema.safeParse(proposal);
  const headers = new Set(bundle?.tables.flatMap(t => t.headerIds) ?? []);
  let correctFields = 0;
  if (bundle && parsed.success) for (const [n, column] of truth.headers.entries()) {
    const sourceHeaders = bundle.items.filter(i => headers.has(i.id) && heading(i.text) === heading(column));
    if (sourceHeaders.length !== 1) continue;
    const id = sourceHeaders[0].id;
    const matches = parsed.data.fields.filter(f => (/^e(?:0|[1-9]\d*)$/.test(f.headerId) ? bundle.items[Number(f.headerId.slice(1))]?.id : f.headerId) === id);
    if (matches.length === 1 && terminologyRegistry.rules.find(r => r.id === matches[0].ruleId)?.role === truth.roles[n]) correctFields++;
  }
  return { correctFields, expectedFields: truth.headers.length };
}
export function pendingCases(manifest: Record<string, { sha256: string }>, reports: { file: string; sha256: string; mode: string; inference: unknown }[]) {
  if (reports.some(r => r.mode === "DISPATCHED_UNKNOWN")) throw new Error("UNKNOWN_DISPATCH_REQUIRES_INVESTIGATION");
  if (reports.some(r => manifest[r.file]?.sha256 !== r.sha256)) throw new Error("RESUME_SOURCE_MISMATCH");
  return Object.keys(manifest).filter(file => !reports.some(r => r.file === file && r.inference !== null));
}
export function resumeArgument(args: string[]): string | null {
  const index = args.indexOf("--resume"); if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--") || args.lastIndexOf("--resume") !== index) throw new Error("RESUME_PATH_REQUIRED");
  return value;
}

export function assertSourceDigest(bytes: Uint8Array, expected: string) {
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("EVALUATION_SOURCE_MISMATCH");
}

export function assertPromptRevision(actual: unknown, expected: string) {
  if (actual !== expected) throw new Error("RESUME_PROMPT_MISMATCH");
}
