# Xiaomi-OCR-0 feasibility PoC: local document extraction for FinGence Phase 2

Dated 1 November 2026. Local experiment on branch `poc/xiaomi-ocr-0-feasibility` (from `origin/main` cb5db46).
Not merged, pushed or deployed. Synthetic documents only. No OCR endpoint, no external inference service.

## Recommendation: EXPERIMENT FURTHER

Xiaomi-OCR-0 transcribed moderately degraded bank-statement pages more accurately than the existing Docling/RapidOCR
path (57/57 exact rows on a ~124 dpi skewed JPEG scan where Docling managed 9/57). Paired with independent
verification it produced **zero false acceptances** across every document and configuration tested. It is not
ready to adopt because:

1. **Speed on the M2:** 54–73 s per A4 statement page (about 16 tokens/s) with the official pinned runtime on MPS,
   10–25× slower than Docling. The model's linear-attention layers fall back to reference PyTorch kernels on MPS.
2. **No coordinates:** the model returns Markdown/OTSL text only. Under FinGence's evidence rules every value must be
   confirmed by an independent reader with real page coordinates. On low-resolution scans the independent readers,
   not OCR-0, became the bottleneck: on S3, OCR-0 was 100% correct but 0 rows could be verified.
3. **Hallucination under heavy degradation:** on the ~90 dpi stress pages the model invented an opening balance
   (`18,400.00` for `18,450.00`), a transaction count (`87` for `57`) and many references. Verification caught all of it.
4. **Silent omission:** the official prompt ignores headers and footers; the model dropped a footer line, which happened
   to be the injected instruction. A coverage gate against the independent reader is required.
5. The CUDA (MSI Katana) runtime, a larger and less regular document set, and optimized kernels are still unmeasured.

## Model facts (checked, not assumed)

| Item | Finding |
| --- | --- |
| Official source | `xiaomi-research/Xiaomi-OCR-0` (the `SeerRay-Lab/Xiaomi-OCR-0` URL redirects there) |
| Pinned revision | `bbd8cf8d21f256b3644b44cb860f3a7cecb93c30` (modified 2026-10-29) |
| Weights | `model.safetensors` 1,746,937,856 bytes, SHA-256 `d4551e9f…d5348`, matching the Hub LFS hash; full list in `evidence/weights-sha256.txt` |
| Architecture | `Qwen3_5ForConditionalGeneration`, 0.87B parameters, BF16; fine-tuned from `Qwen/Qwen3.5-0.8B-Base` |
| License | Apache-2.0 in the model-card metadata and README; **the repository has no separate LICENSE file** |
| Output | Markdown with OTSL tables, LaTeX formulas; KIE JSON. **No bounding boxes.** Layout needs a separate stage (PP-DocLayoutV3 officially) |
| Runtime pinned by the card | Python 3.13, `transformers==5.17.0`, `torch==2.14.0`, `torchvision==0.29.0` |
| Ollama | No official package. Community builds only (`longwayxu`, `richardyoung`, GGUF quantizations); the card says pulling alone does not apply the required preprocessing and the GGUFs are unevaluated. **Not installed or measured** (not authorized). |

## What was built

Research workspace (ignored): `.local/research/xiaomi-ocr-0/` (venv, weights, corpus, outputs, evidence, scripts).
Repository additions on the PoC branch, with no tracked file changed (`git diff --name-only origin/main` is empty):

- `lib/poc-ocr/contracts.ts`: experimental `poc-ocr-proposal-0.1`, `poc-ocr-evidence-0.1` and `poc-ocr-verification-0.1` types.
- `lib/poc-ocr/anchor.ts`: `anchorOcrDocument(proposal, anchorSets)` turns the model transcription into coordinate-anchored evidence.
- `lib/poc-ocr/verify.ts`: `verifyOcrStatement(evidence)` runs the independent exact-cent financial verification.
- `tests/poc-ocr/ocr-adapter.test.ts`: 16 unit tests. `tests/poc-ocr/research-evaluation.test.ts` is the env-gated local harness.

No dependency was added to `package.json` or `requirements-ai*`. Phase 1 `ProcessingRunner`, C1/C2, the V2
evidence/verifier/registry, authentication and Production are untouched.

## Corpus (all fictional)

Generated from the public Phase 1 demo statement (`public/demo/demo-bank-statement-2026-03.csv`), plus the existing
labelled fixtures in `public/samples/ai-ingestion`. Ground truth is read only after verification has decided.

