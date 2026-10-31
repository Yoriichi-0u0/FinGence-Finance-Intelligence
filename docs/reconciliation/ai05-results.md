# AI05 official frozen held-out results

30 October 2026, Asia/Singapore. Dataset ai01-m2/1.1.0. The single official prediction attempt and subsequent separate evaluator both succeeded. No technical retry or post-result tuning occurred.

## Actual population

100 synthetic records: 50 bank and 50 ledger, four unseen schemas. Validated held-out truth contains 32 genuine PAIR relationships, 28 explicit negative edges, four unsupported GROUP/PARTIAL relationships, 24 unmatched records and eight authored ambiguity cases. Groups are excluded from ordinary pair recall. All three methods use the same 232 eligible candidate pairs, retaining all 32/32 genuine pairs.

## Matching before and after verification

| Method | Stage | TP | Explicit FP | FN | Unannotated | Precision | Recall | F1 | Bank coverage | Unresolved banks |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| E0 | before | 14 | 0 | 18 | 0 | 100.000% | 43.750% | 60.870% | 28.000% | 36/50 |
| E0 | after | 8 | 0 | 24 | 0 | 100.000% | 25.000% | 40.000% | 16.000% | 42/50 |
| E1 | before | 16 | 0 | 16 | 0 | 100.000% | 50.000% | 66.667% | 32.000% | 34/50 |
| E1 | after | 8 | 0 | 24 | 0 | 100.000% | 25.000% | 40.000% | 16.000% | 42/50 |
| E2b | before | 18 | 2 | 14 | 0 | 90.000% | 56.250% | 69.231% | 40.000% | 30/50 |
| E2b | after | 8 | 0 | 24 | 0 | 100.000% | 25.000% | 40.000% | 16.000% | 42/50 |

All three verified pair sets are identical, not merely equal in size. They contain eight genuine pairs: 8/32 economic recall (25%), 8/50 bank coverage (16%), 40% F1 and 8/8 assessed precision (100%). Forty-two bank records remain unresolved (84%). Unresolved records are not reconciled. Zero observed false suggestions at this coverage does not establish production safety.

## Retrieval

| Method | Blocking recall | Recall@1 | Recall@3 | Recall@5 |
| --- | ---: | ---: | ---: | ---: |
| E0 | 32/32 (100%) | 50.000% | 68.750% | 68.750% |
| E1 | 32/32 (100%) | 62.500% | 68.750% | 68.750% |
| E2b | 32/32 (100%) | 62.500% | 68.750% | 68.750% |

Rank uses the preserved pessimistic worst equal-score bank rank. Recall@K denominators are all 32 genuine pairs, including author-known pairs that should operationally abstain. Verification does not rerank candidates.

## Verification impact and safety

| Method | Correct retained | Correct withheld | Explicit false withheld | Blocked proposals | Unresolved review proposals | Verified proposals |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| E0 | 8 | 6 | 0 | 0 | 6 | 8 |
| E1 | 8 | 8 | 0 | 0 | 8 | 8 |
| E2b | 8 | 10 | 2 | 0 | 12 | 8 |

No definitive amount/currency/direction/date violation existed in the raw suggestions, so no proposal was classified BLOCKED_PROPOSAL. Counterparty and insufficient-identity cases are withheld as UNRESOLVED_REVIEW. This preserves the distinction between definitive financial incompatibility and unverified identity.

| Raw suggestion safety metric | E0 | E1 | E2b | After verification, each method |
| --- | ---: | ---: | ---: | ---: |
| ambiguousCasesForced | 0 | 0 | 0 | 0 |
| authoredAbstentionContradictions | 0 | 2 | 2 | 0 |
| counterpartyConflict | 0 | 0 | 2 | 0 |
| dateViolation | 0 | 0 | 0 | 0 |
| duplicateAssignments | 0 | 0 | 0 | 0 |
| invalidDirection | 0 | 0 | 0 | 0 |
| missingIdentityEvidence | 2 | 4 | 6 | 0 |
| unknownVerificationEvidence | 2 | 4 | 8 | 0 |
| unmatchedRecordsSuggested | 0 | 0 | 4 | 0 |
| unsupportedGroupedMatches | 0 | 0 | 0 | 0 |
| wrongAmount | 0 | 0 | 0 | 0 |
| wrongCurrency | 0 | 0 | 0 | 0 |

