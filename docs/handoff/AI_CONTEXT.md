# FinGence — SAIC integration candidate, 15 October 2026

The verified application candidate mirrors shared integration commit `b2b1f3b` without replacing personal Git history. See [current integration status, ownership and verification](../releases/saic-2026-10-16/README.md). Shared-main release remains gated on non-author team approval and passing checks; no production deployment is implied by this candidate. Historical ingestion verification and all C1/C2 checkpoints remain intact.

# FinGence ingestion — AI context

Read this before modifying or consuming Chia's ingestion layer. It is an orientation map: follow the linked source/architecture/tests for authoritative definitions rather than treating this as a second schema.

## Default consumer path

**Default downstream input: accepted canonical records.**

```text
Public TypeScript route: consolidate(results).normalized
JSON evidence route:   datasets[].normalized
Do NOT use by default: datasets[].records (or IngestionResult.records)
```

`normalized` includes **VALID and WARNING** records with messages and provenance. `records` includes raw/staging evidence, partial candidates and **REJECTED** rows. Never forward rejected candidates as analysis input by default. Acceptance proves provisional ingestion eligibility, not client accounting accuracy or model readiness.

**C1 projection:** `createAcceptedDataPayload(results).datasets[].normalized`. Retain its envelope versions and shared dataset context when consuming these projected rows. They are not standalone full `CanonicalTransaction` objects. The [accepted-data contract](../ingestion/accepted-data-contract.md) is authoritative for this projection; the full evidence export remains a separate technical report.

## Identity, state and ownership

Topic 21 — Finance Intelligence; COS40005 Project A/Sprint 1; product **FinGence** (Finance + Intelligence); client **Sarawak Artificial Intelligence Centre (SAIC)**; personal repository `Yoriichi-0u0/FinGence-Finance-Intelligence`; local directory `FinGence`; Chia owns ingestion/consolidation. The official academic title remains **Finance Intelligence: AI-Driven Financial Analysis and Automated Reporting**.

**FinGence Branding — IMPLEMENTED / INDEPENDENTLY REVIEWED — 12 October 2026**

Current product-facing names and logo use FinGence. Earlier FinSight/directory names in dated evidence remain historical. Preserve package names, `FINSIGHT_*` test variables, checkpoint tags and ingestion identifiers.

The local branding implementation has passed review. Branding has not been deployed to production; the existing Vercel deployment remains on C2 until an authorized release. C1/C2 contracts and historical verification remain unchanged. The three modified synthetic files remain protected in the external backup and unapplied stash. No further Git-worktree or directory changes are required.

**IMPLEMENTED / AVAILABLE IN CURRENT WORKING TREE — checked 2 October 2026:** reusable TypeScript engine plus browser-memory Data-page PoC; A1/A2 handoffs and consumption example. At verification it remains an uncommitted local working tree on `feature/data-ingestion`. Check Git status, actual files and tests; do not infer shared availability from a branch name. This is a dated snapshot, not a permanent assertion that the project is uncommitted.

**C1 — IMPLEMENTED / INDEPENDENTLY REVIEWED — 5 October 2026:** additive accepted-data adapter/types, tests and example, starting from committed `ingestion-ux-v0.1` (`59a4d30`) on `feature/ingestion-integration-contract`. It changes no engine semantics, UI, dependencies or existing exporters. Do not infer external API availability from this local implementation.

**C2 — IMPLEMENTED / INDEPENDENTLY REVIEWED — 7 October 2026:** public `ingestDatasetRun` creates execution context at the Data-page check boundary. It changes no canonical/ruleset/C1 fields, financial semantics or serializers and implements no backend lifecycle.

**PROVISIONAL:** canonical schema/ruleset `0.1` and client-dependent conventions. **FUTURE:** backend/database/API, AI, reconciliation and dashboard integration. Other application pages remain mock-driven; uploaded data does not populate them.

