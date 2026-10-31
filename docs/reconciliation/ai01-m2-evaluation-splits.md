# AI01 M2 split isolation and evaluation protocol

30 October 2026, Asia/Singapore. This is the frozen split protocol for ai01-m2/1.1.0. No model training, ranking, threshold tuning or evaluation score has been produced.

## Isolation rules and implemented checks

| Boundary | Implemented evidence |
| --- | --- |
| Source schemas | Six train, two development and four held-out IDs/definitions are fixed in schemas.ts; each appears in one split only; held-out IDs do not occur in M1 |
| Record identities | Unique opaque record IDs, source-row IDs and non-null source transaction IDs; reused cross-split identities are rejected |
| Economic identity | Relationships and unmatched events have private unique event IDs; reuse across any split is rejected |
| Economic content | Cross-split signatures compare role, exact normalized amount, currency, direction, normalized identifying description and counterparty while ignoring dates/record IDs, catching copied events even if IDs/dates are changed |
| References | Split/block-specific opaque references, shared only as intentional evidence within a split; normalized reference reuse across splits fails |
| Descriptions | Identifying merchant pools are disjoint; normalized identifying description copies fail even after case/spacing/punctuation changes |
| Accounting periods | Train 2024-01; development 2025-04; held-out 2026-07. All available source/canonical dates must remain in the assigned period |
| Relationships | Bank/ledger references must exist in the same input split; entire true/partial/grouped events, ambiguity sets and related decoys stay together |
| Annotations as features | Input envelope and record keys are strict, feature construction is a whitelist, private identity markers/oversized annotation JSON are rejected in text, and references have the declared opaque source-reference syntax |
| Development versus evaluation | developmentCandidates rejects held-out splits or relabelled held-out templates; heldoutCandidates and heldoutAnnotations are explicit evaluator-only calls |

All identifying reference strings are hashes of split/block domains, not visible scenario labels or sequential pair numbers. Opaque candidate IDs are returned solely as addressing metadata outside the features object. Rankers must consume **features only**; IDs, roles used for candidate-side routing, source provenance, schema/account/row-order metadata and full authoring objects are not embedding or tie-break features.

## Files and interfaces

Training and development consume only the corresponding fixtures/inputs/*.json files through developmentCandidates. Their private labels are separate fixtures/annotations/train.json and development.json files for supervised development/evaluation, never concatenated to candidate text. The held-out candidate input is fixtures/inputs/heldout.json. Its truth lives only in fixtures/evaluation-only/heldout-truth.json. The split manifest contains identities/hashes for audit, not features or pair labels.

heldoutAnnotations validates the full benchmark and returns a recursively frozen copy; caller mutation fails and cannot alter the underlying benchmark. Candidate views are also frozen. The interface supplies no matcher or metrics, so this milestone does not implement AI02/AI03. The authoring API can build all data and is intentionally evaluator-only; never import it into a ranker or a training data loader.

The complete review ZIP necessarily contains held-out annotations for independent engineering review. Local file separation and API checks are **not a security access-control system**. Future experiment operators must keep the evaluator artifacts out of training processes and restrict access under their research protocol. A malicious caller with filesystem access can bypass any ordinary local API; this work does not claim adversarial confidentiality or a secure sandbox.

## Freeze and future evaluation

1. Independently review source conventions, annotations and scenario realism before approving this version.
2. Freeze artifact/source hashes and store the review decision. Use train/development only to choose models, prompts, thresholds and abstention policies.
3. Hand only the held-out candidate view to the frozen algorithm. Keep held-out labels with an independent evaluator.
4. Evaluate once under the predeclared protocol. Do not choose thresholds from held-out labels or repeatedly tune against held-out outcomes.
5. If inspection changes dataset design or exposes evaluation answers to developers, retire that held-out version and create a separately reviewed replacement; do not claim it remains unseen.

The four held-out schemas are unseen **relative to the frozen training/development artifacts**, not secret from the benchmark authors or independent reviewer. No model has yet seen any data. Changing a seed does not by itself establish an independent final test set.

## Research limits

The six blocks share scenario families and generation grammar; this permits structural coverage but does not prove distributional independence or real-world realism. Merchant pools and accounting periods differ by split and may create distribution shifts. Some generic wording is intentionally shared. Exact/normalized identifying-content checks detect defined forms of reuse, not arbitrary semantic paraphrases of an event. The independently authored event inventory establishes intended distinct events; this cannot prove that an unrestricted future model will learn no synthetic shortcut.

Forbidden field/identity/serialized-truth tests cover accidental contamination at the supported input boundary. They do not claim to detect every possible human-authored answer encoded in natural language. Review new generators/text changes, keep feature schemas narrow and audit future experiment code for unintended access. No precision, recall, F1, latency or resource-efficiency result is inferred from dataset integrity tests.

Pending decisions include client-approved money/date tolerances, grouping/partial-payment policy, reconciliation approval authority, annotation governance, model/policy revisions, V2 verified-input eligibility and future DB04/AI06 persistence. This benchmark introduces no production schema or policy.
