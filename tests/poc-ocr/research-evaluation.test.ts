import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anchorOcrDocument } from '../../lib/poc-ocr/anchor';
import { verifyOcrStatement } from '../../lib/poc-ocr/verify';
import type { AnchorSet, OcrProposal } from '../../lib/poc-ocr/contracts';

// Local research harness, skipped unless POC_OCR_INPUTS points at an ignored .local/research input directory.
// Ground truth is read only after verification has produced its decision, to score that decision.
const inputs = process.env.POC_OCR_INPUTS, truthPath = process.env.POC_OCR_TRUTH, outPath = process.env.POC_OCR_OUT;
const enabled = !!inputs && !!truthPath && !!outPath && existsSync(inputs);

type TruthRow = Record<string, string>;
type Truth = { rows: TruthRow[]; expectation: string; financialTruth: { reference: string; isoDate: string; direction: string; amount: string }[] };
const plain = (s: string) => (s ? s.replaceAll(',', '') : '');

describe.skipIf(!enabled)('Xiaomi-OCR-0 research evaluation (local only)', () => {
    it('anchors, verifies and scores every recorded proposal', () => {
        const json = <T>(p: string) => JSON.parse(readFileSync(p, 'utf8')) as T;
        const truth = json<{ documents: Record<string, Truth> }>(truthPath!).documents;
        const results: Record<string, unknown>[] = [];
        for (const file of readdirSync(inputs!).filter(f => f.endsWith('.proposal.json')).sort()) {
            const [doc, variant] = file.includes('.docling-self.') ? [file.split('.docling-self.')[0], 'docling-self'] : [file.split('.proposal.json')[0], 'xiaomi-ocr-0'];
            const proposal = json<OcrProposal>(join(inputs!, file));
            const readers = variant === 'docling-self' ? ['docling-02'] : ['docling-02', 'rapidocr', 'docling-02+rapidocr', 'none'];
            for (const reader of readers) {
                const anchors: AnchorSet[] = reader === 'none' ? [{ reader: 'rapidocr', sourceSha256: proposal.sourceSha256, pages: [] }] : reader.split('+').map(r => json<AnchorSet>(join(inputs!, `${doc}.anchors-${r}.json`)));
                const evidence = anchorOcrDocument(proposal, anchors);
                const v = verifyOcrStatement(evidence);
                const t = truth[doc];
                // Score only after the decision. Printed truth = what the page shows; financial truth = the real movement.
                const byRef = new Map(t.rows.map(r => [r.Reference, r]));
                const econ = new Map(t.financialTruth.map(r => [r.reference, r]));
                const wrongPrinted = v.accepted.filter(a => {
                    const p = byRef.get(a.reference);
                    if (!p) return true;
                    const amount = a.direction === 'BANK_DEBIT' ? p.Debit : p.Credit;
                    return p.Date !== a.printedDate || plain(amount) !== a.amount || plain(p.Balance) !== a.balance || p.Description !== a.description;
                });
                const wrongEconomic = v.accepted.filter(a => {
                    const e = econ.get(a.reference);
                    return !e || e.isoDate !== a.isoDate || e.amount !== a.amount || (e.direction === 'DEBIT') !== (a.direction === 'BANK_DEBIT');
                });
                results.push({
                    document: doc, transcriber: variant, anchorReader: reader === 'none' ? 'none (no independent coordinates)' : reader, expectation: t.expectation,
                    decision: v.decision, expectedRows: t.rows.length, accepted: v.accepted.length, quarantined: v.quarantined.length, unresolved: v.unresolved.length,
                    correctlyAccepted: v.accepted.length - wrongPrinted.length, falseAcceptedPrinted: wrongPrinted.map(a => a.reference), falseAcceptedEconomic: wrongEconomic.map(a => a.reference),
                    unanchoredCells: evidence.unanchored.length, unanchoredReasons: evidence.unanchored.reduce<Record<string, number>>((n, u) => ({ ...n, [u.reason]: (n[u.reason] ?? 0) + 1 }), {}),
                    failedChecks: v.checks.filter(c => !c.passed).map(c => `${c.id}: ${c.detail}`),
                    heldReasons: [...v.quarantined, ...v.unresolved].reduce<Record<string, number>>((n, h) => { for (const r of h.reasons) n[r] = (n[r] ?? 0) + 1; return n; }, {}),
                    quarantineStatuses: [...new Set(v.quarantine.map(q => q.status))], warnings: evidence.warnings,
                    sampleAccepted: v.accepted.slice(0, 2), sampleHeld: [...v.quarantined, ...v.unresolved].slice(0, 3),
                });
                if (reader === 'none') expect(v.accepted).toEqual([]);
                const examples = process.env.POC_OCR_EXAMPLES;
                if (examples && reader === 'docling-02+rapidocr' && variant === 'xiaomi-ocr-0' && ['S1-digital', 'N1-tampered-amount', 'N5-prompt-injection'].includes(doc))
                    writeFileSync(join(examples, `${doc}.example.json`), JSON.stringify({ note: 'RECORDED_TEST replay of a local Xiaomi-OCR-0 proposal; synthetic document', evidence: { ...evidence, items: evidence.items.slice(0, 14) }, verification: v }, null, 1));
            }
        }
        writeFileSync(outPath!, JSON.stringify({ generatedAt: new Date().toISOString(), inputs, results }, null, 1));
        expect(results.length).toBeGreaterThan(0);
    });
});