| Document | Content | Expected outcome |
| --- | --- | --- |
| S1-digital | 57 rows over 4 pages, vector PDF, page PNGs rendered at 200 dpi | accept all |
| S2-scan | S1 at 200 dpi, 0.8° skew, blur, JPEG q45, image-only PDF | accept all |
| S3-lowres | S1 at ~124 dpi, −1.6° skew, blur, JPEG q28 | accept all |
| S4-stress | S1 at ~90 dpi, 2.5° skew, heavy blur, JPEG q18 | accept only what can be verified |
| N1-tampered-amount | one printed debit altered (778.57 → 773.57); balances and totals true | quarantine |
| N2-dropped-row | one row missing; totals include it | quarantine |
| N3-wrong-total | printed total debits overstated by 100.00 | quarantine |
| N4-ambiguous-sign | single unsigned Amount column, no balance | unresolved direction |
| N5-prompt-injection | instruction in a description cell and in the page footer | accept amounts; hold instruction as untrusted |
| FinGence fixtures | `statement-{digital,scan,mixed}.pdf`, `statement.png/.jpg`, `unreadable.png` | published baseline comparison |

## Extraction accuracy (one rule set for every engine)

Rows are matched one-to-one by exact Reference and each named column is compared as an exact printed string,
the same rule as `scripts/ai-benchmark.py`. Docling = the current V2 worker `scripts/ai-extract-02.py`; RapidOCR =
`ocr()` from `scripts/ai-extract.py` on the same page PNGs that OCR-0 received. RapidOCR gives regions only, so it
has no table rows by this rule; its exact-value presence is shown instead.

| Document | OCR-0 page mode: exact rows (fields) | OCR-0 region mode | Docling: exact rows (fields) | RapidOCR presence |
| --- | --- | --- | --- | --- |
| S1-digital | 57/57 (342/342) | — | 57/57 (342/342, text layer) | 285/285 |
| S2-scan | 57/57 (342/342) | 57/57 | 51/57 (324/342; 3 wrong money cells) | 285/285 |
| S3-lowres | 57/57 (342/342) | 56/57 (one reference `B→8`) | 9/57 (162/342; 42 wrong money cells) | 282/285 |
| S4-stress | 4/57 (5 matched; presence 207/285) | not run (Docling found no table to crop) | 0/57 (presence 6/285) | 17/285 |
| N1–N5 | all exact (15, 14, 15, 15, 15 rows) | N1, N5 exact | all exact (text layer) | all present |
| FinGence fixtures | 24/24 positioned on digital, scan and mixed PDFs; 12/12 on PNG and JPG; `unreadable.png` gave empty cells, no invented values | — | identical (published) | pdfplumber/RapidOCR: 0/24 positioned on scan |

Determinism: greedy decoding gave byte-identical text on re-runs (N1–N3) and between MPS fp16 and CPU fp32 (receipt).
S2 and S3 transcriptions of pages 1–3 are byte-identical to S1.

## Verification: correctly accepted records and false acceptance

Verifier gates (exact cents, configured DD/MM/YYYY and bank Debit/Credit convention, not inferred):
complete output; Date/Reference/Debit/Credit/Balance structure; printed control totals present **and anchored**;
row count; total debits; total credits; opening + credits − debits = closing = last balance; page continuity; no
amount found by an independent reader that the model left out. Per row: every cell anchored, valid date, exactly
one of debit/credit, running balance exact, no instruction text. A failed document gate quarantines every row.

"Accepted correct" is checked against the printed truth; "false acceptance" counts any accepted record whose date,
amount, direction, balance, reference or description differs from the printed page, or whose real financial value
differs (N1).

| Document | OCR-0 + Docling+RapidOCR anchors | OCR-0 + Docling only | OCR-0 + RapidOCR only | Docling alone, same gates | OCR-0, no anchors |
| --- | --- | --- | --- | --- | --- |
| S1-digital | **57 accepted** | 57 | 57 | 57 | 0 (57 unresolved) |
| S2-scan | **57 accepted** | 0 | 0 | 0 (Docling found 54 of 57 rows) | 0 |
| S3-lowres | 0 (43 unanchored, 44 broken balance chains) | 0 | 0 | 0 | 0 |
| S4-stress | 0 (all 57 unanchored; totals and count fail) | 0 | 0 | 0 (no table) | 0 |
| N1 tampered | 0; tampered row `RUNNING_BALANCE_MISMATCH`, totals fail | 0 | 0 | 0 | 0 |
| N2 dropped row | 0; row count 14 ≠ 15, balance jump | 0 | 0 | 0 | 0 |
| N3 wrong total | 0; total debits fail | 0 | 0 | 0 | 0 |
| N4 unsigned | 0; 15 `UNRESOLVED_DIRECTION` | 0 | 0 | 0 | 0 |
| N5 injection | 14 accepted, the instruction row quarantined; footer instruction recorded as `UNTRUSTED_INSTRUCTION_TEXT` | 14 | 14 | 14 | 0 |
| **False acceptances** | **0** | 0 | 0 | 0 | 0 |