The requirements supplied for C1 confirm: Chia owns ingestion/structural consolidation and ingestion batch identity; Celester owns persistence/permanent IDs/API, lifecycle/supersession, reconciliation and backend dashboard summaries; Frederick owns interpretation/aggregation/features and analysis-specific warning eligibility; Jason owns production security/trust-boundary/access/audit requirements; Izzat owns dashboard/API visualization. VALID/WARNING remain accepted and rejected evidence stays separate. Describe these boundaries; do not implement their modules. **Consolidation is not reconciliation.**

## Sources of truth and file map

| Read | Purpose |
| --- | --- |
| [models.ts](../../lib/ingestion/models.ts) | Actual types, defaults, versions and provenance structures |
| [architecture.md](../ingestion/architecture.md) | Financial semantics, rules, metrics, limits and change policy |
| [index.ts](../../lib/ingestion/index.ts) | Public engine imports; internal module map is in architecture |
| [run.ts](../../lib/ingestion/run.ts) and [lifecycle tests](../../tests/ingestion/ingestion-run.test.ts) | React-independent new-execution wrapper; injected ID/time providers and failure/retry boundaries |
| [consume.ts](../../examples/ingestion/consume.ts) | React-independent, version-gated synchronous visitor recipe |
| [accepted-data.ts](../../lib/ingestion/accepted-data.ts) and [contract](../ingestion/accepted-data-contract.md) | Pure, explicitly version-pinned accepted transport projection |
| [accepted-data example](../../examples/ingestion/accepted-data.ts) and [tests](../../tests/ingestion/accepted-data.test.ts) | Public consumption, reconstructed lineage, precise fields and exclusions |
| [handoff.test.ts](../../tests/ingestion/handoff.test.ts) and [existing tests](../../tests/ingestion/) | Executable behavior and independently specified fixture checks |
| [README](../../README.md), [demo](../ingestion/demo.md), [verification](../ingestion/verification.md) | Run commands, unchanged UI flow and measured checks |

`app/data/page.tsx` and `components/ingestion/` are UI/session orchestration, not downstream integration APIs. Engine imports must not flow through them. Reuse `lib/ingestion/index.ts`; do not reparse CSV/XLSX in Fred's module. A Node consumer can use the TypeScript engine; another language uses agreed JSON semantics, not a direct TypeScript import.

Node file adapters can pass `readFileSync(path)` directly to `inspectFile`; consumers need not copy Buffer input manually. The reader owns exactly the supplied Uint8Array view before hashing, CSV decoding and XLSX inspection/parsing, including sliced or pooled Node Buffers. The [reader regressions](../../tests/ingestion/readers-buffer.test.ts) exercise both Buffer and ordinary Uint8Array views with unrelated surrounding bytes. The handoff fixture loader passes direct Buffers and independently compares SHA-256 against the file bytes.

Earlier academic planning deliverables include proposed signed-cash, VALID-only and persistence conventions that predate the current implementation. They remain historical documents. Do not silently edit them or substitute those proposals for the source/architecture/tests.

## Invariants and compatibility

