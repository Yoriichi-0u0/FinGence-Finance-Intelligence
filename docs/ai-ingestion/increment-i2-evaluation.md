# V2-I2 — synthetic rule-guided evaluation

This local-only increment measures the existing 03B interpretation pipeline against separately specified synthetic source expectations. It does not enable hosted V2 routes, perform live inference, publish authoritative finance records, or cast V2 output into C1. The existing verifier and V2-I1 trusted-evidence boundary remain authoritative. Workstream owners retain their code; separate integration is required.

## Corpus and separation

Ten new synthetic inputs are frozen under `synthetic/ai-ingestion-i2/`, not the public web root. Their versioned manifest fixes bytes and SHA-256. Independently specified evaluation labels are in `tests/fixtures/ai-ingestion-i2/gold.json`; each case is bound to its input hash. Labels were manually authored for these synthetic documents, not derived from model predictions or independently audited by an external human. The CSV and XLSX layouts include large exact decimals, separate dates and leading-zero identifiers. Four PDF/image controls share one layout and are not independent samples. Additional CSV cases cover unsupported bank in/out, ambiguous date/number, unknown financial field, and instruction-like context. Gold forbids acceptance in those cases; it does not authorize accounting interpretations.

The runtime receives only the input bytes and an opaque filename. The evaluation runner loads labels **after all proposals and persistence complete**. Deterministic `RECORDED_TEST` controls use the existing terminology registry and source evidence; they are not model outputs. They never count as live accuracy. The runner blocks JavaScript network fetch and passes no credential to a provider. Real extraction can still fail or expose incomplete source coverage; no source rows or values are manufactured.

## Running the offline evaluation

With the locked Node 24 / pnpm environment and the project's existing local Python/OCR setup:

```bash
node --conditions=react-server scripts/ai-i2-evaluate.mjs
```

The command checks frozen input hashes, extracts each source, applies a recorded control through `materializePlan` and `verifySemanticBlueprint`, persists independently reverified outcomes in a disposable PGlite database, and retrieves them. It writes uniquely named JSON and text reports with owner-only file permissions in `.ai-local/increment-i2/`. Reports include source SHA, format, origin, extractor, latency, schema checks, exact literal preservation, header mapping precision/recall, document/context/convention checks where labeled, known unsupported assumptions, outcome counts/rates, exact/false acceptance, coverage, and evidence-reference consistency. Rates without a trustworthy denominator remain null. Assumption detection is a comparison to this test's allowlist, not a complete detector of all invented financial interpretations. Recorded controls have `modelAccuracy: null`.

## Future one-shot Groq experiment — not authorized by this document

`node --conditions=react-server scripts/ai-i2-live.mjs --dispatch-one` is intentionally unavailable unless the operator separately authorizes a single request and sets all existing local/free-plan/provider gates plus `FINGENCE_V2_I2_SINGLE_DISPATCH_AUTHORIZED=1` and `FINGENCE_V2_I2_QUOTA_REVIEW_CONFIRMED=1`. It uses only frozen `i01.csv`, an opaque runtime filename, strict 03B output, one attempt, the existing Groq provider and the **canonical shared** quota ledger; it refuses a missing, unsafe or per-worktree ledger. Do not create credentials or execute it without separate authorization. Review existing reserved/unknown dispatches before confirming the quota review; the existing ledger summary does not by itself certify that an earlier unknown request is safe to repeat. A timeout remains `DISPATCHED_UNKNOWN`; investigate rather than retry. The command does not automatically load an environment file or select a paid fallback.

Groq's [structured-output documentation](https://console.groq.com/docs/structured-outputs) lists `openai/gpt-oss-20b` for strict JSON schema. The [model page](https://console.groq.com/docs/model/openai/gpt-oss-20b) lists paid token rates; [rate limits](https://console.groq.com/docs/rate-limits) are account/plan dependent. Documentation is not proof that this account has free access. Immediately before a separately authorized request, verify effective Free Plan, model availability, retention settings and actual account limits; no provider-side billing guarantee is inferred from an environment flag. A genuine result must retain its receipt, request/usage, source hash, prompt/policy hash, error and verification outcomes, and must be scored separately from recorded controls.

### Local one-shot authorization safeguard

The one-shot CLI also requires `FINGENCE_V2_I2_AUTHORIZATION_ID` to name an existing, separately authorized UUID record in the canonical shared quota directory's owner-only `i2-authorizations` folder. The record is owner-only JSON containing exactly `version: "v2-i2-authorization-0.1"`, `id`, the frozen input `sourceSha256`, `provider: "LIVE_GROQ"`, `model: "openai/gpt-oss-20b"`, and a future `expiresAt` Unix timestamp in milliseconds. No command in this increment creates an authorization or a credential. A separately authorized operator must establish it after verifying the free plan and privacy settings.

Under the same quota lock used for reservation, a missing, malformed, expired, wrong-source or symlinked authorization fails closed. An existing RESERVED or UNKNOWN quota entry blocks dispatch. An owner-only create-exclusive consumed marker is flushed before the reservation is committed; it is not automatically removed on failure or restart. A failed write or crash can therefore consume permission without a request and requires investigation, not a retry. This local filesystem guard cannot attest human consent or defend against a malicious local account owner; it does not secure unrelated legacy provider entrypoints. Existing UNKNOWN records require a separately reviewed investigation/resolution procedure before a future request. Report storage is preflighted before dispatch, although later filesystem failure remains possible.

## Integration boundaries

P2 scoped queries and durable audits exist internally, but real session verification, membership and ownership are missing. V2-I1 storage remains synthetic-only and publication-ineligible. No new financial HTTP routes, chatbot, forecasting, reconciliation or connected reporting are claimed by this increment. Those workstreams continue on independent branches; existing illustrative dashboards remain labeled. Roles Finance, Technical (Management), and Admin require a separate reviewed authorization migration rather than equating them silently with the older role identifiers.
