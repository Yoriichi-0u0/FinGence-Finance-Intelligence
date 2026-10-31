import { describe, expect, it } from "vitest";
import { generateBenchmark } from "../../research/reconciliation/m2/generator";
import { BLOCKS } from "../../research/reconciliation/m2/schemas";
import { featuresOf } from "../../research/reconciliation/m2/features";
import { validateBenchmark } from "../../research/reconciliation/m2/validator";
import { diagnose } from "../../research/reconciliation/m2/diagnostics.mjs";
import { readFileSync } from "node:fs";

describe("M2 description-dependent payment evidence", () => {
  it("independently diagnoses frozen bytes without the generator or its feature projection", () => {
    const read = (p: string) => JSON.parse(readFileSync(new URL("../../research/reconciliation/m2/fixtures/" + p, import.meta.url), "utf8"));
    const splits = ["train", "development", "heldout"];
    const result = diagnose(splits.map(s => read(`inputs/${s}.json`)), splits.map(s => read(s === "heldout" ? "evaluation-only/heldout-truth.json" : `annotations/${s}.json`)));
    expect(result.splits.map(s => [s.suggested, s.uniqueExactReference, s.descriptionDependent, s.ambiguityAbstentions, s.negativeEdges])).toEqual([[30, 21, 9, 15, 42], [10, 7, 3, 5, 14], [20, 14, 6, 10, 28]]);
    expect(result.splits.flatMap(s => s.probes).filter(p => p.descriptionDependent).every(p => p.allCompetitorsExplicitlyNegative && p.nonDescriptionCandidateIds.length === 3)).toBe(true);
  });
  it("retains three competing suggested payments per source block without reference equality", () => {
    const benchmark = generateBenchmark();
    for (const block of BLOCKS) {
      const input = benchmark.inputs.find(i => i.split === block.split)!;
      const truth = benchmark.annotations.find(t => t.split === block.split)!;
      const banks = input.records.filter(r => r.templateId === block.bank && [2, 3, 4].includes(r.provenance.row));
      const ledgers = input.records.filter(r => r.templateId === block.ledger && [2, 3, 4].includes(r.provenance.row));
      const nonText = (r: typeof banks[number]) => {
        const f = featuresOf(r);
        return [f.amount, f.currency, f.direction, f.transactionDate, f.postingDate, f.canonicalDate, f.counterparty];
      };
      expect(new Set([...banks, ...ledgers].map(r => JSON.stringify(nonText(r)))).size).toBe(1);
      for (const bank of banks) {
        const rel = truth.relationships.find(r => r.bankIds.includes(bank.id))!;
        const ledger = ledgers.find(r => rel.ledgerIds.includes(r.id))!;
        expect(bank.reference === null || ledger.reference === null || bank.reference !== ledger.reference).toBe(true);
        expect(bank.description).not.toBe(ledger.description);
        expect(truth.outcomes.find(o => o.subjectId === rel.id)?.decision).toBe("SUGGEST_PAIR");
        for (const other of ledgers.filter(r => r.id !== ledger.id))
          expect(truth.negatives.some(n => n.bankId === bank.id && n.ledgerId === other.id && n.reason === "DISTINCT_EVENT")).toBe(true);
      }
    }
  });
  it("rejects removal of a required competing-payment negative", () => {
    const b = generateBenchmark();
    const input = b.inputs[0], truth = b.annotations[0];
    const bank = input.records.find(r => r.role === "BANK" && r.provenance.row === 2)!;
    truth.negatives = truth.negatives.filter(n => n.bankId !== bank.id);
    expect(validateBenchmark(b).valid).toBe(false);
  });
  it("rejects reintroduction of a shared reference shortcut", () => {
    const b = generateBenchmark(), block = BLOCKS[0];
    const bank = b.inputs[0].records.find(r => r.templateId === block.bank && r.provenance.row === 3)!;
    const ledger = b.inputs[0].records.find(r => r.templateId === block.ledger && r.provenance.row === 3)!;
    bank.reference = ledger.reference;
    expect(validateBenchmark(b).errors).toContain("description-dependent pair reveals exact equality");
  });
  it("rejects replacing the distinguishable service evidence with generic text", () => {
    const b = generateBenchmark(), block = BLOCKS[0];
    for (const r of b.inputs[0].records.filter(r => (r.templateId === block.bank || r.templateId === block.ledger) && [2, 3, 4].includes(r.provenance.row))) r.description = "Payment for services";
    expect(validateBenchmark(b).errors).toContain("distinct service description coverage");
  });
});
