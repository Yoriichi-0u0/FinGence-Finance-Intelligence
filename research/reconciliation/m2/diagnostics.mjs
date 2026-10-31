import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Read-only dataset audit. No generator, scenario board, feature projection or model imports.
 * These probes measure shortcuts, not an AI02 matcher or approval policy.
 * @param {import("./types").SplitInput[]} inputs
 * @param {import("./types").Truth[]} annotations
 */
export function diagnose(inputs, annotations) {
  const splits = inputs.map(input => {
    const truth = annotations.find(t => t.split === input.split);
    const records = new Map(input.records.map(r => [r.id, r]));
    const ledgers = input.records.filter(r => r.role === 'LEDGER');
    const moneyKey = r => JSON.stringify([r.amount, r.currency, r.direction]);
    const contextKey = r => JSON.stringify([moneyKey(r), r.transactionDate, r.postingDate, r.canonicalDate, r.counterparty]);
    const suggested = truth.relationships.filter(rel => truth.outcomes.some(o => o.subjectId === rel.id && o.decision === 'SUGGEST_PAIR'));
    const probes = suggested.map(rel => {
      const bank = records.get(rel.bankIds[0]), ledger = records.get(rel.ledgerIds[0]);
      const exact = ledgers.filter(l => bank.reference !== null && l.reference === bank.reference && moneyKey(l) === moneyKey(bank));
      const context = ledgers.filter(l => contextKey(l) === contextKey(bank));
      const competitors = context.filter(l => l.id !== ledger.id);
      return { bankId: bank.id, ledgerId: ledger.id,
        uniqueExactReference: exact.length === 1 && exact[0].id === ledger.id,
        nonDescriptionCandidateIds: context.map(l => l.id).sort(),
        descriptionDependent: !(bank.reference !== null && bank.reference === ledger.reference) && context.some(l => l.id === ledger.id) && competitors.length > 0 && bank.description !== ledger.description,
        allCompetitorsExplicitlyNegative: competitors.every(l => truth.negatives.some(n => n.bankId === bank.id && n.ledgerId === l.id && n.reason === 'DISTINCT_EVENT')) };
    });
    return { split: input.split, rows: input.records.length, templates: input.templates.length,
      suggested: probes.length, uniqueExactReference: probes.filter(p => p.uniqueExactReference).length,
      descriptionDependent: probes.filter(p => p.descriptionDependent).length,
      ambiguityAbstentions: truth.outcomes.filter(o => o.decision === 'ABSTAIN_AMBIGUOUS').length,
      negativeEdges: truth.negatives.length, probes };
  });
  return { version: inputs[0].version, definition: 'Unique exact reference + exact amount/currency/direction; description dependence means multiple equal non-description candidates with no shared true reference. Not a model score.', splits };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
  const splits = ['train', 'development', 'heldout'];
  const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  const result = diagnose(splits.map(s => read(`inputs/${s}.json`)), splits.map(s => read(s === 'heldout' ? 'evaluation-only/heldout-truth.json' : `annotations/${s}.json`)));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