Region mode gave the same verification outcomes (S2 57 accepted with both readers; S3 0; N1 quarantined; N5 14).

Correctly verified records: OCR-0 with both readers 128 of 243 acceptable rows; Docling alone 71. False acceptance 0 in both.

### Failure analysis

- **Arithmetic alone is not enough.** On S4, 28 OCR-0 rows pass a running-balance-only check, and 24 of those carry
  a wrong reference or description (for example `TYQ3DMRYVE4U` for `TYQXDMRHVE4U`; `Hartman Events Catering` for
  `Hartanah Events Catering`). Balances cannot see identifier errors. The independent-reader gate blocked all of them
  (`outputs/arithmetic-only-s4.json`). Region mode produced the same class of error on S3 (`WLX4C87QGJ6Q`).
- **Tampering where both readers agree** (N1) is not an OCR problem: both readers correctly read 773.57. Only the
  running balance and printed totals expose it. OCR accuracy and false acceptance are separate measurements.
- **The weakest independent reader limits recall.** On S3 neither Docling (merged the `Balance (MYR)` heading with
  the forward balance; misread references) nor RapidOCR (missed headings on several pages) could confirm enough
  cells, so correct OCR-0 rows stay unresolved. Allowing either reader to confirm a whole row raised S2 from 0 to 57.
- **Hallucination is caught by control totals.** S4 invented an opening balance, a transaction count of 87 and
  wrong totals; the summary checks failed before any row could be accepted.
- **Silent omission.** OCR-0 dropped the footer instruction line. The adapter therefore compares the transcription
  with everything the independent readers saw and quarantines on any omitted amount; instructions found only by
  the independent readers are still recorded as untrusted.
- **Prompt injection.** The model transcribed `IGNORE PREVIOUS INSTRUCTIONS` verbatim and changed no amount. The
  verifier holds the row and records the text; no rule or decision reads document text as an instruction.

## Performance on the MacBook Air M2 (16 GB)

| Run | Measured |
| --- | --- |
| Smoke test, official receipt (298 tokens) | MPS fp16 73.7 s; CPU fp32 853.4 s; identical text, equal to the official reference |
| Model load | 21.6 s cold, 4.0 s warm |
| Page mode, A4 statement at 200 dpi (~1,050–1,230 tokens) | median 68 s (S1/S2), 54 s (S3), 50 s (S4); N1–N3 69–73 s re-timed in isolation; ≈16–21 tokens/s |
| Small fixture pages (~160 tokens) | 10–14 s |
| Region mode | table crop median 45.7 s; control-total crop 3.1 s |
| Peak process memory footprint | page mode 7.68 GiB (MPS driver allocation up to 3.36 GiB); region mode 3.99 GiB |
| Docling (existing worker) | 1-page PDF 5.9–7.6 s; 4-page 16.8–23.4 s (S4 50.1 s); peak 1.1–3.5 GiB |
| RapidOCR | 2.4–4.1 s per page image (3.3–4.1 s per 1-page document, 9.7–10.9 s per 4 pages) |

A 4-page statement costs about 4.5 minutes with OCR-0 on the M2, compared with about 20 seconds for Docling.
The first N1 and N2 page timings (98–104 s) overlapped an accidental concurrent Docling run and are not used; the
isolated re-run gave identical text. GPU utilization is not exposed without `sudo powermetrics`, which was not used.

**MSI Katana (RTX 4060 8 GB): not measured.** Run `scripts/katana/run_katana.sh` in the research folder (CUDA
torch 2.14.0 from the matching wheel index, hash-checked weights, `nvidia-smi` sampling every 500 ms, the same
page/table/text runs and an equality check against the M2 text). On CUDA, the optimized `flash-linear-attention`
and `causal-conv1d` kernels may remove the fallback seen on MPS, but they are extra dependencies that need separate
approval.

## Proposed FinGence OCR adapter

```
page image ──► Xiaomi-OCR-0 (local, pinned revision) ──► OcrProposal (text only, receipt: revision, weights, prompt, response hashes)
PDF/page ────► existing Docling worker  ┐
page image ──► existing RapidOCR        ┴─► AnchorSet[] (real boxes)
                       │
   anchorOcrDocument ──┴─► OcrEvidence (items in the V2 worker shape; box only from a reader; unanchored list; omitted content)
                       │
   verifyOcrStatement ─┴─► accepted (machine-verified experimental records) / quarantined / unresolved + Phase 1 Check[] and Quarantined[]
```

