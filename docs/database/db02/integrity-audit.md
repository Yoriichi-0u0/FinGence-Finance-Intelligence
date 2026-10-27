# DB02.1 / DB02.3 — safeguard and enforcement inventory

Reviewed 27 October 2026 on `feature/backend-api-celester`, base commit `91b20ea0087951eee147eb0d9f0c4665f7d94fb5`. Sources are the actual SQL, persistence contracts/validator/mapper/repository/grouped service, PostgreSQL adapter, internal API query services and their tests. The untracked architecture review was **absent at this turn's initial inspection**; it was not recreated. The committed DB01 findings supplied historical context, not proof of a live hosted schema.

## Tables and relationships

| Object | Existing PostgreSQL protection | Scope / limit |
| --- | --- | --- |
| persistence_attempts | UUID PK; positive dataset_count; creation timestamp | Parent is inserted inside the group transaction. No durable failed-job ledger or independent child-cardinality constraint |
| ingestion_batches | UUID PK; unique (id, ingestion_batch_id); status domain; nonnegative counters; rows_received = valid_count + warning_count + rejected_count | Stored counters are checked within a row, not against child rows |
| Batch grouping | Nullable attempt FK with RESTRICT; paired attempt/dataset nullability; nonblank dataset ID; unique (attempt, producer, dataset, source_file) | Historical NULLs are intentional; ordinary UNIQUE permits NULL combinations. New grouped writer supplies a safe non-NULL filename |
| Supersession | Nullable self FK with RESTRICT; no self-reference | Does not prevent longer cycles, multiple replacements or define active-version semantics |
| financial_records | UUID PK; composite (batch_id, ingestion_batch_id) FK to batch with RESTRICT | Prevents wrong producer association. Does not assert an economic deduplication identity |
| validation_issues | UUID PK; record FK with RESTRICT; unique nonnegative record/ordinal pair; WARNING-only severity and category domain; constrained original-value JSON shape | Issue → record → batch is the relationship; there is no direct issue/batch FK or rejected-record table |
| Storage access | RLS enabled on all four tables; client role/PUBLIC revocations | Server-only deny-by-default foundation, not organizational tenancy/authentication. DB02 adds no policy or grants |

The clean foundation already embeds source-file support. Supported fresh chain: `phase1-clean-setup.sql` → `c3b1-grouped-persistence-upgrade.sql`. The alternative historical chain starts with `supabase/tests/fixtures/phase1-original-schema.sql`, then the source-file upgrade and grouped upgrade. **Do not apply the source-file upgrade over clean setup.** DB02-001 is appended to either completed chain. No previous SQL file was edited.

## Invariant and enforcement matrix

| Invariant | PostgreSQL | Application writer / validator | Verification |
| --- | --- | --- | --- |
| Accepted-only records | Status CHECK permits only VALID/WARNING | Rejects unsupported status, matches accepted normalized output to raw candidate/issue evidence; excludes rejected rows | Existing validator/repository regressions; new PGlite and native mixed accepted/rejected cases |
| VALID has no issues; WARNING has at least one | Existing deferred record/issue triggers at transaction end | Validates status/messages before writes; inserts ordered linked issues | Existing single-transaction checks; DB02 native race regression found and closes concurrency gap |
| Warning changes remain coherent across transactions | Previously vulnerable to write skew; DB02-001 writes identical-value parent tuple before each issue mutation | No new retry behavior | Native independent connections under READ COMMITTED, REPEATABLE READ and SERIALIZABLE; status-update/issue-insert race |
| Batch totals equal child population at initial commit | No cross-table total constraint | Recounts VALID/WARNING/accepted/issues and compares plan counts before completion | Existing count-mismatch rollback tests; native atomic mixed group |
| Totals remain equal after privileged mutations | Not guaranteed | No general mutation API exists | Read-only audit detects demonstrated counter drift. Future mutation/immutability contract pending |
| Attempt child count and completion evidence | Positive stored count, FK and composite child uniqueness only | Group creates all children atomically; investigation compares completed cardinality after a primary/fence check | Native different/same-ID writers and incomplete-evidence cases; audit detects privileged count change |
| Exact money, no NaN/infinities | Unbounded NUMERIC; finite-value checks on all monetary columns | Decimal-string validation, exact subtraction, pg NUMERIC text parser; no JS financial-number coercion | Existing mapping/adapter tests and native exact large amount; no monetary aggregate invented |
| NULL means unavailable | Nullable money/date/currency columns with basis checks | Explicit copying/DTO selection preserves NULL, not zero | Existing mapping/query regressions and native NULL balance assertion |
| Canonical date matches selected basis | TRANSACTION_DATE/POSTING_DATE domain and equality with non-NULL selected date | Strict ISO validation against producer context | Native invalid date-basis mutation rejected; existing mapping/query regressions preserve both source dates |
| Monetary basis is internally valid | Ledger requires debit/credit and exact net = debit-credit; source modes require amount and no derived net; directed source amount requires side and nonnegative amount | Validates exact canonical monetary contract | New native invalid-basis mutation plus existing ledger/direction tests |
| Currency availability is paired with origin | Both NULL or both non-NULL; origin domain | Preserves source/default origin | Native inconsistent origin mutation rejected; NULL currency existing tests |
| Safe filename / filename agreement | Safe basename checks; BEFORE triggers lock related parents and compare batch/record/issue names | Checks basename and raw/canonical provenance before writes | Existing filename tests; DB02 PGlite relation mutations rejected; native legacy/mutation path |
| Sheet/row/hash lineage | Positive row number and 64-hex hash shape; source columns; no uniqueness of coordinates | Validates file fingerprint, sheet, row ID/number, producer ID/time and candidate membership | New invalid shape checks; existing provenance tests. SQL does not reconstruct source-file content or prove hash authenticity |
| Group identity/repeated submissions | Attempt UUID PK; grouped composite unique | Preflight duplicates; advisory fence on attempt UUID; duplicate committed ID reports IDEMPOTENCY_UNSUPPORTED | Existing/native replay and concurrent same-ID cases |
| Commit/rollback atomicity | Transactions and deferred constraints | One checked-out connection; acknowledgment only after COMMIT; safe error classification/destruction | Real mid-record/mid-issue failures, deferred rejection, connection termination and lost-ack injection |

## Mutation boundaries

Deleting a referenced batch, attempt or financial record is rejected by RESTRICT (SQLSTATE `23001` in the tested engines); dangling inserted/updated FKs use `23503`. Deleting a WARNING record's last issue, assigning issues to VALID, or converting a WARNING with issues to VALID fails deferred checks. A coherent transaction may remove issues and their record, or reassign an issue while changing both statuses consistently; DB02 retains that ability. Such privileged mutations can still invalidate batch totals because the existing application has no general mutation/recount protocol.

DB02 intentionally does **not** make records immutable, automatically recalculate historical counts, globally deduplicate dataset IDs or introduce rejected evidence persistence. Those would add contracts beyond the current writer. [integrity-audit.sql](integrity-audit.sql) reports operational violations without changing data or summing money. Its native test starts with zero violations and detects deliberately introduced batch-count and attempt-cardinality drift.

The read services retain parameterized native date/UUID keyset predicates, explicit projections and accepted-only status filters. Warning summaries join issues through records. Trusted scope/audit adapters remain external; lifecycle visibility is their composition concern. DB02 changes neither SQL read patterns nor HTTP/security integration.
