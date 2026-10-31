# AI05 limitations and integration decisions

The official frozen experiment is complete. Its conclusions apply to 100 authored synthetic records across four unseen source schemas, with 32 genuine pairs, rather than real SAIC documents or a random production sample. No statistical significance, confidence interval or aspirational project-wide accuracy achievement is claimed.

E5 produces 18 true and two explicit false raw suggestions, compared with fuzzy matching's 16 true/zero false. Its raw economic F1 is higher in this small sample, but its precision and operational behavior are worse. Following the unchanged conservative AI04 policy, all three pipelines retain the same eight true suggestions. Final recall is 25%, bank coverage 16% and assessed precision 8/8; 42 bank records remain unresolved. E5 does not establish a final verified recall/coverage advantage.

Both additional genuine E5 matches over fuzzy are withheld. Strong semantic similarity is not independent evidence of transaction identity, and economic ground truth cannot authorize a suggestion whose operational evidence is insufficient. The frozen policy deliberately withholds financially plausible competing partners even where reference evidence may appear stronger. Improving this tradeoff requires a separately versioned, reviewed future experiment, not changing this official result.

The compatibility adapter adds held-out authorization only and preserves source split identities, financial rules, ranking, thresholds and AI04 policy. Existing guards remain unchanged. Its orchestration necessarily composes the old functions because the old public entry points reject heldout. Source hashes, historical parity tests and independent audits substantiate compatibility; they are not a formal proof for every possible future dataset.

The label boundary is a software module/process protocol, not OS-enforced secrecy. Predictions are sealed before the isolated evaluator loads labels. The official result is now observed; this same held-out split must not be reused to tune a successor while claiming another untouched final test. A later research improvement needs a new version and a defensible validation/test protocol.

Production dependencies remain unresolved:

- SAIC-approved account-specific debit/credit, monetary and canonical-date conventions. The two-day window is a synthetic research default.
- Trusted source provenance, authenticated source identity and account-to-account reconciliation scope. Synthetic template consistency does not authenticate external documents.
- Producer V2 eligibility and immutable source-revision contracts; legacy VALID/WARNING is not equivalent to approved reconciliation eligibility.
- Reference/counterparty authority and approved handling of missing references, alternate entity spellings and genuine ambiguity.
- Explicit support and review rules for groups and partial payments; this pipeline does not aggregate them.
- Approval authority, access controls, audit/lifecycle semantics and idempotency for any future persistence/API design. A suggestion is not confirmation or posting.

No production DB schema, migration, ingestion, security, API, frontend, reporting or teammate module changed. No hosted Supabase, external inference or production environment access occurred. AI06/AI07 and DB04 were not started.

Performance is local and conditional: fresh worker hashing/loading can use a warm OS file cache; cached E5 replays do no inference. Seven warm samples yield only a coarse p50/p95, and one first-run observation cannot establish cold percentiles. Sampled worker RSS excludes unobserved transient/system peaks. The JS heap limit is not a native ONNX memory cap. Resource measurements do not establish production RPO/RTO, throughput or concurrency guarantees.
