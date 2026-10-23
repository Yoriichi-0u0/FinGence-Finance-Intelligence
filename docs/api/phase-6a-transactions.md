# Phase 6A — Transaction API contract foundation

**Status:** Internal contract only. No HTTP endpoint, production query, authentication, audit sink, or deployment.

**Repository:** `Yoriichi-0u0/FinGence-Finance-Intelligence`
**Feature branch:** `feature/backend-api-celester`

## Scope delivered

- `lib/server/api/transaction-contract.ts`: bounded allowlisted `limit`, `cursor`, `date_from`, `date_to`, `batch_id`, `status`, `currency`, `monetary_basis` request parser.
- Validated minimal transaction response DTO; exact PostgreSQL monetary strings and `null` preserved. `VALID` and `WARNING` only; `REJECTED` never appears in accepted transaction projection.
- `tests/api/transaction-contract.test.ts`: synthetic-only request and projection tests, including invalid inputs, missing fields, dates, decimal precision, leading-zero identifiers, and suppression of extra sensitive database fields.

This code **does not** grant anyone permission to retrieve records. The cursor is untrusted text; a future endpoint must verify its provenance and bind it to the caller, organization and filters before use.

## Blockers before exposing `GET /api/v1/transactions`

1. **Jason:** Verify tokens/sessions and define trusted organization membership source; confirm explicit transaction collection permission, including Analyst-only access. Neither Admin nor Reviewer receives routine raw transaction access.
2. **Backend + Jason:** Resolve record/batch ownership and organization from a trusted source. The current stored financial tables lack organization scoping, so a mere client-provided `batch_id` or role is insufficient.
3. **Backend + Jason:** Implement a protected durable security audit sink. Required audit persistence must succeed before a sensitive response is returned.
4. **Backend:** Parameterized PostgreSQL query and stable keyset pagination (`canonical_date DESC, id DESC`) using verified filter-bound cursors. This is not implemented.
5. **Team:** Confirm DTO, data retention and security requirements, and review locally tested changes before merging. Hosted SQL migrations require separate approval.

## Local verification

Initial isolated verification used TypeScript 5.8.3 and 15 standalone runtime checks. Repository verification on 23 October 2026 uses Node 24.14.1 and pnpm 11.19.0; see the review below. Commands:

```bash
corepack pnpm exec vitest run tests/api/transaction-contract.test.ts
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm check:server-boundary
```

No hosted database was accessed or modified.

## 23 October 2026 contract review

Fetched origin and verified `feature/backend-api-celester` is current at `9dcc25a` before local changes. No route was added.

- Preserve nullable `entry_side` in the DTO: direction-based amounts are ambiguous without DEBIT/CREDIT. Do not reinterpret their sign.
- Require a primitive monetary-basis string; coercible objects must fail validation.
- Preserve negative-zero decimal strings for direction-based amounts, matching the existing persistence validator. Negative nonzero directed amounts remain invalid.
- Include the API contract in server-only guard verification and add regression cases for these boundaries.
- Pin only the two byte-verified synthetic JSON fixtures to LF via `.gitattributes`. Windows CRLF checkout conversion initially caused fixture-integrity and handoff-export failures; restoring committed bytes resolved both without weakening tests or changing financial content.

Verification: transaction contract **45 passed**; TypeScript **passed**; full suite **465 passed, 1 skipped** (optional supplied workbook); server-boundary verification **passed**. Lint **passed**.

### Recommended implementation sequence

Agree the trusted security interfaces with Jason before adding a route: verified session/token identity (including expiry and trusted issuer/audience), active organization membership and server-assigned role, explicit transaction-collection permission, and protected durable audit persistence. The existing policy grants per-record reads; it does not define a collection resource or authorize listing through a fabricated record ID. Administrator exceptions are record-specific and must not become collection grants. Admin and Reviewer have no routine raw transaction access.

Design a trusted persisted organization/ownership mapping for batches and records, including treatment of historical unmapped rows (deny access). Existing RLS/client revocations do not provide organization isolation for privileged server queries. Scope every query and batch lookup to verified membership; a client batch UUID or organization header is never authority. Prepare and test any schema proposal locally; hosted migration approval is separate.

Define collection audit action/target semantics, denial events, bounded identifiers and request correlation. Await protected durable audit acknowledgement before releasing a sensitive page; audit failure must prevent release. Never log financial contents, tokens, cursors or raw errors. The current audit constructor does not persist anything.

Then implement an injected, locally tested query service with parameterized filters, explicit VALID/WARNING predicates, dates and NUMERIC values as text, and stable `(canonical_date DESC, id DESC)` pagination. Authenticate integrity-protected cursors bound to caller, organization and filters before using them. Confirm the response envelope, next-page behavior and reporting population/lifecycle policy before implementing HTTP transport. Preserve NULLs, malformed-but-accepted warning currency values, decimal strings and separate source dates.

Route integration must test missing/invalid/expired identity, revoked membership, cross-organization batch/cursor access, Analyst allow versus Admin/Reviewer deny, audit failure, equal-date pagination, filter tampering, exact decimals, NULL and REJECTED exclusion. Return sensitive responses with private/no-store caching and sanitized errors. No deployment or hosted access is authorized by this review.
