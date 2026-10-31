# AI03 training/development comparison

30 October 2026, Asia/Singapore. Actual local CPU FP32 inference, not a mock. Dataset ai01-m2/1.1.0. E0/E1 are the unchanged approved AI02 runs, whose fingerprints were reproduced at their frozen configurations. No AI03 held-out input or label was loaded for inference, tuning or evaluation.

## Economic matching

| Method / split | TP | Explicit FP | FN | Precision | Recall | F1 | Coverage | Unresolved |
| --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |
| E0 / train | 21 | 0 | 27 | 100.00% | 43.75% | 60.87% | 28.00% | 72.00% |
| E0 / development | 7 | 0 | 9 | 100.00% | 43.75% | 60.87% | 28.00% | 72.00% |
| E1 / train | 24 | 0 | 24 | 100.00% | 50.00% | 66.67% | 32.00% | 68.00% |
| E1 / development | 8 | 0 | 8 | 100.00% | 50.00% | 66.67% | 32.00% | 68.00% |
| E2b / train | 25 | 3 | 23 | 89.29% | 52.08% | 65.79% | 37.33% | 62.67% |
| E2b / development | 9 | 1 | 7 | 90.00% | 56.25% | 69.23% | 40.00% | 60.00% |

Combined train/development: E0 has 28 TP, zero FP, 36 FN (43.75% recall; 60.87% F1). E1 has 32 TP, zero FP, 32 FN (50% recall; 66.67% F1). E2b has 34 TP, four explicit FP, 30 FN: **89.47% precision, 53.125% recall and 66.67% F1**. E2b therefore does not establish overall F1 superiority over E1 and reduces precision. All suggestions in these runs are annotated; unannotated suggestion count is zero.

All four E2b false edges are the existing COUNTERPARTY negatives: matching descriptions/amounts with distinct counterparties. E1's exact normalized counterparty veto suppresses them; E2b deliberately scores counterparty text semantically rather than copying that veto. This scoring-policy difference is explicit, and its adverse effect is retained. Both share exactly the same financial/date eligibility pool.

E2b recovers two of the twelve description-dependent evaluated pairs (one D multilingual-supplies example in train and one in development). E0/E1 recover none at their frozen settings. E2b still misses the other ten. No lookup, translation dictionary, label, ID, source row or family identifier enters inference.

## Retrieval

| Method / split | Blocking recall | Candidate comparisons | Recall@1 | Recall@3 | Recall@5 |
| --- | --- | ---: | --- | --- | --- |
| E0 / train | 48/48 | 498 | 50.00% | 68.75% | 68.75% |
| E0 / development | 16/16 | 66 | 50.00% | 68.75% | 68.75% |
| E1 / train | 48/48 | 498 | 62.50% | 68.75% | 68.75% |
| E1 / development | 16/16 | 66 | 62.50% | 68.75% | 68.75% |
| E2b / train | 48/48 | 498 | 58.33% | 68.75% | 68.75% |
| E2b / development | 16/16 | 66 | 62.50% | 68.75% | 68.75% |

Every one of the 64 genuine training/development pairs survives the unchanged pool: 498 eligible train edges, 66 development edges. No final-test recall is reported. Recall@K retains AI02's pessimistic worst-tie rank; an arbitrary ID sort cannot count as evidence. Genuine PAIR relationships are the denominator (48 train, 16 development); unsupported GROUP/PARTIAL relationships are excluded. Precision uses TP/(TP+explicit FP), with unannotated suggestions separate; all denominators/undefined-null rules remain the unchanged AI02 evaluator's definitions.

## Operational research safety

| Method / split | True suggestions contradicting abstention | Unmatched records suggested | Group-associated suggestions | Authored ambiguous cases fully abstained | Duplicate assignments | Invalid financial candidates |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| E0 / train | 0 | 0 | 0 | 12 | 0 | 0 |
| E0 / development | 0 | 0 | 0 | 4 | 0 | 0 |
| E1 / train | 3 | 0 | 0 | 12 | 0 | 0 |
| E1 / development | 1 | 0 | 0 | 4 | 0 | 0 |
| E2b / train | 3 | 6 | 0 | 12 | 0 | 0 |
| E2b / development | 1 | 2 | 0 | 4 | 0 | 0 |

E1 and E2b each suggest four author-known genuine pairs labelled ABSTAIN_INSUFFICIENT. Economic truth is therefore not operational approval. E2b's four counterparty false pairs consume eight annotated unmatched records (six train, two development). No group-associated suggestions, forced authored ambiguity, duplicate consumption or financial blocking violation occurred. This does not prove grouping is detected: the ranker implements one-to-one comparisons only. E2b recorded one assignment-conflict record in train and none in development.

## Model and reproducibility

