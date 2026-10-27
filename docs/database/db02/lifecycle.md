# DB02.2 — current batch lifecycle contract

This documents established behavior, not a new lifecycle policy. No lifecycle migration is proposed.

| Operation | Established writer behavior | Database protection |
| --- | --- | --- |
| Create new batch | INSERT uses default PROCESSING within its transaction | Status domain, counters, FK and provenance checks |
| PROCESSING → ACTIVE | After accepted/issue recount, if accepted > 0; completed_at = clock_timestamp() | UPDATE requires current PROCESSING; writer requires exactly one updated row |
| PROCESSING → COMPLETED_EMPTY | Grouped writer allows accepted = 0, including all-rejected and zero-row datasets | Empty state requires valid_count = warning_count = 0 and completed_at non-NULL; received/rejected may be positive |
| Failure before acknowledged commit | Roll back parent attempt and all child batches/records/issues; no success receipt | Transaction atomicity/deferred constraints. No FAILED row is written outside rollback |
| Repeated completion | Predicate no longer matches; a writer expecting one row would fail | Native compare-and-set race gives one update with rowCount 1, the competing update 0 |
| Repeated committed attempt ID | Reject IDEMPOTENCY_UNSUPPORTED, no replay or automatic retry | Attempt PK and advisory fence |
| ACTIVE/SUPERSEDED/FAILED mutation | No general mutation API implemented | Row checks only; terminal immutability is not independently enforced |
| Supersession | Stored FK exists; current writer never automatically supersedes history | FK prevents dangling/self reference only; no cycle/replacement policy |

## Transition matrix

Legend: **W** = current writer implements this transition under the conditions above. **D** = SQL permits a shape-valid direct update, but an approved business transition has **not** been established. Repeated same-state updates are not an idempotent workflow contract.

| From \ To | PROCESSING | ACTIVE | SUPERSEDED | FAILED | COMPLETED_EMPTY |
| --- | --- | --- | --- | --- | --- |
| PROCESSING | D | W | D | D | W |
| ACTIVE | D | D | D | D | D |
| SUPERSEDED | D | D | D | D | D |
| FAILED | D | D | D | D | D |
| COMPLETED_EMPTY | D | D | D | D | D |

Both PGlite (25 independent cases) and native PostgreSQL (25 updates) demonstrate that all matrix cells are possible on zero-count, completed, otherwise valid direct-SQL rows. That does **not** mean ACTIVE with zero accepted rows is produced by the writer, or that reverting terminal statuses is approved. Values still must satisfy ordinary constraints. The matrix describes the absence of a SQL state machine, not a defect requiring invented transitions.

`completed_at >= created_at` is enforced when completion exists. ACTIVE itself does not require a completion timestamp; COMPLETED_EMPTY does. Existing writers populate completion for both successful outcomes. PROCESSING and FAILED are not durable job-progress/failure records in the existing write flow. A transaction that cannot confirm COMMIT/ROLLBACK reports an outcome classification and must be investigated; batch-list absence or a stored FAILED label is not a substitute for the primary/advisory-fence investigation.

## Decisions still required

- Celester + SAIC: legal edit, correction, reprocessing and activation transitions; whether terminal batches are immutable or use explicit revision transactions.
- Celester + SAIC: supersession direction, cycles/branching, multiple replacements, active population and whether superseding an empty attempt has distinct meaning.
- Celester + Jason/deployment owner: authorized lifecycle actors, durable audit, job/failure history and operational recovery procedures.
- Celester + Chia: verified-output identity and redelivery contract before introducing payload-bound idempotency or changing attempt/dataset identity.

No decision is silently inferred from the existence of an enum value. Unapproved transitions remain pending while independently established warning/atomicity safeguards are tested and corrected.
