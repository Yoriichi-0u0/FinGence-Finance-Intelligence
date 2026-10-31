# AI01 M1 dataset specification

27 October 2026. Generator version `ai01-m1/1.0.1`; default seed `fingence-ai01-pilot-001`. This review correction retains the `ai01-m1/1.0.0` seed namespace to preserve record IDs and exact monetary values. This is a 40-row pilot, not the future 300-row evaluation dataset. No model has been run and H1–H4 remain hypotheses, not findings.

## Scope and source contracts

Exactly four templates, ten rows each: two bank templates and two ledger templates, giving 20 BANK and 20 LEDGER records. These source schemas are synthetic and deliberately distinct; they are not asserted to reflect any actual client's convention. Each template declares distinct original column names and a source-specific financial/date interpretation. Records retain research fields and source monetary fields; M1 does not implement CSV/XLSX ingestion or claim to test a source parser.

| Template | Source fields and cash convention | Canonical date |
| --- | --- | --- |
| bank-signed-v1 | Signed source amount: positive inflow, negative outflow; debit/credit unavailable | Transaction date |
| bank-directed-v1 | Nonnegative amount with explicit cash direction; debit/credit unavailable | Posting date |
| ledger-cash-v1 | Cash asset: debit inflow; credit outflow | Transaction date |
| ledger-expense-v1 | Restricted settled-expense view: debit outflow; credit refund/inflow | Posting date |

The expense-view convention must not be generalized to arbitrary ledger accounts. Different account IDs identify source views; authored economic relationships specify their correspondence. No currency conversion, universal sign reinterpretation, date-window rule or automatic reconciliation approval exists.

`amount` is an explicit positive economic cash magnitude; `sourceAmount`, `debit` and `credit` preserve the source convention. Their equality/sign relationships are independently validated. Unused monetary sides are unavailable/null; they are never populated with invented zeroes. All money remains decimal strings, including `9007199254740993.123456789`. Exact equality and group totals use BigInt with integer scale metadata, never Number money. Decimal syntax excludes exponents, separators, whitespace, leading zeroes and negative zero, with a 128-character bound. Comparison can ignore trailing fractional zeroes while stored source precision remains unchanged.

Currencies are explicit per record: MYR and one USD negative example. Missing references, counterparties, source transaction IDs and dates use null. Canonical dates must equal the source date selected by that template and be calendar-valid ISO dates. Source dates are retained separately and no unavailable date is manufactured.

## Authored case distribution

| Family | Cases | BANK | LEDGER | Rows | Economic annotation / provisional outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| A Exact | 6 | 6 | 6 | 12 | Six true pairs; suggest for future verification |
| B Description variation | 2 | 2 | 2 | 4 | Two true pairs; shared reference, differing descriptions |
| C Abbreviations/formatting | 2 | 2 | 2 | 4 | Two true pairs; reference formatting differs |
| D Recurring equal amounts | 1 | 2 | 2 | 4 | Two latent true pairs; abstain due to ambiguity |
| E Amount mismatch | 1 | 1 | 1 | 2 | Explicit nonmatch; both unmatched |
| F Currency mismatch | 1 | 1 | 1 | 2 | Explicit nonmatch; both unmatched |
| G Missing references | 1 | 1 | 1 | 2 | One latent true pair; insufficient evidence/abstain |
| H No counterpart | 1 | 2 | 2 | 4 | Four independent unmatched events |
| I Duplicate candidates | 1 | 1 | 2 | 3 | One latent true pair, one unmatched decoy; ambiguous/abstain |
| J Grouped instalments | 1 | 2 | 1 | 3 | 125 + 175 bank = 300 ledger; unresolved group |
| Total | 17 | 20 | 20 | 40 | 14 one-to-one relationships + one grouped relationship |

Counts overlap deliberately: 14 true pairs involve 28 records, the group involves 3, and 9 unmatched records complete the economic partition. Five explicit negative pairs comprise E, F, two cross-recurring-event pairs from D and the decoy pair in I. The two ambiguity cases span seven records; they do not add rows or negate the three author-known true pairs inside them. Ten one-to-one relationships have provisional SUGGEST_PAIR outcomes; three ambiguous and one insufficient-evidence true pair abstain. None is an approved reconciliation.

## Review corrections and experimental evidence boundary