- Model: Xenova/multilingual-e5-small, revision/tokenizer revision 761b726dd34fb83930e26aab4e9ac3899aa1fa78, converted from intfloat/multilingual-e5-small.
- Runtime: @huggingface/transformers 4.3.2, ONNX Runtime 1.30.0; Node v24.14.1, win32/undefined, CPU Intel(R) Core(TM) Ultra 5 125H.
- FP32, CPU provider, one intra-op and one inter-op thread, sequential execution. No CUDA installation requested.
- Text: query prefix on both sides, description plus optional counterparty, NFKC and whitespace normalization; case preserved.
- Pooling: pinned feature-extraction pipeline uses attention_mask mean pooling then L2 normalization; dimension 384. Verified tokenizer maximum: 512 tokens.
- Fresh uncached repeated inference maximum absolute difference: 2.7163882698744146e-8, tolerance 1e-5. Identical text within a real batch difference: 0.
- Real truncation stress: 906 original tokens, truncated to configured maximum 512, valid output. No train/development text was truncated.
- Warm repeated ranks produced one fingerprint per split; a fresh worker reproduced the final train fingerprint. These observations do not require bit-identical scores across hardware/runtime versions. Raw cosine is rounded to 1e-6 for tie handling/fingerprints and is not a calibrated probability.

The predeclared grid was thresholds [.80,.85,.90,.95] × margins [.01,.03,.05]. The unchanged AI02 selection objective minimizes explicit FP plus unannotated suggestions, then maximizes economic F1, then chooses larger threshold/margin. Development selected **threshold 0.9, margin 0.03**, with canonical-date window two days. E0/E1 configurations and weights were never retuned. Operational contradictions are reported separately, not silently folded into economic accuracy. All grid rows are retained in results.json. Training/development metrics are exploratory and development selection is optimistic; the final test remains reserved for AI05.

## Actual local performance

| Method / split | Cache state | p50 ms | p95 ms | Samples |
| --- | --- | ---: | ---: | ---: |
| E0 / train | Warm JS baseline, no embedding cache | 21.823 | 74.980 | 7 |
| E0 / development | Warm JS baseline, no embedding cache | 2.235 | 6.752 | 7 |
| E1 / train | Warm JS baseline, no embedding cache | 26.127 | 69.608 | 7 |
| E1 / development | Warm JS baseline, no embedding cache | 3.493 | 13.651 | 7 |
| E2b / train | Warm embedding cache, no model calls in timed repeats | 108.936 | 235.678 | 7 |
| E2b / development | Warm embedding cache, no model calls in timed repeats | 7.847 | 55.717 | 7 |

These are different workloads and must not be presented as cold-inference speed comparisons. AI02 timing excludes fingerprint serialization; E2b end-to-end timing includes it. E2b rankingMs includes post-embedding cosine/ranking/assignment and fingerprint work. p95 over seven samples is the maximum, not a reliable production tail-latency estimate.

Fresh-process final train run: **3435.668 ms** end-to-end, including 2647.881 ms initialization/integrity/loading; embedding phase wall time 3391.302 ms and post-embedding ranking/fingerprint 35.998 ms. This is one observation; cold p50/p95 are not estimated. Fresh worker does not imply cold OS disk cache. Fresh worker inference/IPC time across 6 batches was 742.356 ms.

Initial smoke worker initialization was 2655.173 ms. Its first uncached train embedding fill (already loaded model, predeclared grid entry) took 519.260 ms. Model inference/IPC across smoke and experiment batches totalled 754.358 ms in 9 service model calls, plus three direct smoke calls outside the service counter. The fresh final worker added 6 calls: 18 total real forward calls for this evidence run.

Cache statistics: 546 hits and 59 misses per distinct text per request (90.25% hit ratio); 0 evictions. Within-request duplicate texts are consolidated before these counts. Cache bound is 512 entries, batch size eight. Sampled peak worker RSS after batches: 959418368 bytes in the smoke/experiment worker and 902553600 bytes in the fresh final worker. These are sampled resident-memory values, not a complete system or continuously observed peak.

Model/tokenizer network payload verified: 492421582 bytes across six files. Installed runtime disk: 495646502 bytes; model directory including its download manifest: 492424168 bytes. npm reported 45 installed packages in 28 seconds; aggregate npm network-transfer bytes were not exposed and are not invented. Additional npm cache disk was not measured. Weights and runtime are outside Git; only sanitized metadata and lock copies are packaged.

[Full results/grid](evidence/ai03/results.json), [real smoke](evidence/ai03/real-smoke.json), [selected configuration](evidence/ai03/selected-config.json), [download integrity](evidence/ai03/download.json), [runtime evidence](evidence/ai03/runtime.json).
