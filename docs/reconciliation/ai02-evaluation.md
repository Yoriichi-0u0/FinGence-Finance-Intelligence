# AI02 training and development evaluation

30 October 2026, Asia/Singapore. Dataset ai01-m2/1.1.0; algorithm ai02/1.0.0. No held-out AI02 execution, tuning or accuracy is reported. Existing AI01 integrity tests still verify all frozen files; that is not baseline evaluation.

## Matching results

| Method / split | TP | Explicit FP | FN | Unannotated suggestions | Precision | Recall | F1 | Coverage | Unresolved |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |
| E0 / train | 21 | 0 | 27 | 0 | 100.00% | 43.75% | 60.87% | 28.00% | 72.00% |
| E0 / development | 7 | 0 | 9 | 0 | 100.00% | 43.75% | 60.87% | 28.00% | 72.00% |
| E1 / train | 24 | 0 | 24 | 0 | 100.00% | 50.00% | 66.67% | 32.00% | 68.00% |
| E1 / development | 8 | 0 | 8 | 0 | 100.00% | 50.00% | 66.67% | 32.00% | 68.00% |

E0 suggests 21 training and 7 development pairs. E1 suggests 24 and 8. The E1 gains are three training and one development author-known true pairs whose operational label is ABSTAIN_INSUFFICIENT. Thus the economic precision of these proposals is not proof of operational safety. Neither baseline suggests any of the twelve description-dependent training/development pairs at the selected settings, although all remain candidates. No assertion that fuzzy or a future embedding model must outperform is made.

## Retrieval and performance

| Method / split | Genuine pairs surviving | Eligible pairs scored | Recall@1 | Recall@3 | Recall@5 | First measured run ms | p50 ms | p95 ms |
| --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: |
| E0 / train | 48/48 | 498 | 50.00% | 68.75% | 68.75% | 22.893 | 22.441 | 22.929 |
| E0 / development | 16/16 | 66 | 50.00% | 68.75% | 68.75% | 3.395 | 2.844 | 3.395 |
| E1 / train | 48/48 | 498 | 62.50% | 68.75% | 68.75% | 32.288 | 33.313 | 43.645 |
| E1 / development | 16/16 | 66 | 62.50% | 68.75% | 68.75% | 4.464 | 4.464 | 7.104 |

Candidate-generation recall is 100% on both evaluated splits. There are 498 eligible pairs out of 5,625 train combinations and 66 out of 625 development combinations. This includes cross-template comparisons; no source-account crosswalk is inferred. Seven complete-split timings follow one warmup per method/split. p50/p95 use nearest-rank percentiles; p95 with seven samples is the maximum. Timings include validation, blocking, scoring, ranking and assignment but exclude fixture I/O and fingerprint hashing. These tiny local measurements are not production latency/SLA estimates or statistically powered speed comparisons.

## Operational diagnostics

| Method / split | Ambiguous bank records | Other unresolved banks | Authored ambiguous cases fully abstained | Assignment conflicts / duplicate consumption / invalid candidates | True suggestions contrary to authored abstention |
| --- | ---: | ---: | ---: | --- | ---: |
| E0 / train | 0 | 54 | 12 | 0 / 0 / 0 | 0 |
| E0 / development | 0 | 18 | 4 | 0 / 0 / 0 | 0 |
| E1 / train | 18 | 33 | 12 | 0 / 0 / 0 | 3 |
| E1 / development | 6 | 11 | 4 | 0 / 0 / 0 | 1 |

All 12 training and four development annotated ambiguity cases abstain. E0 reports insufficient exact support in these cases rather than claiming knowledge of their economic ambiguity. E1 reports some ambiguous records beyond those authored scenarios. Neither method suggests an annotated unmatched record or a group-associated pair in these runs. Grouping remains unsupported; absence of such errors here is not a general grouping detector. Unit tests separately exercise actual assignment conflicts.

## Denominators and limitations

- Genuine-pair denominator: all 48 train / 16 development PAIR relationships, including known pairs whose operational label is abstention. GROUP/PARTIAL relationships are excluded.
- Candidate-generation recall: genuine PAIR edges present in the shared financial/date pool divided by genuine pairs.
- Recall@K: genuine PAIR edges whose worst tied rank is at most K, divided by genuine pairs. Unsupported low-score candidates remain in retrieval rankings. This is deliberately pessimistic under ties and independent of suggestion thresholds.
- TP: suggested edge explicitly listed as a genuine PAIR. Explicit FP: suggested edge explicitly listed as negative. FN: genuine pairs not suggested. Unlisted edges remain unannotated, not assumed negative.
- Precision: TP/(TP + explicit FP), conditional on assessed suggestions. Assessed fraction and precision bounds including unannotated suggestions are also emitted. All suggestions here are assessed, so no unknown-edge precision inflation occurs in these results.
- Recall: TP/genuine pairs. F1: harmonic mean of defined precision and recall. Undefined denominators yield null (displayed N/A); they never become invented 100%. If precision or recall is undefined, F1 is null.
- Suggestion coverage: bank records with a mutual suggestion / all bank records (75 train, 25 development). Unresolved ratio: one minus this coverage, including ambiguous records. Ledger outcomes are still returned individually.
- Ambiguous bank records: count in AMBIGUOUS state. Annotated ambiguous cases: all bank members abstained, counted separately. Conflict-record count is distinct from duplicate assignment count (excess used identities). Invalid candidate count checks source roles/existence and financial/date eligibility.
- Unmatched diagnostics use 36 train / 12 development annotated unmatched records of either role. Unsupported groups total six train / two development. They are not ordinary one-to-one positives.

## Configuration selection and reproducibility

The predeclared nine-point development grid and selection ordering are retained in results.json. All grid points tie at eight TP, zero explicit FP/unannotated suggestions and eight FN. The predetermined conservative tie-break picks threshold .95 and margin .20. E0 uses threshold 1, margin 0. Shared canonical-date window: two days. Weights were fixed, not tuned to held-out results. These are exploratory development estimates; choosing configuration on development can bias its reported performance. Repeated timing runs are on train/development only.

Fingerprints exclude time and bind canonicalized input, configuration and deterministic outputs:

- E0 / train: `1574a5d2ca0946cd41ae62a06c7043660e073f95ddef2590884f835662645a5e`
- E0 / development: `abff19694fa5beac5aa12bce73eaddf7be1b6345ce22a770c4a68400e7b36538`
- E1 / train: `3d7d0b2558e198176fc88fb70afcb17f9f00af590f7d71ede31cd94ec8cd9a8a`
- E1 / development: `d942f91e75c9a3b24e98babdaeacc92d38e661a76f3ba5762fda13ce6211a779`

[Full results and grid](evidence/ai02/results.json), [frozen configuration](evidence/ai02/configuration.json), and [baseline specification](ai02-baseline-spec.md) define the experiment. Source and data hashes are in the AI02 integrity manifest. Held-out evaluation requires a separately approved frozen protocol; it has not been run.