The independent pilot annotation manifest in research/reconciliation/pilot-annotations.ts specifies required negative **edges and reasons** by seed-independent source row identities. It imports neither the generator nor the authored CASES board. Validation resolves current opaque IDs and requires each listed edge; deleting all negatives, omitting one, changing its reason or substituting a different edge fails. Additional consistent explicit negatives remain permitted. This is a minimum completeness profile scoped to M1 revision 1.0.1, not a global requirement that all future datasets have five negatives. A future revision needs its own reviewed profile; the current M1 validator rejects unsupported versions.

The recurring case D now gives all four transactions the same transaction, posting and canonical date, `2026-02-17`, with unavailable source transaction IDs. Both bank transactions therefore have **two** indistinguishable ledger candidates on permitted matching evidence: exact cash magnitude, currency, direction, transaction/posting/canonical dates, description, counterparty and reference. A zero-day canonical-date comparison cannot select either true pairing. The author-known pairings and cross-pair negatives remain in ground truth only; both relationships retain ABSTAIN_AMBIGUOUS.

For this experiment, record IDs, source transaction IDs, source row numbers/order, filenames, template/system/account IDs, monetary/date basis labels and author annotations are identity/provenance/interpretation context, not cross-source tie-breakers. Raw financial fields must first be interpreted using the explicit template convention; their different representations are not evidence of an economic correspondence. No source-account crosswalk authorizing a particular bank/ledger template pairing is supplied. Any arbitrary tie-break on these fields is not economic evidence and must not count as a resolved ambiguous case. These documented input restrictions are not a production security boundary or a claim against unrestricted identifier-memorizing models. No matching algorithm is implemented here.

## Reproducibility and leakage

The seed is a printable string of 1–128 characters. SHA-256 of the frozen seed namespace/seed/domain-key controls opaque record IDs, synthetic references, source identifiers, descriptions and a BigInt amount offset. The generator revision is recorded separately. Dates and scenario structure are fixed; changing seed does not manufacture a new source-schema split or independent research sample. Records sort lexically by opaque ID; source row coordinates and template allocation are stable for a fixed seed/version. No current clock, uncontrolled randomness or network input is used. Canonical serialization sorts object keys recursively, preserves array ordering and appends one LF. SHA-256 fingerprints the UTF-8 output. The JSON fixture is LF-pinned only within this new module.

The fixed default fixture SHA-256 and verification evidence are recorded in the engineering report. A reviewer can run a different seed while retaining the prescribed count/label structure. Do not train on privileged relationship IDs, scenario family, generator key sequences, provenance IDs or the ground-truth sidecar. Record IDs use opaque hashes, but this is leakage reduction, not proof that generated data are unbiased. Template features, descriptions, row numbers and seed-derived sequences can still correlate with scenario authorship.

## Future evaluation design (not implemented)

Expand later to at least 12 schemas and 300 labeled rows, with **four wholly unseen frozen source schemas** held exclusively for final evaluation. Treat the four M1 schemas as development-only. Assign remaining eight schemas to training/development (the pilot four plus four additional), reserving the final four before model tuning. The exact rows per split, accounting periods and sample size/power require research review.

Split by source-template family and connected economic event group, never by individual bank/ledger row. Disjoint accounting periods, independently authored transaction identities, counterpart/reference pools, identifier domains and seed namespaces must separate splits. Keep every true pair/group, ambiguous candidate set and related decoy in one split. Inspect generator shortcuts; simply changing a seed or date does not make independent evaluation data. Freeze held-out schema definitions, annotations and checksums under a separate evaluator; do not expose those templates to prompt/model/ruleset development. Document any cross-schema relationship conflicts before assigning the group to a split.

No precision, recall, F1, accuracy, model ranking or hypothesis confirmation is reported in AI01. E0–E5 and the suggested initial E5-small model remain future experiments; no model is a predetermined winner.

## Proposed future integration information

For DB04/AI06 review only: job identity; bank/ledger record IDs; candidate pair/group identity; model name and immutable revision; scores/ranks; independent financial verification and reason codes; evidence references; unresolved/review state; authorized reviewer decision; immutable decision history; model/policy versions; seed/generator/source fingerprints and replay/idempotency metadata. These are logical requirements, **not approved production schema fields**. No table, migration, endpoint, authorization policy or persistence workflow is introduced by M1.
