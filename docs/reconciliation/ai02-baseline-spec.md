# AI02 baseline specification

30 October 2026, Asia/Singapore. Algorithm ai02/1.0.0. Frozen dataset ai01-m2/1.1.0. Local research only; no approval, posting, ingestion, API or persistence behavior is introduced.

## Shared candidate policy

The approved raw AI01 input is validated through developmentCandidates by a separate adapter. It checks synthetic eligibility, source direction/sign/debit/credit interpretation, exact values, lineage and split. Only candidateId, routing role and the approved features enter the matcher. The core repeats structural, exact decimal, currency, direction, calendar, duplicate identity and version/split checks. It never sees template IDs, source-row ordering, event IDs, family labels or truth. The existing AI01 validator loads its integrity inventories internally; those inventories never enter scoring. Direct projected-input calls are internal research APIs, not a security boundary.

Every BANK is compared with every LEDGER within its split. Eligibility requires exact cash magnitude equality using AI01 equalDecimals, equal explicit currency and equal normalized cash direction. No conversion, money tolerance, floating-point money, cross-split comparison or source-template pairing is used. Missing/invalid monetary evidence fails closed, never becomes zero. Known currencies are MYR/USD because those are the approved dataset's currencies.

Date policy is configurable: select canonicalDate, transactionDate or postingDate and a whole-number window 0–31 days. The frozen experiment selects canonicalDate with an absolute two-day window. This provisional research setting accommodates the dataset's declared transaction/posting bases and lagged example; it is not a SAIC-approved accounting rule. Available transaction and posting dates remain distinct. A missing selected date blocks the pair; there is no fallback, invented date or basis conversion. All comparisons use UTC calendar days. The same policy applies to both baselines and is not tuned against held-out data.

References and descriptions do not block candidates. All 48 training and 16 development genuine pairs survive, including all twelve description-dependent training/development pairs with competing candidates. The other six description-dependent pairs belong to the reserved held-out split and were not run through AI02. The source-independent eligibility predicate has unit coverage on the same required features; full held-out recall is intentionally not claimed.

Each pair is generated once. Unknown/duplicate identities fail before Cartesian comparison. IDs provide addressing and presentation ordering only. Cross-source identity equality, row positions, account crosswalks and template shortcuts are not evidence.

## E0 exact support

A financially eligible pair scores 1 only if both references are present/nonblank and raw references are exactly equal. Missing/null/empty references never match. E0 does not normalize reference formatting. If both counterparties are available and Unicode-normalized text differs, support is vetoed. Missing counterparties do not invent an identity. Otherwise scores are 0 and unsupported. Description equality is reported but cannot substitute for a reference. The frozen support threshold is 1 and margin 0; exact-score ties still abstain.

## E1 lexical support

Text normalization: Unicode NFKC, locale-independent lowercase, Unicode letters/digits retained, punctuation replaced by spaces, whitespace collapsed. No transliteration, translation dictionary, learned abbreviation expansion or benchmark-specific lookup exists. References additionally remove normalized spaces; present references contribute exact formatting-normalized equality (1 or 0), not partial hash-prefix similarity.

Description and counterparty similarity are the mean of set token Dice and set character-bigram Dice. Bigrams use Unicode code points. Empty text contributes no matching evidence. Dice is 2 times intersection size divided by the sum of set sizes. Scores are ordinary research Numbers, never monetary arithmetic.

Weights are fixed before development-grid evaluation: description .70, counterparty .20, reference .10. Optional fields available on both sides enter the denominator; absent optional fields do not act as agreement. The weighted score is rounded to 12 decimals. The same conservative counterpart mismatch veto as E0 applies: available unequal normalized counterparties have no support. This may reject legitimate aliases and is a documented provisional restriction, not proof that textual inequality means distinct entities. Counterparty fuzzy similarity remains visible evidence but cannot override this guard.

The fixed development grid is threshold [.75,.85,.95] × margin [.05,.10,.20]. Selection first minimizes explicit false plus unannotated suggestions, then maximizes economic F1 (null treated as zero for selection), then prefers a higher threshold and margin. All nine grid points produced the same development matching counts. The predetermined tie-break selected threshold .95, margin .20. No thresholds, weights or vocabulary were changed after seeing those results. No held-out score or label influenced selection. Training/development reuse means these are development estimates, not unbiased final-test results.

## Abstention and outputs

Both methods retain all eligible ranked candidates, including unsupported ones. A record may suggest only a unique top supported candidate at or above threshold. Equal scores (epsilon 1e-12) always abstain, even when margin is zero. A smaller-than-configured top-to-second margin abstains. Suggestions must be mutual: the candidate must independently choose the source as its unique supported top candidate. Any conflict causes abstention; there is no greedy first-row assignment or global assignment forced from hidden truth. This prevents duplicate one-to-one consumption.

Outcomes exist for bank and ledger records: SUGGEST_PAIR, AMBIGUOUS or UNRESOLVED, with partner identity, candidate list and reason. Unmatched truth is not visible to the matcher; a record without candidates is unresolved, not asserted economically unmatched. Group generation/aggregation is unsupported. Group-only examples without an equal individual counterpart remain unresolved. Membership in a true group cannot be inferred from labels; any erroneous suggestion involving a group member is measured separately by the evaluator. This is not AI04 independent financial verification.

Candidate rank is the worst position of a tied score group for each bank. IDs sort tied candidates for display only. This deliberately conservative rank prevents arbitrary ID order from inflating recall at K. Unique low-score candidates can still be retrieved at rank 1 without being suggested.

BaselineRun includes method/version, dataset version/split, full configuration, blocking counts/reasons, candidate count, scores/evidence, outcomes, suggestions, measured processing time and a SHA-256 fingerprint. The fingerprint binds canonicalized input features/identities, configuration and deterministic outputs; it excludes elapsed time. Input order is normalized by IDs. Processing time covers input validation, blocking, scoring, ranking and assignment, excluding fixture I/O and fingerprint serialization. Inputs are never changed.

## Deferred contracts

Client date rules, permitted currency sets, account/party aliases, missing-reference acceptance, grouping, human review and final approval remain unapproved operational requirements. No matcher result is an accounting confirmation. A future AI03 scorer can consume the same eligible pairs and approved feature objects; it must reuse the same blocking, assignment, tie-aware evaluation and split protocol. No AI03 code/model is installed or executed here.
