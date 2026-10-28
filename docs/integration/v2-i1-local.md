# V2-I1 local experimental processing

FinGence 2.0 target: upload → process → results → questions. This increment adds a **local synthetic-only** vertical slice, not production financial publication, real application authentication, a hosted API, a durable worker, or a chatbot. Experimental outcomes are not accounting approval. C1/C2, P2 and the independent verifier remain separate.

## Pipeline and evidence

The local API checks a high-entropy local capability, development mode, loopback/same-origin and the absence of Vercel. The job accepts only bytes registered in the existing synthetic manifests. It extracts using the existing four-format extractor, attempts reuse of a fully verified recorded synthetic template, rebinds fresh evidence and independently verifies it. No model request is sent by this path. If reuse fails, rows remain unresolved. `RECORDED_TEST` identifies the template's origin, not live inference or model accuracy.

The trusted `verified-document-batch-v1` server contract is built from a server-extractor snapshot and a blueprint, not from a browser-provided verification claim. It verifies that the uploaded bytes match the source hash, reruns the verifier and snapshots the result. Extractor output still needs evaluation: these checks cannot independently prove that arbitrary OCR text matches a document. It stores the actual source hash, available source evidence, policy version/hash, outcome provenance, statuses and independent checks. `publicationEligible` is always false. An extraction failure or unestablished source-row count stores a document-level quarantine without inventing rows or coordinates. Accepted, rejected and unresolved outcomes are stored separately; unresolved is never counted as rejected. The schema `supabase/sql/v2-verified-document-local.sql` is **for disposable local databases only**.

Local attempts and outcomes are inserted in one transaction. Record outcomes and document quarantine are distinct: the document quarantine is stored on the attempt, never counted as an observed financial record. Attempt IDs are allocated before persistence, duplicate IDs are refused, uncertain results are not automatically retried, and investigation uses the authoritative database and an advisory-lock fence. Confirmed failures and duplicate attempts are not eligible for uncertain-outcome investigation; unknown commit, unconfirmed rollback and unclassified errors retain the attempt ID and require conservative investigation. Synthetic tenant isolation is tied to the local capability. This does not implement membership, real tenant authorization or production audit controls.

The corrected demonstration uses a new file-backed PGlite database under the ignored `.local/v2-i1-database-v4` directory. Prior experimental databases are left untouched; their previously stored outcomes are not automatically migrated. A clean close and reopen retains committed synthetic outcomes; crash recovery and concurrent multi-process use are not established. This is not a crash-recoverable job queue or a native PostgreSQL concurrency proof. Statuses represent completed stages and are returned after the job; they are not streamed progress. The HTTP investigation allowlist is in memory, so it cannot investigate an uncertain attempt after a server restart.

## Run locally

Use Node 24 and pnpm 11.19.0. Install existing pinned dependencies and configure the offline Python/OCR worker from `docs/ai-ingestion/workspace.md`. Do not enable or dispatch a provider.

```bash
mkdir -p .local
umask 077
openssl rand -hex 32 > .local/v2-i1-capability
export FINGENCE_V2_I1_TOKEN="$(cat .local/v2-i1-capability)"
export FINGENCE_AI_LOCAL=1 FINGENCE_V2_I1_LOCAL=1
pnpm dev --hostname 127.0.0.1 --port 3103
```

Open `http://127.0.0.1:3103/ai-ingestion/v2-i1`, enter the local capability privately and upload a registered synthetic document. Do not put the capability in chat, URLs, Git or logs. The capability is a local demo gate, not a user identity, organization membership or production authentication. Rotating it changes the synthetic tenant and makes previous local records unavailable. With the included recorded template, supported structures may be verified; other structures remain quarantined. Results are experimental and no live AI accuracy can be inferred.

## Current limits and next workstreams

- The existing extraction limits apply: 10 MiB, at most four pages/worksheets and 50 observed rows; model and OCR scores are not financial acceptance authority.
- The internal `runAuthorizedModelJob` path reuses the Increment 03 provider and quota controls and requires its existing gates plus `FINGENCE_V2_I1_LIVE_DISPATCH_AUTHORIZED=1`. No HTTP route invokes it. A new provider request requires separate explicit authorization; V2-I1 verification did not dispatch one.
- Jason and Celester: real authentication, the Finance / Technical (Management) / Admin role migration, tenant ownership, database grants and durable auditing.
- Jason, Frederick and Chia: authorized retrieval and evidence-linked, independently checked chatbot answers. No arbitrary SQL or invented financial totals.
- Frederick, Celester and Izzat: evaluated reconciliation, anomalies, forecasting and reports grounded in persisted verified records. Existing illustrative pages are not evidence of those capabilities.
- Chia and Celester: a reviewed production persistence contract, native PostgreSQL tests, actual crash recovery and policy/financial-publication eligibility. V2 outcomes must not be cast into C1/C2.

No hosted migration, financial endpoint, real data, model download or provider dispatch is authorized by this document.