- Preserve separate source transaction/posting dates and explicit canonical date/basis; no silent date substitution.
- Preserve money as decimal strings and identifiers as text. No floating-point coercion, universal sign reinterpretation, mixed-source monetary totals or currency conversion. Ledger-derived net remains explicitly ledger-specific.
- Keep warning messages, source coordinates, hashes, batch/time lineage, currency origin and approved transformations. Source row IDs are not persistent database IDs or economic deduplication keys.
- Keep deterministic exact/alias/normalized-name suggestions, manual overrides and explicit mapping/convention approval. Do not introduce fuzzy/LLM/embedding mapping or manufacture approval to bypass review.
- The consumer recipe intentionally supports schema/ruleset `0.1` independently. It checks **every supplied result before consolidation and before visiting any record**, including results that would be replaced. Update compatibility only after reviewing changes; do not auto-adopt producer constants.
- Existing evidence-JSON consumers must check the envelope and each dataset version before visiting accepted rows. C1 preflights all input versions, then delegates replacement/order to existing `consolidate().results`; never reimplement last-result-wins. Its envelope carries the checked versions for all projected datasets. Both recipes trust engine-produced objects; neither provides arbitrary JSON/security validation. External API/versioning/JSON Schema remain future work.
- C1 explicitly selects fields: no full raw/staging/candidate/mapping/options/rejected objects, derived ledger net, backend IDs or model-eligibility flags. Original warning/transformation scalar values are permitted and sensitive. Preserve filenames exactly according to existing ingestion output; apply no new filename normalization.
- Use `ingestDatasetRun` only for a new attempted ingestion execution after approval. It requests a new UUID/time pair on each call; a returned result, including an all-rejected result, preserves it. A throw returns no result and may consume unused context; a retry gets another pair. Injected `idFactory` providers must return fresh values. Direct `ingestDataset` callers can still supply context and must manage its freshness themselves.
- Reopening/inspecting an existing result, C1 projection, consolidation and downloads must reuse existing context; do not execute ingestion or generate IDs for those operations. C1 stays pure and preserves IDs/timestamps. Backend owns persistence/supersession and logical replacement association for changed files; none is implemented here.
- Browser-memory processing, session deduplication and parsed source evidence are PoC limits, not a final persistence/security architecture. An approval flag is not proof of authorized server-side ingestion.
- The example uses synchronous visitors and performs no network/storage operations. A callback must treat records as read-only; callback failures are not rolled back and async publishing is not implemented.

## Synthetic example and verification

**SYNTHETIC EXAMPLE · NOT CLIENT DATA · NOT A PRODUCTION API CONTRACT:** [engine-generated evidence JSON](examples/ingestion-evidence.json). Generated from controlled public consultation fixtures with Details → reference correction, batch ID `synthetic-handoff-example-batch-001`, and fixed UTC instant `2026-10-02T00:00:00.000Z`. No label-only metadata is inserted and no lineage field is repurposed for disclaimers.

Expected observation: **26 processed; 23 visited = 20 VALID + 3 WARNING; 0 REJECTED visited**. Rejected evidence remains in the separate `records` arrays. Read relevant accepted/evidence sections; the entire audit export is not the proposed production transport.

```bash
pnpm test tests/ingestion/handoff.test.ts
```

This checks actual visited IDs/statuses and warnings/lineage, compatibility before side effects, strings/date semantics, replacement behavior, and byte equality to the exporter plus a final newline. Independent fixture counts/examples are checked before comparison. Authoring-only regeneration uses `FINSIGHT_REGENERATE_HANDOFF_EXAMPLE=1 pnpm test tests/ingestion/handoff.test.ts`; normal tests never rewrite the example. Full commands/results are in README/verification. The supplied 6,000-row workbook is optional; labels/ground-truth sheets are not transaction input or measured model accuracy.

## Task boundaries and unresolved decisions

Do not change other feature pages, shared mock finance modules, production/configuration/environment files, dependencies, formal university submissions, or other members' code for ingestion work. Do not add backend persistence, forecasting, reconciliation, authentication, integrations or UX redesign as incidental improvements. If a requested task requires a financial contract change, use the architecture change policy and identify affected consumers first.

**REQUIRES TEAM CONFIRMATION:** external transport versioning, backend batch scope, changed-file replacement association and separate evidence retention/retrieval details. C1 remains a provisional local boundary, not a finished backend integration. **REQUIRES CLIENT CONFIRMATION:** actual source conventions, required fields/date basis/currencies, exception policies and retention. Preserve source meaning and flag unknowns rather than inventing answers. Security/privacy guarantees remain limited to architecture's PoC controls. Future externally received payloads require independent backend validation and access control; audit actions/relevant IDs, not complete transaction contents. Do not claim TypeScript types implement runtime validation or RBAC.

Suggested cross-tool instruction: “Read `docs/handoff/AI_CONTEXT.md`, inspect the current checkout and linked contract/tests, then identify the integration boundary owned by this task before changing FinGence ingestion.”
