# Xiaomi-OCR-0 follow-up: Katana kit, source anchoring, conditional OCR and corpus plan

Dated 1 November 2026. Continues [xiaomi-ocr-0-feasibility.md](xiaomi-ocr-0-feasibility.md) (commit `e6d573c`) on the
same local branch `poc/xiaomi-ocr-0-feasibility`. Decision unchanged: **EXPERIMENT FURTHER**. Not merged, pushed or
deployed. Synthetic documents only. **No new model inference was run**: every result below replays the recorded M2
Xiaomi-OCR-0 transcriptions. The only new reader output is one RapidOCR pass on 2x-upscaled pages (no new dependency).

## 1. Katana benchmark: corrected and validated, still unmeasured

**No Katana (RTX 4060) performance is claimed.** The kit was exercised on the Mac only, where it fails closed.

Defects found in the first script and what replaced them:

| Defect | Fix |
| --- | --- |
| Corpus not shipped or checked; Katana run depended on files copied by hand | `kit.py lists/manifest/pack` builds a 14 MiB kit (60 files: OCR inputs, SHA-256 manifest, scripts, M2 reference runs; **no weights, no ground truth**). `setup` runs `kit.py verify` before anything else |
| Corpus not provably regenerable | `kit.py regen-check` rebuilds the corpus from the recorded generators: **52 files byte-identical**; the 3 recorded image-only PDFs differ only in Pillow's `/CreationDate`/`/ModDate`. The generator now pins those dates, so new corpora are byte-reproducible |
| Region glob `*-t*.png` also matched `N1-tampered-amount-p1-s.png` | Exact patterns (`-p<n>-t<k>.png`, `-p<n>-s.png`), table and text lists asserted disjoint: 10 table crops, 4 control-total crops |
| No CUDA checks | `preflight.py`: Python 3.13; pinned torch 2.14.0 / torchvision 0.29.0 / transformers 5.17.0; CUDA (not CPU) wheel; `nvidia-smi` present; driver CUDA ≥ torch CUDA; GPU `sm_XY` compiled into the wheel; free GPU memory ≥ 5 GiB (configurable); fp16 matmul; disk ≥ 6 GiB; records whether `fla`/`causal_conv1d` exist (not installed). Host checks: `python3.13`, GNU `/usr/bin/time`, `sha256sum`, WSL2 detection |
| No smoke test | `smoke` stage: official receipt (must equal `receipt.md`) plus `S1-digital-p1` (compared byte for byte with the M2 text). `full` refuses to start without a smoke result |
| OOM lost all results | `ocr0_run.py` records `OUT_OF_MEMORY` per page, keeps finished pages, exits 3; records GPU name, CUDA version and free memory before load; `--dtype` (default fp16 = M2 parity; `bfloat16` optional) |
| No comparison | `kit.py compare` → `outputs/katana-compare.json`: per-file time, tokens/s, CUDA peak allocation, equality with M2 text, receipt equality, `nvidia-smi` maxima (utilization, memory, power, temperature) |

Validation on the Mac: lists, manifest, verify, pack, unpack → verify, and compare (on a stand-in built from M2
output with one deliberate difference: reported `1/2 identical`) all behaved as intended. `preflight.py` failed
closed (`torch-cuda-build`, `nvidia-smi`, `cuda-available`); `run_katana.sh preflight` stopped at the missing `nvidia-smi`.
`bash -n` passes; `shellcheck` is not installed here. The CUDA stages themselves have never run.

Corrected commands. On the Mac, from the repository root:

```bash
R=.local/research/xiaomi-ocr-0
$R/.venv/bin/python -I $R/scripts/katana/kit.py lists
$R/.venv/bin/python -I $R/scripts/katana/kit.py manifest
$R/.venv/bin/python -I $R/scripts/katana/kit.py regen-check "$PWD/.venv-ai/bin/python" "$PWD/.local/worktrees/poc-xiaomi-ocr-0"
$R/.venv/bin/python -I $R/scripts/katana/kit.py pack $R/dist/katana-kit-2026-11-01.tar.gz
```

On the Katana (Linux or WSL2 Ubuntu), in the unpacked folder. Choose the PyTorch CUDA wheel index whose CUDA version
is not newer than the `CUDA Version` that `nvidia-smi` prints; preflight fails if they disagree.

```bash
tar -xzf katana-kit-2026-11-01.tar.gz && cd xiaomi-ocr-0
TORCH_INDEX=https://download.pytorch.org/whl/cuXXX scripts/katana/run_katana.sh setup
scripts/katana/run_katana.sh preflight
scripts/katana/run_katana.sh smoke
scripts/katana/run_katana.sh full
scripts/katana/run_katana.sh compare
```

