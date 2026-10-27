// Node 24 TS loader; no new runtime dependency, environment-file read or API calls.
import { registerHooks } from "node:module";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import ts from "typescript";
if (!process.versions.node.startsWith("24.")) throw new Error("Use Node.js 24.x.");
process.env.FINGENCE_AI_LIVE_APPROVED = "0";
process.env.FINGENCE_AI_PYTHON ??= resolve(".venv-ai/bin/python");
registerHooks({
  resolve(specifier, context, next) { if (specifier.startsWith(".") && context.parentURL) { const candidate = new URL(`${specifier}.ts`, context.parentURL); if (existsSync(candidate)) return next(candidate.href, context); } return next(specifier, context); },
  load(url, context, next) { if (url.endsWith(".ts")) return { format: "module", shortCircuit: true, source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText }; return next(url, context); },
});
const { runRecordedReplay } = await import("../lib/server/ai-ingestion/increment-02/replay.ts");
const { replayCases } = await import("../lib/server/ai-ingestion/increment-02/cases.ts");
const normalizeHeading = text => text.toLowerCase().replace(/[^a-z0-9]/g, "");
const folder = ".ai-local/increment-02"; mkdirSync(folder, { recursive: true });
const [command = "evaluate", caseId = "bank-narrative.csv", variant = "recorded"] = process.argv.slice(2);
if (command === "replay") {
  if (!["recorded", "swap", "omit", "reuse"].includes(variant)) throw new Error("Unknown recorded variant.");
  console.log(JSON.stringify(await runRecordedReplay(caseId, variant), null, 2));
} else if (command === "evaluate") {
  // Labels are loaded ONLY by this evaluator, never the extraction/provider/verifier.
  const truth = JSON.parse(readFileSync("tests/fixtures/ai-ingestion-02/ground-truth.json", "utf8")).families;
  const fieldTruth = JSON.parse(readFileSync("tests/fixtures/ai-ingestion-02/field-truth.json", "utf8"));
  const rows = []; const failures = [];
  for (const test of replayCases) {
    const result = await runRecordedReplay(test.id); writeFileSync(`${folder}/${test.id}.json`, JSON.stringify(result, null, 2));
    const label = truth[test.family]; const f = fieldTruth[test.family]; const actual = result.verification; const evidence = result.evidence;
    const groups = new Map();
    for (const item of evidence?.items ?? []) if (item.table !== null && !item.header && item.row !== null) { const key = `${item.table}:${item.row}`; if (!groups.has(key)) groups.set(key, new Map()); groups.get(key).set(normalizeHeading(item.column ?? ""), item.text); }
    const remaining = [...groups.values()]; let exactSourceFields = 0; let exactSourceRows = 0;
    for (const expected of f.rows) {
      const row = remaining.find(g => g.get(normalizeHeading(f.headers[0])) === expected[0]);
      if (row) { remaining.splice(remaining.indexOf(row), 1); const correct = expected.filter((value, n) => row.get(normalizeHeading(f.headers[n])) === value).length; exactSourceFields += correct; if (correct === expected.length) exactSourceRows++; }
    }
    let correctMappingFields = 0;
    for (const [index, header] of f.headers.entries()) if (result.blueprint?.fields.some(x => normalizeHeading(x.column) === normalizeHeading(header) && x.role === f.roles[index])) correctMappingFields++;
    let correctAccepted = 0; const matched = new Set();
    for (const record of actual?.accepted ?? []) {
      const value = record.financial; const n = label.ids?.indexOf(value.source_transaction_id) ?? -1;
      if (n < 0 || matched.has(n) || !label.accepted) continue;
      const pairs = [["amounts", "source_amount"], ["dates", "transaction_date"], ["postings", "posting_date"], ["currencies", "currency"], ["debits", "debit"], ["credits", "credit"], ["directions", "entry_side"], ["accountCodes", "account_code"]];
      if (pairs.every(([expected, key]) => !label[expected] || label[expected][n] === value[key])) { correctAccepted++; matched.add(n); }
    }
    const accepted = actual?.accepted.length ?? 0;
    const entry = { file: test.file, family: test.family, mode: "RECORDED_TEST", liveInference: "NOT_EXECUTED", format: evidence?.format ?? "UNREADABLE", runtimeMs: result.runtimeMs,
      extraction: { exactFields: exactSourceFields, expectedFields: f.rows.reduce((s, r) => s + r.length, 0), exactRows: exactSourceRows, expectedRows: f.rows.length, coverage: evidence?.coverage ?? "EXTRACTION_FAILED" },
      proposal: { correctFields: correctMappingFields, expectedFields: f.headers.length }, accepted, rejected: actual?.rejected.length ?? 0, unresolved: actual?.unresolved.length ?? 0,
      expectedAccepted: label.accepted, expectedRejected: label.rejected ?? 0, expectedUnresolved: label.unresolved ?? null, correctlyRejected: Math.min(label.rejected ?? 0, actual?.rejected.length ?? 0), correctlyUnresolved: label.unresolved === undefined ? null : Math.min(label.unresolved, actual?.unresolved.length ?? 0), documentUnresolved: actual ? !actual.coverage.rowCountEstablished : false, correctAccepted, falseAcceptance: accepted - correctAccepted, falseRejection: Math.max(0, label.accepted - correctAccepted),
      rowCoverage: actual ? { established: actual.coverage.rowCountEstablished, observed: actual.coverage.sourceRows, accounted: accepted + actual.rejected.length + actual.unresolved.length } : null,
      fieldCoverage: actual ? { populated: actual.coverage.populatedCells, accounted: actual.coverage.accountedCells } : null,
      failure: result.error, expectedFailure: label.expected === "EXTRACTION_FAILURE" };
    rows.push(entry); if (entry.falseAcceptance || entry.falseRejection || entry.failure && !entry.expectedFailure) failures.push(test.file);
    console.log(JSON.stringify(entry));
  }
  const reusePairs = [["bank-narrative.csv", "precision.csv"], ["ledger-dmy.csv", "ledger-dmy.xlsx"], ["bank-narrative.csv", "unknown-fee.csv"], ["bank-narrative.csv", "bank-movements.csv"]];
  const reuse = [];
  for (const [template, target] of reusePairs) { const r = await runRecordedReplay(target, "reuse", template); reuse.push({ template, target, decision: r.reuse?.decision ?? "FAILED", accepted: r.verification?.accepted.length ?? 0, error: r.error }); }
  const sums = key => rows.reduce((sum, row) => sum + row[key], 0);
  const report = { date: "2026-10-20", mode: "RECORDED_TEST", liveInference: "NOT_EXECUTED", llmProposalAccuracy: "NOT_MEASURED", liveRequests: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0,
    note: "26 controlled source documents; several are representations of the same source cases. These are hand-authored test interpretations, not model-generated rules. Field accuracy uses one-to-one row matching and exact source strings, including empty cells. False rejection includes unresolved but eligible truth records. Unsupported cases are not incorrect rejections. Rejected/unresolved count agreement is not per-record identity proof; source-bound unit tests separately check identities.",
    totals: { files: rows.length, accepted: sums("accepted"), rejected: sums("rejected"), unresolved: sums("unresolved"), expectedAccepted: sums("expectedAccepted"), correctAccepted: sums("correctAccepted"), falseAcceptance: sums("falseAcceptance"), falseRejection: sums("falseRejection"),
      exactExtractionFields: rows.reduce((s, r) => s + r.extraction.exactFields, 0), expectedExtractionFields: rows.reduce((s, r) => s + r.extraction.expectedFields, 0), correctProposalFields: rows.reduce((s, r) => s + r.proposal.correctFields, 0), expectedProposalFields: rows.reduce((s, r) => s + r.proposal.expectedFields, 0) },
    rows, reuse, unexpectedFailures: failures };
  mkdirSync("docs/ai-ingestion/increment-02/evidence", { recursive: true });
  writeFileSync("docs/ai-ingestion/increment-02/evidence/evaluation.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ totals: report.totals, reuse, unexpectedFailures: failures }));
  if (failures.length) process.exitCode = 1;
} else throw new Error("Use evaluate or replay <registered filename> [recorded|swap|omit|reuse].");