unknownVerificationEvidence counts proposals with missing/conflicting identity or unverified source/financial checks. Complete unresolved-review proposal counts above additionally include ambiguity and competition. Missing evidence, conflicting evidence and genuine economic relationships are not interchangeable. Reason codes and every individual check remain in sealed predictions.json. Reason frequencies overlap when a proposal has multiple reasons.

E5 has two counterparty false edges and two genuine suggestions contradicting authored abstention; E1 also has two abstention contradictions. All are withheld. E5 adds two genuine pairs beyond E1 (four beyond E0), but both additional-over-E1 pairs are withheld for missing reference and competing financially plausible partners. No E5 advantage remains in verified recall or coverage.

## Actual first and warm pipeline timing

| Method | First candidate ms | First embedding wall ms | First ranking/fingerprint ms | AI04 verification ms | First pipeline ms | Warm pipeline p50 ms | Warm pipeline p95 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| E0 | 5.380 | 0.000 | 7.796 | 17.297 | 30.707 | 20.913 | 22.409 |
| E1 | 4.044 | 0.000 | 13.470 | 15.167 | 32.702 | 27.674 | 38.885 |
| E2b | 3.214 | 4012.658 | 14.821 | 17.878 | 4049.105 | 24.068 | 57.810 |

E5 initialization, integrity checking and loading: 3609.514 ms. It is contained in embedding wall time and must not be added again. E5 first pipeline took 4.049 seconds, 4016.402 ms more than the observed first E1 pipeline. Each first observation is one sample; no cold p50/p95 is claimed. Repeated freeze/model hashing means the OS disk cache may already be warm even though the worker is new.

Warm pipeline p50 was 24.068 ms for cached E5 versus 27.674 ms for E1 in this run; E5 warm p95 was 57.810 versus E1 38.885 ms. These seven-sample observations do not establish a speed advantage. E5 cache replays perform no model forward passes; p95 is the maximum of seven samples.

Service statistics: 28 unique text embeddings computed, 4 batched model calls, 199 unique-text cache hits across requests, 0 evictions, 0 truncated unique texts. Inference/IPC across service batches: 401.571 ms. One additional direct real-model call checks three uncached sample texts; it is outside service timing/counters. Total real forward calls: 5. Maximum cached-versus-uncached absolute delta: 2.6382185797091395e-08, tolerance 1e-05.

Peak sampled worker RSS after service batches: 906530816 bytes. It is not a continuously sampled process/system peak. No total memory or production concurrency requirement is inferred from it. The reused external model payload is 492,421,582 bytes across six files. The original isolated runtime's reported installed disk requirement remains approximately 496 MB; runtime/caches were not reinstalled or remeasured here.

Environment: Intel(R) Core(TM) Ultra 5 125H, 18 logical CPUs, 16641941504 total memory bytes; win32/x64, Node v24.14.1, Transformers 4.3.2. CPU FP32, 384 dimensions, 512-token maximum, attention-mask mean pooling then L2; one intra-op and inter-op thread, sequential ONNX execution. Model/tokenizer revision 761b726dd34fb83930e26aab4e9ac3899aa1fa78. No model downloads or external inference occurred.

## Reproducibility and conclusion

Freeze fingerprint: 0874f932eca2a38e83730c872eda6cde57d9a73d57ad59bcace41b1b11dd80b2. Evaluation fingerprint: 5316a91b047695ed381b7337b50a4a21b590df3eca8d284219b57a28e9e0f170. Raw byte hashes and all seven replay fingerprints/timing samples are retained. Each method produced one stable ranking fingerprint and one verification fingerprint over its first prediction plus seven warm replays. Independent auditing reproduced candidate cardinality, economic counts, worst-tie ranks, exact source checks, retained identities and all three ranking fingerprints without importing the official matching/metric implementations.

E5 showed a raw semantic-retrieval/matching gain on this synthetic split, with lower precision and extra operational risks. The conservative verified pipeline removes the observed false suggestions and insufficient-evidence suggestions, at the cost of recall; its final E5 outcomes are identical to the traditional baselines. No final-pipeline advantage or production accuracy guarantee is established. No statistical significance or confidence interval is claimed for this small, authored synthetic sample.
