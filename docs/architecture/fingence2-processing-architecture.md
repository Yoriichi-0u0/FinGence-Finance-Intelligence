# FinGence 2.0 processing architecture — Phase 2 and Phase 3 contracts

Phase 1 ships a browser runner (`browserDemoRunner`) behind the `ProcessingRunner` interface in
`lib/demo/pipeline.ts`. This note defines what a backend job system must provide to replace it
for real data, without changing what the pages consume.

## Principles

1. **Immutable inputs.** A document is identified by the SHA-256 of its exact bytes. It is
   stored once per tenant and never edited; corrections arrive as new documents.
2. **Automated verification is mandatory; manual verification is exceptional.** A result becomes
   a fact only after independent checks pass under configured accounting rules. Anything
   ambiguous, inconsistent, missing or unsupported is quarantined with its evidence. Human review
   handles quarantine; it is not a routine approval step.
3. **One processing context per run.** Every derived result names the processing ID, scope and
   source fingerprints it came from. Pages never mix contexts or substitute sample data.
4. **No silent promotion of model output.** A model may *propose* a role, mapping or convention.
   The proposal is evidence; acceptance requires the same independent verification as rules.
   V2 records are never cast to C1 or other authoritative formats without a verified adapter.

## Contracts

### Job and stage transitions

```
ProcessingJob { jobId, tenantId, processingId, pipelineVersion, inputs: SourceRef[],
                state: QUEUED | RUNNING | COMPLETED | COMPLETED_WITH_EXCEPTIONS | QUARANTINED | FAILED | SUPERSEDED,
                stages: StageRecord[], createdBy, createdAt, finishedAt }
StageRecord   { id: IDENTIFY | EXTRACT | INTERPRET | VERIFY | RECONCILE | ANALYZE | FORECAST | REPORT,
                state: PENDING | RUNNING | DONE | SKIPPED, decision: AUTO_ACCEPTED | QUARANTINED | UNAVAILABLE,
                method, checks: Check[], startedAt, finishedAt, outputRefs: OutputRef[] }
```
Transitions are append-only; a stage runs only when its inputs are AUTO_ACCEPTED. A failed stage
stops its dependants, records the reason and leaves earlier accepted outputs intact.

### Source identity
`SourceRef { sha256, bytes, mediaType, originalName, uploadedBy, uploadedAt, tenantId, provenance }`
Storage is content-addressed per tenant. Re-uploading identical bytes returns the same SourceRef.

### Interpretation evidence
`Interpretation { sourceSha256, role, schemaSignature, columnMappings[], conventions[],
method: RULES | MODEL_PROPOSAL, model?: { provider, model, promptHash, responseHash },
confidence: { score, basis }, decision }`. A model proposal with high confidence is still only
accepted when VERIFY passes. The accepted interpretation is versioned and immutable.

### Validation gates
`Check { id, label, passed, expected, observed, evidenceRefs[] }`. Required before acceptance:
row count and identity agreement between two independent readers; control totals in exact cents;
sign/convention checks per row; scope agreement across paired documents; cross-document
consistency (for example statement month equals the history month). Gates are configuration,
versioned with the pipeline.

### Canonical records and quarantine
`AcceptedRecord { recordId, sourceSha256, csvRecord, fields, interpretationVersion }` — only from
AUTO_ACCEPTED sources. `QuarantineItem { kind, reference, status, reason, evidenceRefs, openedAt,
resolution?: { decision, rationale, decidedBy, decidedAt } }`. Resolutions annotate; they never
rewrite the original outcome (as in the existing reconciliation review history).

### Source-scoped derived results
Reconciliation, analytics, anomaly, forecast and report outputs are keyed by
`(tenantId, processingId)` and carry their scope and source fingerprints, exactly like
`FinancePoCReconciliationV1` today. Readers must check the binding (tenant, scope, every source
SHA) before quoting a figure.

### Idempotent reprocessing and invalidation
`processingId = H(pipelineVersion, sorted accepted role:sha256 pairs)`. Re-running the same
inputs and version returns the existing job. A new pipeline version, a new or replaced source,
or a changed gate configuration creates a new processing ID and marks dependants of the old one
SUPERSEDED; superseded results stay readable for audit but are never shown as current.

### Lineage and audit
Every output stores `lineage: { processingId, stageId, inputRefs[], method, version }`. Every job
transition, acceptance, quarantine and resolution writes an audit event in the same transaction
as the change (as the M5 tenant administration does).

## Backlog

**Phase 2 (Project B start):** backend `ProcessingRunner` on the M5 local stack (tenant-scoped
job table, content-addressed sources, stage records, audit); the pages read contexts from an
authorized API instead of browser storage; quarantine inbox reusing the reconciliation review
history; ledger CategoryLabel-backed classification so revenue/expense views become defensible;
the localhost guest harness, if still needed.

**Phase 3:** model-assisted role and schema proposals (Groq or other provider, separately
authorized) recorded as `MODEL_PROPOSAL` evidence and accepted only through VERIFY; more document
types (PDF/XLSX statements via the C1 readers); multi-month and multi-business processing;
hosted persistence with real authentication, RLS and Production data controls; benchmark suite
against the capstone success criteria (reconciliation accuracy, report cycle time, forecast
variance, anomaly precision).
