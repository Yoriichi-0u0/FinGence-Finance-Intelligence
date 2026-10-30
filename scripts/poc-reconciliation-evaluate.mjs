// OFFLINE SCORING ONLY. This module is never imported by runtime matching, routes or UI.
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
await import('./ai-runtime-03.mjs');
const { normalizeCashSource } = await import('../lib/server/poc-reconciliation/normalize.ts');
const { reconcileCashSources } = await import('../lib/server/poc-reconciliation/match.ts');
const folder = resolve(process.argv[2] ?? '.local/datasets/poc-2026-03');
const start = performance.now();
const bank = normalizeCashSource(readFileSync(join(folder, 'demo_bank_statement_mar2026.csv')), 'bank', 'bank.csv');
const ledger = normalizeCashSource(readFileSync(join(folder, 'demo_general_ledger_mar2026.csv')), 'ledger', 'ledger.csv');
const observed = reconcileCashSources('offline-evaluation-only', bank, ledger);
const durationMs = performance.now() - start;
const reversed = reconcileCashSources('offline-evaluation-only', { ...bank, rows: [...bank.rows].reverse() }, { ...ledger, rows: [...ledger.rows].reverse() });
assert.deepEqual(reversed.results, observed.results);
// Freeze computed results before loading scoring labels. Labels never reach the implementation.
const truth = Papa.parse(readFileSync(join(folder, 'demo_reconciliation_ground_truth.csv'), 'utf8'), { header: true, skipEmptyLines: true }).data;
const key = row => row.bankRecordId ? 'B:' + row.bankRecordId : 'L:' + row.ledgerRecordIds.join('|');
const lookup = new Map(observed.results.map(r => [key(r), r]));
const failures = [];
for (const t of truth) {
    const ids = t.ExpectedLedgerEntryIDs.split(/\s*\|\s*/).filter(Boolean).sort();
    const k = t.BankTransactionID ? 'B:' + t.BankTransactionID : 'L:' + ids.join('|');
    const found = lookup.get(k);
    if (!found || found.status !== t.ExpectedReconciliationStatus || JSON.stringify(found.ledgerRecordIds) !== JSON.stringify(ids)) failures.push({ scenario: t.ScenarioID, status: found?.status ?? 'MISSING', expected: t.ExpectedReconciliationStatus });
}
console.log(JSON.stringify({ origin: 'DETERMINISTIC_RULES', genuineModelAccuracy: null, sourceHashes: { bank: bank.sha256, ledger: ledger.sha256 }, bankRecords: bank.rows.length, ledgerRecords: ledger.rows.length, outcomes: observed.results.length, counts: observed.counts, cashMovement: observed.cashMovement, evaluated: truth.length, correct: truth.length - failures.length, unexpectedOutcomes: observed.results.length - truth.length, failures, shuffledOrder: 'PASS', durationMs, limitations: ['Constructed synthetic benchmark, not generalization or ML accuracy.'] }, null, 2));
if (failures.length || observed.results.length !== truth.length) process.exitCode = 1;