Return `outputs/katana-*` and `evidence/katana-*` for scoring.

| Measurement | Status |
| --- | --- |
| M2 MPS fp16 page mode 54–73 s/page, 7.68 GiB peak; table crop median 45.7 s (table crops only; unchanged); summary crop 3.1 s | measured (first pass) |
| RapidOCR on 2x-upscaled pages (M2 CPU) | measured: 2.4–4.3 s per 1-page document, 10.7–11.4 s per 4 pages, 1.5 GiB peak RSS |
| Katana CUDA latency, GPU memory, utilization, power, M2 text equality | **not measured** |
| CUDA optimized kernels (`flash-linear-attention`, `causal-conv1d`) | not installed (needs approval) |

The first pass's region-mode run contained the summary crop twice (once read as a table). Replaying without it changed
no decision: N1 stays quarantined for the same reasons; only 10 duplicate, unanchored summary cells disappear.

## 2. Why 57/57 exact rows on S3 gave 0 accepted, and what fixed it

Diagnosis (S3, ~124 dpi, every OCR-0 cell exactly right):

1. **Docling** merged each column of page 1 into one multi-line region (all dates, all references), which cannot locate
   a row; its other cells carried misreads.
2. **RapidOCR** read 299 of 303 cells exactly, but printed the heading line as one region `Credit (MYR) Balance (MYR)`
   on 3 of 4 pages. With no separate Credit/Balance heading, the strict rule refused every cell on those pages
   (`HEADER_UNANCHORED`).
3. **All three independent readers** share two errors at this resolution: `36,956.19` → `36.956.19` (also
   `43,272.82`) and `Settlement` → `Settiement`. The first left the page-3 carried-forward balance unconfirmed, so the
   page-continuity document gate quarantined all 57 rows.

Alternate anchoring methods, each optional, off by default, and never producing a coordinate that a reader did not print:

| Method | Rule | Coordinates |
| --- | --- | --- |
| `headingGroups` | Adjacent headings with no region of their own may share exactly one region equal to their exact join. Cells under the group are assigned to a column only by the reader's own region edges (right edges for money), which must split into one cluster per column with every gap ≥ 3× the widest cluster and ≥ 2× the median region height; otherwise `COLUMN_GROUP_UNRESOLVED`. Measured on S3: gaps 108–118 px against spreads ≤ 16 px | the reader's whole regions; the group box is never split |
| `moneySeparators` | A canonical money cell may be confirmed by a region of money shape (`\d{1,3}([.,]\d{3})*[.,]\d{2}`) whose digits are identical; only `,`/`.` may differ. Value in cents is unchanged. Never applied to dates, references or descriptions | the reader's region |
| `crossReaderCells` | When no single reader confirms a whole row, each cell may come from any reader that anchored the same row key itself; every reader's column conflicts still block | each item keeps its own reader's box and coordinate system |
| `rapidocr-x2` reader | RapidOCR (same `ocr()` as the V2 worker) on the page PNG upscaled 2x (LANCZOS) | upscaled image's own pixel frame, recorded per region |

Verification was tightened at the same time, for every mode: the omitted-content gate and the blank-cell column-conflict
check now treat reader money in either separator style as money (an omitted `1.234.56` used to slip past both). It
changed no strict-mode outcome on this corpus.

### Verified-record coverage and false acceptance (page mode, recorded M2 OCR-0 text)

Correct accepted rows out of 185 acceptable (S1 57, S2 57, S3 57, N5 14). False acceptance = any accepted record that
differs from the printed page or from the real financial value. N1–N4 must accept nothing.

| Independent readers | strict | headingGroups | crossReaderCells | moneySeparators | **headingGroups + moneySeparators** | all three |
| --- | --- | --- | --- | --- | --- | --- |
| Docling + RapidOCR | 128 | 128 | 128 | 128 | **173** (S3 45) | 173 |
| RapidOCR only | 71 | 128 | 71 | 71 | **173** (S3 45) | 173 |
| Docling only | 71 | 71 | 71 | 71 | 71 | 71 |
| RapidOCR-x2 only | 71 | 128 | 71 | 71 | 171 | 171 |
| Docling + RapidOCR + RapidOCR-x2 | 128 | 128 | 128 | 128 | **175** (S3 47) | 175 |
| Docling transcribing itself (no OCR-0) | 71 | 71 | 71 | 71 | 71 | 71 |
| **False acceptances (every cell above)** | **0** | **0** | **0** | **0** | **0** | **0** |

- N1 (tampered amount), N2 (dropped row), N3 (wrong total) and N4 (unsigned) stay quarantined for the same gates in
  every variant; N5 still holds the instruction row and records the footer instruction.
