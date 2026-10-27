# Increment 03 architecture and compatibility

Exact registered synthetic bytes → existing CSV/XLSX or Docling/RapidOCR extraction →
0.2 evidence → rule-guided LLM mapping plan → deterministic source materialization →
existing independent semantic verifier → separate experimental record outcomes.

## Rules versus model contribution

The unchanged `experimental-financial-terminology-0.2` registry remains the provisional
EXPERIMENTAL_SYNTHETIC_POLICY, not SAIC/accountant approval. Its exact JSON hash is bound
to the prompt and plan. The model selects document kind, header-linked registered rules,
context dispositions and conventions. It cannot author raw monetary values, transaction
rows, executable code, policy defaults, revenue/expense classes or universal cash flow.
Unknown semantics/conventions must remain unresolved. The verifier independently checks
headings, source context, literal evidence, coverage, conventions and financial validation.
A conforming JSON schema is not semantic correctness. Registry-limited interpretation is
not proof of learned accounting rules or arbitrary-layout generalization.

`v2-plan-0.3` adds a compact experimental proposal and `v2-run-0.3` adds execution evidence.
No C1/C2/canonical schema or ruleset changes. V2 output is not `IngestionResult[]`, not a
C1 payload, and is not sent to analytics, persistence or reporting.

Request preparation strips filenames and evaluation metadata, uses reversible `eN` aliases
for real evidence identities, includes all extracted cells/context, and never imports
recorded settings or ground truth. Materialization accepts only complete unique header
bindings and known rule IDs (or explicit unknown/null), preserves all original rows/cells,
and copies exact source literals. It does not correct model-selected semantics. No source
coordinate is fabricated. Null conventions stop materialization and remain held.

Only experimental proposal-origin types/template validation were extended in the existing
0.2 files. LIVE_GROQ and LIVE_OLLAMA are explicit origins; RECORDED_TEST remains distinct.
Rebound templates retain original origin, but reuse itself is not a fresh inference call.
Only existing fully verified, nonempty proposals can become templates. Origin metadata
is a trusted local attribute, not a cryptographic authentication mechanism.

## Quota and dispatch controls

The fixed Groq transport uses strict JSON-schema output, GPT-OSS 20B, low reasoning effort,
1,600 maximum completion tokens, SDK retries zero and a 60-second timeout. No tools or
remote document URLs are enabled. JSON/schema/financial failures never trigger retries.
Returned usage survives malformed JSON; unknown outcomes retain reservations. Raw
provider error contents are not exposed in UI/logs. Request/output hashes and actual
reported token counts are evidence, not an invoice.

The shared local ledger enforces RPM 30, RPD 1,000, TPM 8,000, TPD **160,000** and at most
**64 attempts across this increment**, with one inference reservation in flight. Every
reservation consumes its conservative token bound even on failure. The bound uses all
prompt/schema UTF-8 bytes plus framing and the output limit, rather than claiming an
exact tokenizer count. Large requests fail closed, not truncated. This is conservative
and may permit only one document per minute. Account limits must be verified before
live activation; lower account limits require corresponding local limits before use.

The ledger uses exclusive locks, atomic owner-only file writes and symlink/corruption checks.
A crash can leave an unresolved lock/reservation requiring investigation. No automatic
refund, stale-lock deletion or uncertain-request retry exists. It does not control other
API clients or prevent a local owner changing/deleting state. Free-plan verification is
an operator prerequisite; flags cannot independently prove billing status.

Ollama uses a fixed loopback endpoint, checks an already-installed approved model, performs
no model pull, and uses the same experiment ledger. It has a 120-second timeout and bounded
response reading. Its generated run identity is distinct from provider request identity;
no provider request ID is fabricated when absent. No local model has been run here.

## Local UI and security boundary

The new HTTP route requires development mode, both local flags, no VERCEL environment,
loopback Host/URL and same-origin requests. It accepts a single registered synthetic file,
not a user-supplied proposal/provider/path/replay option. Uploads and external extraction
remain bounded. A local single-job gate and the durable inference gate prevent parallel
processing/dispatch. Disconnection cancels pending inference; no retry is initiated.
Production page/API are unavailable even with flags present. These are local PoC controls,
not authentication, RBAC, malware isolation or a backend trust boundary.

## Team compatibility inspection — 25 October 2026

- Celester `aea035f8568d883dadadccb031ec2d9f87f65eb3`: internal transaction and batch
  contracts/query services, requiring trusted identity/scope/cursors/durable audit. No
  new HTTP route was integrated. The DTO requires backend IDs and ledger-net invariants;
  experimental records must not be cast into it.
- Jason `4ae493705fd2d3c8d43ff2d232a338621dd390b1`: audit persistence/query/CLI plus
  migration. No merge, migration or production-security claim. Experiment receipts are
  not a protected durable audit service.
- Izzat reporting branch points to `da10e2f21add1fec5449ac32ea1affdd8024563b`; no new
  AI-reporting contract found. Experimental JSON is a diagnostic artifact, not an agreed
  report API. Other members' ownership remains unchanged.

References checked during planning: [Groq strict outputs](https://console.groq.com/docs/structured-outputs),
[limits](https://console.groq.com/docs/rate-limits), [billing](https://console.groq.com/docs/billing-faqs),
[data handling](https://console.groq.com/docs/your-data), [Ollama structured output](https://docs.ollama.com/capabilities/structured-outputs).
Public documentation is not account/model access evidence. Synthetic evidence may be
retained by a hosted provider under its terms; zero retention is not claimed.
