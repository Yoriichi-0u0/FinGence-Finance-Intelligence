# Independent AI06 candidate verification

Start: 36ce0186908c9c2ecb33d85e0e8ba2cf7f248f4d. Work stays on
feature/db04-ai06-supabase-celester and Draft PR #57. No main/teammate branch,
Production database/authentication, Vercel setting or research artifact changed.

## Supported outcomes and boundaries

verifyRankings(token, processingId) authenticates Finance, resolves its tenant,
locks verification for that context, loads persisted fuzzy/E5 ranking rows and
independently reloads authoritative job sources and financial records inside the
same database transaction. No candidate-supplied amount, date or fingerprint is
used as financial authority. No model inference is called by verification.

The new db04-independent-proposals/1 contract reports record/source/context
checks, exact amount equality, currency, sign/direction, bank VALUE_DATE, ledger
POSTING_DATE, configured date policy, original raw signed amounts, raw bank
direction and ledger debit/credit evidence, and reference/counterparty identity.
It retains role-qualified record IDs, tenant, processing ID, fingerprints,
algorithm/version, financial policy version, named reasons and conflict evidence.
Exact money uses existing cashCents BigInt logic. The configured supported
same-day/two-day policy is loaded from the immutable job; no new tolerance or
similarity threshold is invented.

Financial eligibility is distinct from economic identity and financial approval.
All candidate outcomes remain UNRESOLVED until an explicit matching/assignment
policy is approved. Passing checks never posts a transaction or changes an old
deterministic decision. The necessary policy decision is precisely whether and
under which identity, uniqueness and assignment rules an eligible fuzzy/E5
candidate may be promoted to a verified suggestion. No accuracy/recall claim is
made by this implementation.

Conflict evidence covers multiple partners for either side, fuzzy/E5 competition,
same-algorithm duplicate pairs, conflicts with deterministic verified assignments
and pairs already covered deterministically. Equal scores never choose a winner;
scores are ignored for financial verification. Group/partial structures and
unknown algorithm/lineage remain unresolved. Cross-method corroboration of the
same pair is not counted as two assignments. No assignment is created at all.

## Additive persistence and concurrency

Schema inspection established that deterministic proposals allow only cash-rules-v1,
their decisions are immutable and ordinal-bound, and ranking evidence is immutable.
They cannot represent repeatable multi-algorithm verification snapshots without
rewriting history. Therefore db04-004-proposal-verification.sql adds only
proposal_verifications with tenant/job/member FKs, forced RLS, actor-bound inserts,
append-only triggers and SELECT/INSERT grants using the existing security functions.
Original tables and migrations are unchanged.

Snapshot SHA256 binds the complete ordered persisted ranking set. The unique
tenant/context/snapshot/policy key and transaction advisory fence make concurrent
and repeated verification return one immutable result. If another algorithm is
added later, a new snapshot preserves the old evidence. A READ audit accompanies
delivery; the verification row itself supplies immutable actor/time/policy action
traceability. Audit failure rolls back the inserted snapshot. Uncertain commits
retain existing adapter semantics and are never retried automatically.

The database constrains both the snapshot outcome and every nested candidate
outcome to UNRESOLVED. This is deliberately stronger than permitting competing
verified assignments: no new verified assignment is representable under this
unapproved policy. A future promotion policy requires a separately reviewed
migration with actual assignment constraints, not merely application code changes.

Protected GET adds proposalVerifications without duplicating financial queries.
Older installations without migration 004 remain readable. The local-only
Reconciliation evidence panel distinguishes fuzzy ranking proposals, E5 ranking
proposals, financial eligibility, unresolved candidate outcomes and conflict reason
codes. Existing deterministic suggestions remain separate. No new public route,
model-dispatch control or Production dashboard behavior was introduced.

## Verification and evidence

Relevant regression run with real E5 enabled: 616 passed, 0 failed, 10 existing
skips (outputs/db04-ai06/independent-verification.json). Final focused run: 71
passed, 0 failed, 0 skipped, including 25 native PostgreSQL tests, recorded in
proposal-verification-final.json; runs overlap
and must not be summed. Typecheck, focused lint and server-boundary checks passed.
Previous full-project baseline failures remain disclosed; full suite not rerun.

Coverage includes authoritative-versus-forged ranking values, monetary/currency/
direction/date/source/context contradictions, duplicates, cross-algorithm conflicts,
deterministic protection, real persisted E5 eligibility, concurrent/repeated
verification, rollback on audit failure, restricted-role RLS, immutable evidence,
database rejection of approved outcomes, protected POST/GET live compatibility,
and rendered evidence labels. E5 rankings are reused, not recomputed by verification.
No browser-click automation or hosted Supabase testing was executed.
