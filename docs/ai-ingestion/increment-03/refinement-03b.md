# Increment 03B — rule-guided interpretation refinement

27 October 2026. Credential-free implementation; no new genuine inference. This is an
experimental feature-branch checkpoint, not a production release or proof of improved model accuracy.

## First genuine experiment: observed failure and diagnosis

The immutable `groq-first-csv-2026-10-27` evidence is retained outside Git in the canonical
workspace. Its actual `LIVE_GROQ` request used `openai/gpt-oss-20b`, 1,665 input and 408
output tokens, with zero retries. Extraction preserved 12/12 source literals; the proposal
was schema-valid and selected all six correct header rules. It supplied `conventions: null`,
and reused the six header IDs as context with financial rule IDs instead of classifying
the actual non-table `BANK STATEMENT` label. No transaction values were fabricated.

Materialization stopped at `UNRESOLVED_CONVENTIONS`. The resulting diagnostic verification
had zero accepted, zero rejected **rows**, and two unresolved rows. Proposal rejection is
distinct from row rejection. Context coverage was a second defect identified offline;
the genuine execution did not reach that later check. A counterfactual copy with conventions
supplied demonstrates `CONTEXT_COVERAGE`; it is a diagnostic test, never a repaired live result.

The old prompt listed convention names without defining their parsing meanings. Its one
mixed evidence list distinguished headers with a boolean, while the generic response
schema admitted arbitrary evidence and rule strings. It omitted the verifier's context-rule
vocabulary. These are concrete instruction/schema weaknesses. The model did not explain
why it returned null with no assumptions, so underspecification is a plausible explanation,
not a proven causal account of its internal reasoning. Strict JSON success established
syntax compliance, not financial or context correctness.

The original proposal is copied byte-for-byte into the regression fixture
`tests/fixtures/ai-ingestion-03/first-live-failed-proposal.json`.
Its parsed-object SHA-256 is
`15371b822bef91f9c99b3ec07efdfe8eb132661beea595067324e6b07022242e`.
Replaying it is `RECORDED_TEST`, never another `LIVE_GROQ` result. It still fails.

## Instructions before and after

| Before | After (`rule-guidance-0.3b`) |
| --- | --- |
| “Cover every header and non-table context item” in a mixed tuple list | Separate `headers`, `context`, and read-only `values`, with disjoint source-derived ID enums and exact group counts in the request schema |
| “Unresolved conventions use null” without definitions | Explicit date/number examples, representation requirements, and reasons for abstention |
| No context rule vocabulary | Exact existing `context.document-label` and `context.metadata` vocabulary and narrow metadata allowlists |
| Generic IDs could reference a header as context | Only actual nonblank table-null IDs may appear in context; transaction cells cannot be header mappings |
| Same policy hash could resume an older-prompt study | Explicit prompt revision in requests/runs/evaluations; resume refuses a missing/different revision |
| Mapping score depended on successful blueprint materialization | Proposed mappings, base-plan schema validity, materialization and financial acceptance are measured separately |

The full before/after model messages and generated JSON schemas accompany the independent
review package. `plan.ts` is authoritative for the actual wire instructions. All policy
aliases, allowed document kinds and exclusion values remain represented; pipe-separated
strings and compact source tuples avoid increasing the conservative quota limits. No
source financial cell is truncated. Source filenames, labels and expected answers are
absent from inference requests. Table indexes/column indexes are structural coordinates;
the full evidence IDs and original page/sheet/row/cell/region coordinates remain local.

The base `v2-plan-0.3` schema and materializer retain their behavior. The request-specific
schema adds evidence-ID enums and group lengths only. It does not choose a financial rule
or context classification. Wrong known choices still reach and fail the independent verifier;
duplicate IDs remain invalid even though array-length constraints alone cannot enforce uniqueness.
An empty evidence group has an empty output array. `unknown` is a withheld context sentinel,
not a new accepted context rule. No exclusion/classifier vocabulary was broadened.

