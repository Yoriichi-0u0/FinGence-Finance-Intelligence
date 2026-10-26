# Increment 03 measured evidence — 25 October 2026

**No genuine inference was executed. No model accuracy or live-provider speed is claimed.**
The prepared primary model is Groq `openai/gpt-oss-20b`; the actual model used is **none**.
Provider requests/tokens/estimated spending are **0 / 0 / US$0**. Mock SDK/HTTP unit tests
are transport-contract tests, not live AI results or provider account verification.

## Actual extraction-only CLI evaluation

| Corpus | Documents | Exact literal fields | Sum of per-document runtimes |
|---|---:|---:|---:|
| Existing Increment02 regression | 26 | 242 / 276 (87.68%) | 82,384 ms |
| New held-out synthetic sources | 8 | 87 / 87 (100%) | 36,523 ms |

Runs used the existing local Docling/RapidOCR and CSV/XLSX readers on macOS Apple M2,
16 GiB memory. Each document uses a bounded worker where applicable; caches were already
populated. Timings include extraction, request preparation and the honest blocked-inference
path. They are not pure OCR time, first-ever download time, warm-model inference latency,
Windows performance or GPU benchmarks. Other machine activity may affect measurements.

The regression retains its degraded images, rotated receipt, bank movement, invoice,
ambiguous convention and unknown-fee cases. The deliberate corrupt PDF fails extraction;
its `PROCESSING_FAILED` outcome is expected, not removed. Sources with unestablished table
structure are not reported as proven empty documents. All detailed failures/coverage and
exact denominators remain in [regression output](evidence/regression-no-inference.json).

The held-out set uses eight new opaque filenames and different synthetic values, with
CSV, XLSX, digital/scanned PDF and PNG/JPEG represented. Labels are manually specified
under `tests/fixtures/ai-ingestion-03/`, separately from source authoring. The source script
neither reads nor generates labels. Runtime provider/materializer/verifier do not read
those files, recorded settings or descriptive fixture filenames. The labels were frozen
before any model run (none has occurred) and independently inspected against literal
CSV/XLSX and rendered PDF/image sources by a fresh-context reviewer. This is a small
controlled holdout, not independent accounting populations or a claim about model training.

One draft label was corrected during deterministic test development: original `-31.20`
remains literal source truth; canonical normalization correctly yields `-31.2`, an exact
decimal string with the same value. The existing normalizer was not changed. Both forms
are tested under their distinct meanings. No source file was regenerated to improve scores.

## Separately labeled deterministic controls

The held-out materializer/verifier controls use test-only hand-authored/deterministic
proposals and are **RECORDED_TEST**:

- 12 accepted row representations, each matched by ID and exact expected financial values.
- 3 unresolved source rows (bank movements and an unexplained financial fee).
- 0 rejected rows in this held-out control; malformed-value cases remain in regression.
- Every original source hash matches the frozen manifest.

These outcomes verify software behavior, not LLM mapping accuracy. Existing template
rebinding is tested with fresh evidence and explicit origins; reuse is not fresh inference.
No live-generated template has been evaluated. The normal finance page cannot select a
recorded provider. An unavailable or failing live provider never substitutes a recorded plan.

## Reproducible later live study — blocked

After separate credential/free-plan/dispatch authorization, evaluate the fixed corpus using
the same policy, prompt/schema, model and hashes; collect actual provider usage and separate
schema/mapping/final-record metrics. Repeat one positive example per format subtype twice
more and compare a six-case guidance ablation using the same verifier. Those model repeats,
ablations, live reuse timings, Groq availability and Ollama measurements are **NOT EXECUTED**.

The CLI stops on quota admission failure or uncertain dispatch, never retries inference.
For an acknowledged response followed by a pre-dispatch quota pause, an explicit later
`evaluate --live --resume <prior-live-report.json>` can continue remaining documents. It
checks split/guidance/provider/model/policy and exact file bytes, skips every acknowledged
response (including invalid proposals), and refuses unknown-outcome retries. Missing resume
arguments fail before processing. Unknown reservations/locks require investigation, not deletion.

The local byte-based token bound is intentionally conservative: held-out request reservations
were about 7.5–7.9K tokens including the 1,600-output ceiling, against an 8K TPM cap. This
may allow only one document per minute even when actual consumption is lower. No tokenizer
accuracy or hosted throughput is claimed. The 160K daily/64-attempt ceilings may require
multiple explicitly resumed sessions; failures are not discarded or silently retried.

See [summary JSON](evidence/summary.json), [held-out output](evidence/heldout-no-inference.json)
and the controlled synthetic traces in `evidence/traces/`. No live prompt/output has been invented.
