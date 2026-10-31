import { BLOCKS, DEFAULT_SEED, PERIODS, SPLITS, TEMPLATES, VERSION } from "./schemas";
import { SCENARIOS } from "./scenarios";
import { sha256, validSeed } from "./serialization";
import type { Benchmark, EligibilityExample, SplitInput, Truth } from "./types";

/** Authoring API. Full truth is private evaluator material; do not import this into a ranker. */
export function generateBenchmark(seed = DEFAULT_SEED): Benchmark {
  if (!validSeed(seed)) throw new Error("Invalid M2 seed");
  const inputs: SplitInput[] = [], annotations: Truth[] = [];
  const token = (...keys: (string | number)[]) => sha256(JSON.stringify([VERSION, seed, ...keys]));
  for (const split of SPLITS) {
    const input: SplitInput = { version: VERSION, seed, split, period: PERIODS[split], templates: structuredClone(TEMPLATES.filter(t => t.split === split)), records: [] };
    const truth: Truth = { version: VERSION, seed, split, relationships: [], negatives: [], unmatched: [], ambiguous: [], outcomes: [], cases: [] };
    for (const block of BLOCKS.filter(b => b.split === split)) {
      const id = (role: "BANK" | "LEDGER", row: number) => "r-" + token("record", split, block.id, role, row).slice(0, 24);
      SCENARIOS.forEach((scenario, index) => {
        const family = scenario.family;
        const caseId = "c-" + token("case", split, block.id, family).slice(0, 24);
        const bankIds = scenario.bank.map(n => id("BANK", n)), ledgerIds = scenario.ledger.map(n => id("LEDGER", n));
        truth.cases.push({ id: caseId, family, recordIds: [...bankIds, ...ledgerIds] });
        const links = scenario.group ? [{ bankIds, ledgerIds }] : scenario.pairs.map(([b, l]) => ({ bankIds: [id("BANK", b)], ledgerIds: [id("LEDGER", l)] }));
        links.forEach((link, n) => {
          const economicId = "e-" + token("economic", split, block.id, family, n).slice(0, 24);
          const relationId = "rel-" + token("relationship", economicId).slice(0, 24);
          truth.relationships.push({ id: relationId, economicId, family, kind: scenario.group ?? "PAIR", ...link, remainingAmount: scenario.group === "PARTIAL" ? "25.00" : null });
          truth.outcomes.push({ subjectId: relationId, decision: scenario.group ? "UNRESOLVED_GROUP" : scenario.ambiguous ? "ABSTAIN_AMBIGUOUS" : scenario.decision ?? "SUGGEST_PAIR" });
        });
        const used = new Set(links.flatMap(l => [...l.bankIds, ...l.ledgerIds]));
        for (const recordId of [...bankIds, ...ledgerIds].filter(r => !used.has(r))) {
          truth.unmatched.push({ recordId, economicId: "e-" + token("unmatched", split, recordId).slice(0, 24), family });
          truth.outcomes.push({ subjectId: recordId, decision: "UNRESOLVED_UNMATCHED" });
        }
        for (const [b, l, reason] of scenario.negatives ?? []) truth.negatives.push({ bankId: id("BANK", b), ledgerId: id("LEDGER", l), reason });
        if (scenario.ambiguous) truth.ambiguous.push({ id: caseId, family, bankIds, ledgerIds });
        for (const role of ["BANK", "LEDGER"] as const) {
          const template = input.templates.find(t => t.id === (role === "BANK" ? block.bank : block.ledger))!;
          for (const row of role === "BANK" ? scenario.bank : scenario.ledger) {
            const offset = BigInt("0x" + token("amount", split, block.id).slice(0, 8)) % 10000n;
            let amount = `${1000n + offset + BigInt(index) * 73n}.25`;
            // Three same-value services from one supplier on one day; amount cannot identify the purpose.
            if (["B", "C", "D"].includes(family)) amount = `${1000n + offset}.25`;
            if (scenario.ambiguous) amount = "125.00";
            if (family === "K") amount = role === "BANK" ? "88.10" : "88.11";
            if (family === "Q") amount = "12.50";
            if (family === "S") amount = role === "LEDGER" ? "100.00" : row === 22 ? "25.00" : "50.00";
            if (family === "T") amount = role === "BANK" ? "300.00" : row === 23 ? "125.00" : "175.00";
            if (family === "U") amount = "9007199254740993.123456789";
            const direction = (family === "R" && row === 21) || family === "A" ? "INFLOW" : "OUTFLOW";
            let description = `Settlement ${block.merchant}`;
            if (family === "B") description = role === "BANK" ? `TRF delivery charge ${block.merchant}` : `Caj penghantaran / freight ${block.merchant}`;
            if (family === "C") description = role === "BANK" ? `EQP RPR ${block.merchant.replace(/a/g, "")}` : `Equipment repair / baik pulih peralatan ${block.merchant}`;
            if (family === "D") description = role === "BANK" ? `Payment for supplies ${block.merchant}` : `Bayaran bekalan ${block.merchant} / payment received`;
            if (scenario.ambiguous) description = `Langganan bulanan / monthly service ${block.merchant}`;
            if (family === "Q") description = `Bank service fee ${block.merchant}`;
            if (family === "R") description = `${row === 21 ? "Refund / pulangan" : "Original payment"} ${block.merchant}`;
            if (family === "S" || family === "T") description = `Settlement instalment ${block.merchant}`;
            const counterparty = family === "H" ? null : family === "M" && role === "LEDGER" ? `${block.merchant} Holdings` : block.merchant;
            // C uses independent bank booking and supplier document references; D is missing on the bank side.
            const reference = scenario.ambiguous || ["B", "G", "I", "J"].includes(family) || (family === "D" && role === "BANK") ? null
              : "REF-" + token("reference", split, block.id, family, ...(family === "C" ? [role] : [])).slice(0, 16).toUpperCase();
            const day = family === "P" && role === "LEDGER" ? "18" : "17";
            const transactionDate = family === "H" && template.dateBasis === "POSTING_DATE" ? null : `${input.period}-${day}`;
            const postingDate = family === "H" && template.dateBasis === "TRANSACTION_DATE" ? null : `${input.period}-${scenario.ambiguous || ["B", "C", "D"].includes(family) ? "17" : family === "P" && role === "LEDGER" ? "19" : "18"}`;
            const debitCredit = ["CASH_DEBIT_CREDIT", "EXPENSE_DEBIT_CREDIT"].includes(template.basis);
            const negative = template.basis === "SIGNED_CASH" ? direction === "OUTFLOW" : template.basis === "SIGNED_EXPENSE" && direction === "INFLOW";
            const debitActive = template.basis === "CASH_DEBIT_CREDIT" ? direction === "INFLOW" : direction === "OUTFLOW";
            input.records.push({ id: id(role, row), role, templateId: template.id, systemId: template.systemId, accountId: template.accountId,
              sourceRowId: `${template.id}:${row}`, sourceTransactionId: scenario.ambiguous || family === "H" ? null : "TX-" + token("source-tx", split, block.id, role, row).slice(0, 16),
              provenance: { file: `${template.id}.synthetic`, sheet: template.format === "XLSX_STYLE" ? "Statement" : null, row, synthetic: true }, eligibility: "SYNTHETIC_RESEARCH_ELIGIBLE",
              amount, sourceAmount: debitCredit ? null : (negative ? "-" : "") + amount, debit: debitCredit && debitActive ? amount : null, credit: debitCredit && !debitActive ? amount : null,
              currency: family === "L" && role === "LEDGER" ? "USD" : "MYR", monetaryBasis: template.basis, direction,
              transactionDate, postingDate, canonicalDate: (template.dateBasis === "TRANSACTION_DATE" ? transactionDate : postingDate)!, canonicalDateBasis: template.dateBasis,
              description, counterparty, reference });
          }
        }
      });
    }
    input.records.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    inputs.push(input); annotations.push(truth);
  }
  return { version: VERSION, seed, inputs, annotations };
}

/** V: deliberately rejected examples; never mixed into the 300 eligible records. */
export function eligibilityExamples(benchmark: Benchmark): EligibilityExample[] {
  const original = benchmark.inputs[0].records.find(r => r.monetaryBasis === "SIGNED_CASH")!;
  const examples: [string, string, (r: Record<string, unknown>) => void][] = [
    ["number-money", "amount", r => { r.amount = 1.25; }],
    ["missing-money", "amount", r => { r.amount = null; }],
    ["bad-date", "date", r => { r.canonicalDate = "2024-02-30"; }],
    ["unknown-currency", "currency", r => { r.currency = null; }],
    ["unapproved", "eligibility", r => { r.eligibility = "UNAPPROVED"; }],
    ["legacy-valid", "eligibility", r => { r.eligibility = "VALID"; }],
    ["bad-basis", "basis", r => { r.monetaryBasis = "UNKNOWN"; }],
    ["missing-source", "source", r => { r.templateId = "unknown"; }],
  ];
  return examples.map(([id, reason, mutate]) => { const input = structuredClone(original) as unknown as Record<string, unknown>; mutate(input); return { id, expected: "REJECT", reason, input }; });
}