- S3 remainder (10–12 rows): `Settiement` in all readers, so the description cannot be confirmed; those rows stay held
  as `UNANCHORED_EVIDENCE`. Text cells keep exact matching on purpose: the first pass showed that reference and
  description errors pass balance arithmetic.
- S4 (~90 dpi): 0 in every variant, 0 false acceptances; the model's invented summary values still fail the totals.
- Region mode (table crops): best 71/128; S3 is quarantined because Docling's table boxes cut the carried-forward
  rows out of the crops on pages 2–3, which the omission and continuity gates caught. Region crops must cover every row.
- `crossReaderCells` gave no measurable gain on this corpus; recommend not adopting it until a corpus shows a need.

Recommended setting for the next round: `headingGroups + moneySeparators`, with Docling + RapidOCR (+ the x2 re-read
for pages below ~150 dpi). Both methods widen how a reader's text is matched, so they **require technical review**
before any use outside this PoC.

## 3. Conditional OCR strategy

```
document ──► page triage (text layer? pixel density / dpi estimate, page count, size limits)
   │
   ├─ text layer ─────────────► native/Docling text-layer extraction ─────────────┐
   ├─ image ≥ floor ──────────► Docling (V2 worker) ──────────────────────────────┤
   │                                │ page fails VERIFY for transcription reasons  │
   │                                ▼ (unanchored/misread cells, missing rows,     │
   │                     Xiaomi-OCR-0 fallback, per page    structure, row count)  │
   │                     (local worker, pinned revision, time/page budget)         │
   │                                └──────────────────────────────────────────────┤
   └─ below floor / unsupported layout ─► QUARANTINE: UNSUPPORTED (no OCR-0 run)   │
                                                                                   ▼
             VERIFY (independent of the transcriber): anchor every cell to Docling/RapidOCR(/x2) regions;
             exact cents; date/direction conventions from configuration; row count; totals; opening + credits
             − debits = closing; page continuity; omitted-content gate; instruction text held as untrusted
                     │                         │                                 │
                 VERIFIED rows           PARTIAL: verified rows             QUARANTINED / UNRESOLVED
          (experimental records,       accepted, held rows to review       (reasons and evidence ids kept)
           never C1, no V2→C1 cast)
```

Rules:

- Primary path is native text and Docling; Xiaomi-OCR-0 runs only on pages that failed VERIFY for transcription reasons,
  never on pages that failed for financial reasons (a tampered amount or wrong total must not trigger a re-read until it passes).
- The fallback output is a `MODEL_PROPOSAL`. It is accepted only through the same VERIFY gates, with coordinates from
  independent readers only. Model confidence is never used.
- Resolution floor: on this corpus ~124 dpi worked and ~90 dpi produced hallucinated summary values. Below the floor
  the page is quarantined as unsupported instead of spending about 70 s per page on a likely-unverifiable transcription.
- Unsupported (quarantine, no fallback): no balance column or control totals, unsigned single amount column, unknown
  date or sign convention, truncated model output, layout not covered by a configured statement profile.
- Region mode is used only when its crops provably cover every independent-reader amount on the page; otherwise whole-page mode.
- Placement: Phase 2 backend `ProcessingRunner` stages EXTRACT → VERIFY, as a local worker process. No public endpoint.

Effect on this corpus (recorded data): S1 is verified by Docling (57) without OCR-0; S2 and S3 fail Docling-only
VERIFY and fall back, giving 57 and 45–47 verified; S4 would be stopped at the resolution floor; N1–N4 fail for
financial reasons and are quarantined without a fallback. OCR-0 would run on 8 of 21 statement pages (about 9 minutes on the M2).

## 4. Proposed larger evaluation corpus

All synthetic and generated with exact ground truth, as now. Real documents only with separate owner approval, local-only.

| Dimension | Coverage |
| --- | --- |
| Statement layouts (≈ 12 fictional families) | separate Debit/Credit/Balance; single signed amount (`-`, parentheses, `DR`/`CR` suffix); balance with `DR`/`CR`; multi-line and wrapped descriptions; repeated page headers; subtotal and carried-forward rows; two accounts in one statement; landscape and two-column pages |
| Other financial documents | credit-card and e-wallet statements; supplier invoices with line items and tax; thermal receipts; payment vouchers; GL extracts and trial balances; AR/AP ageing; payroll summaries |
| Conventions | DD/MM/YYYY, DD MMM YYYY, short years; `RM`/`MYR` prefixes; European `1.234,56` (must be held unless configured); English/Malay/Chinese descriptions |
| Capture | vector PDF; scans at 300/200/150/120/100/90 dpi; JPEG quality and skew ladders; phone photos (perspective, shadow, curl); fax; watermarks, stamps, handwriting |
| Adversarial and negative controls | tampered amounts with and without consistent balances; wrong totals; dropped, duplicated and reordered rows; missing or reordered pages; lookalike characters (O/0, l/1, S/5, B/8) in references; separator traps; instructions in cells, footers, white or tiny text and images |
| Size | about 40 templates × 6 capture conditions × 1/4/12-page lengths ≈ 1,200 pages and ≥ 5,000 acceptable rows, plus ≥ 25 negative controls per family; a locked test split |
| Metrics | per-field exact accuracy; verified-row coverage; false acceptance with a 95% upper bound (0 in N accepted rows ⇒ ≤ 3/N); quarantine reasons; routing rate; latency and memory per engine and machine |

