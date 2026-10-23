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

The contract source was checked with TypeScript 5.8.3 in an isolated environment and 15 standalone runtime checks passed. **The repository's pnpm/Vitest suite was not run in this environment.** Run in a proper checkout with Node 24 and pnpm 11:

```bash
corepack pnpm exec vitest run tests/api/transaction-contract.test.ts
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm check:server-boundary
```

No hosted database was accessed or modified.