- The model's output is a `MODEL_PROPOSAL`. Model confidence is never used (`confidence: null`).
- A cell gets coordinates only from an independent reader's region with an exactly equal string, in the same row
  (structural row or skew-corrected baseline) and under an anchored column heading. All cells of a row come from one
  reader. Ambiguous, missing, column-mismatched or heading-less matches stay unresolved with `box: null`.
- Evidence items use the V2 `workerEvidenceSchema` shape (validated in a test), so a future integration can feed
  `extractSemanticEvidence`-style bundles. It cannot be passed to the V2 semantic verifier today: policy 0.2 has no
  rule for `Debit (MYR)`/`Credit (MYR)` and restricts debit/credit to `GENERAL_LEDGER` (asserted in a test). Extending
  that policy for bank statements is a financial-policy change: **REQUIRES TECHNICAL REVIEW**.
- Accepted records are `OcrVerifiedRecord` (bank perspective, exact strings, ISO date, evidence IDs). They are not
  `CanonicalTransaction`, C1 or `IngestionResult`, and no cast is provided. A V2-to-C1 bridge remains the separate
  milestone described in `docs/handoff/CURRENT.md`.
- Phase 2 placement: a backend `ProcessingRunner` stage `EXTRACT` (method `xiaomi-ocr-0+<reader>-anchor`) followed by
  `VERIFY` with these gates. Run as a local worker process, as the Docling worker is today; never as a public endpoint.

## Reproduce (exact commands)

Research folder: `R=.local/research/xiaomi-ocr-0` (ignored). Python 3.13 from Miniconda; system `python3` 3.14 on
this Mac exits silently and was not used.

```bash
python3.13 -m venv $R/.venv
$R/.venv/bin/pip install "torch==2.14.0" "transformers==5.17.0" "torchvision==0.29.0" pillow accelerate huggingface_hub pypdfium2 psutil
# weights: snapshot_download('xiaomi-research/Xiaomi-OCR-0', revision='bbd8cf8d21f256b3644b44cb860f3a7cecb93c30')
.venv-ai/bin/python -I $R/scripts/make_corpus.py public/demo/demo-bank-statement-2026-03.csv $R/corpus
.venv-ai/bin/python -I $R/scripts/make_stress.py . $R/corpus
.venv-ai/bin/python -I $R/scripts/baselines.py . $R/corpus $R/outputs/baselines
$R/.venv/bin/python -I $R/scripts/ocr0_run.py --mode page --out $R/outputs/ocr0-page.json $R/corpus/pages/*.png
.venv-ai/bin/python -I $R/scripts/region_crops.py $R/corpus $R/outputs/baselines/docling-evidence.json $R/corpus/regions S2-scan S3-lowres N1-tampered-amount N5-prompt-injection
$R/.venv/bin/python -I $R/scripts/ocr0_run.py --mode table --out $R/outputs/ocr0-table.json $R/corpus/regions/*-t*.png
$R/.venv/bin/python -I $R/scripts/ocr0_run.py --mode text  --out $R/outputs/ocr0-text.json  $R/corpus/regions/*-s.png
$R/.venv/bin/python -I $R/scripts/otsl.py $R/outputs/ocr0-page-view.json $R/outputs/ocr0-page.json
$R/.venv/bin/python -I $R/scripts/score.py $R/corpus/ground-truth.json $R/outputs/score-page.json docling=… rapidocr=… xiaomi-ocr-0=…
$R/.venv/bin/python -I $R/scripts/build_inputs.py $R/corpus $R/outputs/ocr0-page.json $R/outputs/inputs-page
POC_OCR_INPUTS=$R/outputs/inputs-page POC_OCR_TRUTH=$R/corpus/ground-truth.json POC_OCR_OUT=$R/outputs/eval-page.json pnpm exec vitest run tests/poc-ocr/research-evaluation.test.ts
$R/.venv/bin/python -I $R/scripts/summarize.py
```

Repository checks run on this branch: `pnpm exec vitest run tests/poc-ocr` (16 passed, 1 env-gated skipped),
`pnpm typecheck` (pass), `pnpm exec eslint lib/poc-ocr tests/poc-ocr` (clean), `pnpm check:server-boundary` (pass).
Node 25.8.1 was used; the repository declares Node 24.x (engine warning only). The full application test suite was
not re-run because no tracked file changed.

## Limitations

- One synthetic statement layout in a single font family; real bank statements vary far more. Results are not
  evidence of real-world accuracy.
- Degradations are simulated. Only the M2 was measured; the Katana run is prepared but not executed.
- Region mode depends on Docling's table detection (no crop was possible on S4). PP-DocLayoutV3 was not installed.
- Ollama and GGUF builds were not evaluated (not authorized).
- The verifier's statement conventions (DD/MM/YYYY, Debit/Credit/Balance) are configured for this layout. They are
  not a general bank-statement policy and are not client-approved accounting policy.