A suggested ADOPT bar: 0 false acceptances with ≥ 3,000 accepted rows (upper bound ≤ 0.1%), stated coverage on scans
at ≥ 150 dpi, and a measured p95 page latency that fits the Phase 2 job budget on the target hardware.

## 5. Remaining blockers before FinGence integration

1. Katana/CUDA performance unmeasured; M2 page latency (54–73 s) is too slow for interactive use.
2. One synthetic layout; verifier conventions (DD/MM/YYYY, Debit/Credit/Balance) are configured, not general or client-approved policy.
3. V2 terminology policy 0.2 does not map bank `Debit (MYR)`/`Credit (MYR)` (debit/credit are ledger-only): **REQUIRES TECHNICAL REVIEW**.
4. No V2-to-C1 bridge; verified OCR records remain an experimental type, never cast to C1.
5. Independent readers share low-resolution errors (separators, `l`→`i`); a genuinely different second reader would need dependency approval.
6. Region mode needs coverage-complete crops; a layout model (PP-DocLayoutV3/PaddleX) is not authorized.
7. The new anchoring methods widen matching and need review sign-off; `crossReaderCells` should be dropped unless a corpus shows value.
8. Model license is Apache-2.0 in metadata/README only (no LICENSE file): legal confirmation needed.
9. Worker packaging: 7.7 GiB peak footprint in page mode, job queue, timeouts and resource isolation; no public endpoint.

## Files and checks

Repository (branch `poc/xiaomi-ocr-0-feasibility`, local only):

- `lib/poc-ocr/anchor.ts`: `AnchorOptions` (`headingGroups`, `crossReaderCells`, `moneySeparators`; all off by default), heading groups with reader column bands, cross-reader cells, separator-equivalent money, `READER_MONEY`, conservative conflict and omission inputs.
- `lib/poc-ocr/contracts.ts`: `rapidocr-x2` reader, `COLUMN_GROUP_UNRESOLVED` reason.
- `lib/poc-ocr/verify.ts`: omitted-amount gate uses reader-shaped money.
- `tests/poc-ocr/ocr-adapter.test.ts`: 24 tests (8 new: heading groups, unresolved bands, moved group value, cross-reader composition and conflict, separator equivalence and its refusals, no separator rule for dates, omitted reader-shaped amount).
- `tests/poc-ocr/research-evaluation.test.ts`: replays every anchoring variant and the x2 reader.

Research folder (ignored): `scripts/katana/{run_katana.sh,kit.py,preflight.py,inputs/}`, `scripts/reread_upscaled.py`,
`scripts/summarize_anchoring.py`, `scripts/make_corpus.py` (pinned PDF dates), `scripts/ocr0_run.py` (dtype, CUDA facts,
OOM), `corpus/ocr-inputs.sha256`, `outputs/eval-{page,stress,region,region-v2}-anchoring.json`, `outputs/anchoring-summary.json`,
`outputs/ocr0-region-v2.json`, `outputs/baselines/rapidocr-x2-evidence.json`, `dist/katana-kit-2026-11-01.tar.gz`.

Replay commands (no model inference):

```bash
.venv-ai/bin/python -I $R/scripts/reread_upscaled.py .local/worktrees/poc-xiaomi-ocr-0 $R/corpus $R/outputs/baselines/rapidocr-x2-evidence.json $R/outputs/inputs-page $R/outputs/inputs-stress $R/outputs/inputs-region-v2
for s in page stress region region-v2; do POC_OCR_INPUTS=$R/outputs/inputs-$s POC_OCR_TRUTH=$R/corpus/ground-truth.json POC_OCR_OUT=$R/outputs/eval-$s-anchoring.json pnpm exec vitest run tests/poc-ocr/research-evaluation.test.ts; done
$R/.venv/bin/python -I $R/scripts/summarize_anchoring.py
```

Checks: `pnpm exec vitest run tests/poc-ocr` (24 passed, 1 env-gated skipped), `pnpm typecheck`,
`pnpm exec eslint lib/poc-ocr tests/poc-ocr`, `pnpm check:server-boundary`. Results are in the review ZIP manifest.
