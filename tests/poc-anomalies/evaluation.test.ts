import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Papa from 'papaparse';
import { parseSource, fromCents, toCents } from '../../lib/poc-anomalies/source';
import { detectAnomalies, DETECTOR_VERSION } from '../../lib/poc-anomalies/detector';

/**
 * Offline scoring of the rule baseline on the owner-unpacked synthetic pack (never committed).
 * Predictions are computed from the feature file first; the held-out label file is read only
 * afterwards, here, and never by application code. `POC_EVALUATION_WRITE=1` refreshes the artifact.
 */
const candidates = [process.env.FINGENCE_POC_DATASET_DIR, '../../datasets/poc-2026-03', '.local/datasets/poc-2026-03'].filter(Boolean) as string[];
const directory = candidates.find(d => existsSync(join(d, 'source_transactions_6000.csv')));
const artifactPath = 'docs/poc/anomaly-evaluation.json';

describe.skipIf(!directory)('PoC anomaly baseline offline evaluation (synthetic pack)', () => {
    const file = () => readFileSync(join(directory!, 'source_transactions_6000.csv'));
    it('reproduces the committed dataset-specific evaluation artifact', () => {
        const bytes = file(), predicted = new Set(detectAnomalies(parseSource(bytes).rows).map(c => c.row.rowId));
        const labels = Papa.parse<Record<string, string>>(readFileSync(join(directory!, 'source_labels_6000.csv'), 'utf8'), { header: true, skipEmptyLines: true }).data;
        expect(labels).toHaveLength(6000);
        const truth = new Map(labels.map(l => [l.SourceTransactionID, l]));
        let tp = 0, fp = 0, fn = 0, tn = 0;
        const byType: Record<string, { labeled: number; detected: number }> = {};
        for (const [rowId, label] of truth) {
            const actual = label.IsAnomaly === 'Yes', hit = predicted.has(rowId);
            if (actual) { const t = byType[label.AnomalyType] ??= { labeled: 0, detected: 0 }; t.labeled++; if (hit) t.detected++; }
            if (actual && hit) tp++; else if (!actual && hit) fp++; else if (actual) fn++; else tn++;
        }
        expect(tp + fp + fn + tn).toBe(6000);
        const percent = (n: number, d: number) => d ? `${(Math.round(n / d * 1000) / 10).toFixed(1)}%` : 'n/a';
        const artifact = {
            label: 'Synthetic PoC pack 2026-03, 6,000 rows, held-out labels', datasetVersion: 'FinGence-PoC-March2026-v1', featureFileSha256: createHash('sha256').update(bytes).digest('hex'),
            labelFileSha256: createHash('sha256').update(readFileSync(join(directory!, 'source_labels_6000.csv'))).digest('hex'), detectorVersion: DETECTOR_VERSION,
            rows: 6000, labeledAnomalies: tp + fn, truePositives: tp, falsePositives: fp, falseNegatives: fn, trueNegatives: tn, precision: percent(tp, tp + fp), recall: percent(tp, tp + fn),
            recallByLabeledType: Object.fromEntries(Object.entries(byType).sort().map(([k, v]) => [k, `${v.detected}/${v.labeled}`])),
            note: 'Dataset-specific offline measurement of transparent rules on constructed synthetic data. Not a live model metric and not evidence of performance on real statements.',
        };
        if (process.env.POC_EVALUATION_WRITE === '1') writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');
        expect(JSON.parse(readFileSync(artifactPath, 'utf8'))).toEqual(artifact);
    });
    it('derives the March BUS-001 demo figures from the feature file and the bank statement alike', () => {
        const march = parseSource(file()).rows.filter(r => r.businessId === 'BUS-001' && r.period === '2026-03');
        const bank = parseSource(readFileSync(join(directory!, 'demo_bank_statement_mar2026.csv'))).rows;
        const net = (rows: typeof march) => fromCents(rows.reduce((sum, r) => sum + toCents(r.signedAmount), 0n));
        expect([march.length, net(march)]).toEqual([175, '102950.56']);
        expect([bank.length, net(bank)]).toEqual([175, '102950.56']);
        expect(new Set(bank.map(r => r.sourceTransactionId))).toEqual(new Set(march.map(r => r.rowId)));
    });
    it('refuses every evaluator-only file as detector input', () => {
        for (const name of ['source_labels_6000.csv', 'demo_anomaly_ground_truth.csv', 'demo_reconciliation_ground_truth.csv', 'monthly_trends_36.csv'])
            expect(() => parseSource(readFileSync(join(directory!, name))), name).toThrow();
    });
});
