# AI01 M1 annotation guide

The scenario board in research/reconciliation/ground-truth.ts is authored economic truth. It is created before rendering transaction descriptions and financial fields, using private author keys which are not exposed on records. Annotation rendering maps these keys to generated opaque record IDs. It never scores text, infers a relationship from a matching amount, runs an algorithm or consumes an ingestion approval flag.

## Separate economics from operational evidence

`relationships` state author-known economic relationships, with explicit BANK and LEDGER ID arrays and ONE_TO_ONE or GROUP cardinality. `outcomes` state provisional **research** decisions separately:

- SUGGEST_PAIR: an identifiable authored one-to-one event may be proposed for later independent verification; it does not mean approved/confirmed reconciliation.
- ABSTAIN_AMBIGUOUS: multiple plausible candidates; do not force the author's privileged true identity into an operational result.
- ABSTAIN_INSUFFICIENT: author knows the event but references/evidence are insufficient under the provisional pilot rule.
- UNRESOLVED_GROUP: genuine multiple-record settlement with exactly conserved currency/direction/total, not flattened into individual true pairs.

No record is reused in multiple economic relationships. All 40 records have exactly one economic disposition: a relationship or unmatched. This economic partition does **not** define a mutually exclusive set of plausible candidate edges. Duplicate/recurring candidates intentionally overlap the annotation partition.

The two recurring payments have two actual pairings but four plausible candidate edges; the two wrong cross-pairings are explicitly negative. The duplicate case has one actual counterpart and one unmatched lookalike; both remain operationally ambiguous. Source-specific schemas/date bases do not themselves authorize a choice between candidates. The missing-reference pair remains true economically and unresolved operationally.

Following independent review, all four recurring records have identical available transaction/posting/canonical dates as well as identical permitted amount/currency/direction/text/reference evidence. Their source transaction IDs are null. Exact-date equality gives no preference among the four bank–ledger candidate edges. Opaque IDs/provenance distinguish records for bookkeeping only; no template/account/row-order crosswalk establishes a counterpart. The specification defines the experimental evidence boundary. Ground truth and the completeness manifest are evaluator-only annotations, never model features.

## Negative and unmatched conventions

`nonmatches` is a deliberately sparse set of five annotated edges with AMOUNT, CURRENCY or DISTINCT_EVENT reasons. These are author-known separate events, not assumed negatives inferred from descriptions. Amount/currency reasons must agree with the actual financial fields. An unmatched record has no counterpart **within this synthetic pilot**; it is not a claim about any external accounting universe.

All unlisted bank–ledger edges are **unannotated**, not verified negatives. A future evaluator must explicitly define whether/how it samples additional negatives; it cannot silently turn the 20×20 Cartesian complement into ground truth. Do not invent partial one-to-one positives for the two-instalment group. Unsupported grouping is evaluated separately from one-to-one coverage.

The M1 1.0.1 independent annotation profile lists the required cross-recurring, amount-mismatch, currency-mismatch and duplicate-decoy edges with their reasons. This is a required subset, not an exact negative count. More consistent, explicitly reviewed negatives can be annotated; a sixth consistent label passes validation. A different valid negative cannot substitute for an omitted required edge. The current validator rejects unknown revisions rather than silently applying or bypassing a future profile.

## Review checklist and change control

Check each authored event against its intended financial signs, currency, dates and lineage; then run the independent validator. It checks reference existence/roles, exclusive economic disposition, duplicate/contradictory labels, exact positive/group totals, operational cardinality, ambiguity membership and the pilot family distribution. It does not decide economics from similarity or prove the scenario board reflects client reality.

Review the scenario board and financial fixture together; the frozen snapshot and exact fingerprint catch unintended drift but are not an independent annotation authority. A future reviewer should approve added scenarios and policy versions before freezing new evaluation data. Keep model/candidate input separate from groundTruth/author keys. Do not tune against a future frozen final-test sidecar.

The provisional evidence/abstention choices and the settled-expense direction convention need research/client review before operational reuse. No monetary tolerance, exchange conversion, date window, ingestion V2 eligibility or authorized final approval rule is established here.
