# AI04 training/development verification results

30 October 2026. Dataset ai01-m2/1.1.0. Verifier ai04/1.0.0; policy ai04-policy/1.0.0. These are deterministic replays of preserved E0/E1/E2b suggestions, with no model rerun, threshold change or held-out evaluation.

## Economic quality and coverage

| Algorithm / split | TP before → after | Explicit FP before → after | FN after | Precision after | Recall after | F1 after | Bank coverage after | Correct pairs withheld |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| E0 / train | 21 → 12 | 0 → 0 | 36 | 100.000% | 25.000% | 40.000% | 16.000% | 9 |
| E0 / development | 7 → 6 | 0 → 0 | 10 | 100.000% | 37.500% | 54.545% | 24.000% | 1 |
| E1 / train | 24 → 12 | 0 → 0 | 36 | 100.000% | 25.000% | 40.000% | 16.000% | 12 |
| E1 / development | 8 → 6 | 0 → 0 | 10 | 100.000% | 37.500% | 54.545% | 24.000% | 2 |
| E2b / train | 25 → 12 | 3 → 0 | 36 | 100.000% | 25.000% | 40.000% | 16.000% | 13 |
| E2b / development | 9 → 6 | 1 → 0 | 10 | 100.000% | 37.500% | 54.545% | 24.000% | 3 |

Combined denominators: 64 genuine PAIR relationships and 100 bank records. GROUP/PARTIAL relationships are excluded from pair recall. Each method retains 18 genuine suggestions, zero explicit false or unannotated suggestions, 46 false negatives, 100% assessed precision, 28.125% recall, 43.902% F1 and 18% bank coverage. There are 82 unresolved bank records per method. Zero observed false positives at this limited coverage is not a guarantee of financial correctness.

E0 withholds 10 correct pairs, E1 withholds 14 and E2b withholds 16. E2b additionally withholds all four explicit false edges. Its two additional genuine matches over E1 are both withheld: missing reference and competing financially plausible partners provide insufficient independent evidence. The policy does not consume descriptions or semantic scores to rescue them. Their IDs and reasons are in additional-genuine-matches.json. No results or labels were changed to improve these figures.

Precision is TP/(TP + explicitly annotated FP). Sparse unannotated pairs remain separately counted; they are never assumed negative. Empty or wholly unassessed suggestions have undefined precision, not 100%. Coverage is unique verified bank IDs divided by all bank records. Economic truth and authored operational outcomes are separate.

## Eight known E5 risks

| Category | Split | Bank ID | Ledger ID | AI04 disposition / reasons |
| --- | --- | --- | --- | --- |
| AUTHORED_ABSTENTION_CONTRADICTION | train | r-35fa8b11551bead6e6c50d3e | r-65c284798e3bcb82636e7b1e | UNRESOLVED_REVIEW: REFERENCE_MISSING |
| INCORRECT_COUNTERPARTY | train | r-51867a69a8e088f1a8641a33 | r-0123205be660574c79374956 | UNRESOLVED_REVIEW: COUNTERPARTY_CONFLICT |
| AUTHORED_ABSTENTION_CONTRADICTION | train | r-56be5fcb12e5b25a6ab9c8cd | r-0409e7e874a2423c7bb84fb9 | UNRESOLVED_REVIEW: REFERENCE_MISSING |
| INCORRECT_COUNTERPARTY | train | r-649a571c749361e62462167e | r-1fef59d08eb04dd34555b90f | UNRESOLVED_REVIEW: COUNTERPARTY_CONFLICT |
| INCORRECT_COUNTERPARTY | train | r-8ab4b5db6671f42165670f48 | r-a5d6e790fc74b2d183eaa189 | UNRESOLVED_REVIEW: COUNTERPARTY_CONFLICT |
| AUTHORED_ABSTENTION_CONTRADICTION | train | r-fa90ac36eee440e674c6898d | r-14da09acd2cc9b1e6189e9bd | UNRESOLVED_REVIEW: REFERENCE_MISSING |
| INCORRECT_COUNTERPARTY | development | r-3c31005928bb83a569f28b63 | r-58fb2a0ab9b5ec6741c73b30 | UNRESOLVED_REVIEW: COUNTERPARTY_CONFLICT |
| AUTHORED_ABSTENTION_CONTRADICTION | development | r-b2642d638ab12ee832ab9f21 | r-69a4fd81120aad92017c39ed | UNRESOLVED_REVIEW: REFERENCE_MISSING |

The four counterparty conflicts are withheld for COUNTERPARTY_CONFLICT, not asserted to be definitively different entities based on spelling. The four authored-abstention contradictions are withheld for REFERENCE_MISSING. These generic checks use only operational source fields; authored decisions and pair IDs are used only in this evaluation table. E1’s same four authored-abstention contradictions are also withheld.

All methods after verification have zero observed wrong amount, wrong currency, direction or date-window suggestions; zero missing/conflicting identity evidence surfaced; zero duplicate assignments, unsupported topology, group-associated suggestions, forced authored ambiguity, authored-abstention contradictions or unmatched records suggested. Raw pre-verification financial/date violations were already zero. AI04’s adversarial tests independently establish that forged invalid proposals cannot rely on that upstream fact. Missing/invalid source evidence is not treated as a pass.

## Measured local verifier latency

| Method / split | Proposals checked | Retained | p50 ms | p95 ms | Identical replays |
| --- | ---: | ---: | ---: | ---: | ---: |
| E0 / train | 21 | 12 | 21.451 | 29.783 | 7; 1 fingerprint |
| E0 / development | 7 | 6 | 2.866 | 3.302 | 7; 1 fingerprint |
| E1 / train | 24 | 12 | 22.583 | 39.197 | 7; 1 fingerprint |
| E1 / development | 8 | 6 | 2.903 | 4.049 | 7; 1 fingerprint |
| E2b / train | 28 | 12 | 26.476 | 32.069 | 7; 1 fingerprint |
| E2b / development | 10 | 6 | 3.746 | 4.600 | 7; 1 fingerprint |

Each interval covers verification scope validation, exact financial checks, alternatives, assignment checks and SHA-256 fingerprints. File I/O, projection construction, label evaluation and model inference are outside the interval. This is a bounded in-process synthetic workload: 150 train or 50 development records, 7 samples per algorithm/split. p95 is the maximum of seven observations; it is not a production tail estimate. The implementation is O(N² + P×N + P²) with N records and P proposals, plus bounded decimal and serialization work. No network, model, GPU, database or billable inference is used by verification. CPU cost is not monetary cost.

## Reproducibility and boundaries

results.json records original run fingerprints, byte-exact source/truth SHA-256, all individual checks/reasons, policy, projection/proposal/output fingerprints and latency samples. All six batches reproduced one fingerprint over seven replays. No timestamps enter a fingerprint. The retained approved E5 metadata remains Xenova/multilingual-e5-small revision 761b726dd34fb83930e26aab4e9ac3899aa1fa78, CPU FP32, 384 dimensions, Transformers 4.3.2; AI04 does not load or modify it.

Trusted provenance here means agreement with the synthetic schema declarations. Production document authenticity, account linkage/authorization, client debit/credit conventions and producer V2 eligibility remain unresolved requirements. A full-cohort requirement prevents shortlist-induced false uniqueness, but it cannot authenticate a maliciously fabricated complete source cohort. This must be resolved before production use.