## Parsing is separate from accounting interpretation

| Choice | Evidence that supports it | When to abstain |
| --- | --- | --- |
| `dateOrder: ISO` | `YYYY-MM-DD` or an existing typed Excel date; equivalent parser results are harmless | Missing or conflicting source conventions must not be replaced with guesses |
| `DMY` | Day/month/year, `/` or `.` separated; `13/02/2026` disambiguates day-first | `01/02/2026` alone has two valid different interpretations |
| `MDY` | Month/day/year; `02/13/2026` disambiguates month-first | Same ambiguity rule; neither geography nor filename selects a default |
| `numberFormat: plain` | Ungrouped decimal point, e.g. `1234.56`; integer-only vectors can have equivalent meanings | Distinct plausible values such as `1,234` or `1.234` must be held |
| `dot_comma` | Decimal point and comma grouping, e.g. `1,234.56` | Conflicting grouping/decimal evidence or different valid value vectors |
| `comma_dot` | Decimal comma and point grouping, e.g. `1.234,56` | Same ambiguity rule; typed Excel numbers keep exact source value |
| `dateBasis: transaction_date` | Fixed experimental policy, with a separately identified transaction-date source | Posting date is preserved separately and never substituted; missing/invalid required dates remain errors |
| `signed_amount` | One source Amount representation, no direction or debit/credit sides | Do not manufacture a sign or infer bank polarity/cash flow from it |
| `amount_direction` | Source Amount plus literal DEBIT/DR/D or CREDIT/CR/C, without side columns | Bank IN/OUT or money-in/out meanings remain unsupported |
| `debit_credit` | Separate Debit/Credit fields and explicit GENERAL LEDGER context, without competing Amount/direction | Bank-statement debit/credit is not general-ledger evidence; conflicting representations remain held |

The unchanged verifier evaluates unique **parsed value vectors**, not mere label preference.
Invalid optional/required cells still undergo existing row validation; this is not permission
to invent a convention, repair a literal, classify revenue/expenses, calculate exchange rates
or create universal cash flow. Genuine ambiguity may return null for the complete conventions
object and a reason in assumptions. Runtime code never fills it after the response.

## Offline verification and scope

New controls cover the preserved live failure; a complete supported proposal; uniquely
supported ISO/DMY/MDY and all three number formats; ambiguous dates/numbers; competing
monetary columns; unsupported bank direction/sides; unknown fee columns; narrow context
metadata; swapped/missing/duplicate/fabricated references; wrong known rules; tampered
source values; exact decimal/identifier/currency/date/coordinate preservation; multi-table
ID separation; and evaluation-resume isolation. Existing CSV/XLSX/digital/scanned PDF/PNG/JPEG
controls remain in the full suite. These are deterministic controls, not model predictions.

`h01.csv` is now `DEVELOPMENT_SEEN`, based on an evaluation-only exposure manifest. The
other seven sources retain their original frozen labels. A retest of h01 cannot establish
generalization; no new live evaluation or independent model-accuracy score is claimed.
Runtime service/provider/materializer/verifier cannot read the exposure manifest or labels.

The original independent verifier, convention resolver, terminology registry, source
materializer body, extraction readers, C1/C2 contracts, quota/provider modules, dependencies
and production isolation controls are unchanged. The service adds prompt-revision metadata
only. The existing `proposalSchemaVerified` evaluation field is retained for compatibility;
its historical meaning was successful materialization. Use the new `planSchemaValid` and
`materializationCompleted` fields for separate metrics. Absent inference produces null model
scores, not a zero accuracy measurement.

Executed command results and credential-free corpus metrics are recorded in
[03B verification](verification-03b.md). The [second-experiment protocol](second-experiment-03b.md)
is prepared but not authorized or executed. Existing live receipts, quota state, revoked-key
evidence, historical snapshots and prior review archives remain unchanged.
