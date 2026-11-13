# Add authorized saved GPT evidence to reconciliation

Adds GPT Matching Suggestions to the existing reconciliation page without changing totals, deterministic/E5 matching, ingestion or design. Shows saved suggestions, abstentions, source references and independent verification as UNRESOLVED. No invented scores or automatic approval.

The server-only GET composition requires an explicit owner-provided per-role permission policy (no default FINANCE/ADMIN/SUPERADMIN equivalence), then binds verified workspace identities to Jason's batch guard and durable audit-before-response, then the restricted DB04 evidence reader. Preserves tenant/actor checks, forced RLS and immutable evidence. No live Groq transport or financial-write route added.

**Activation blocked:** live GitHub main/teammate refs remain unchanged and supply no approved workspace-to-DB04 batch/job/capability mapping or restricted financial/audit runtime. The privileged workspace RPC store is not reused. gptWebsiteRuntime remains unavailable and local-only guards remain enabled; public demo remains synthetic. Requires Jason's approved session/audit handoff, Chia/Celester's authoritative identity/batch/job mapping and capability lifecycle, restricted group runtime configuration, then explicit audited activation approval. This is not an approval-only blocker.

Validation: current focused integration 6 passed + final API regression 8 passed = **14 passed / 0 failed / 0 skipped**. Historical isolated PostgreSQL and browser verification are documented separately and were not repeated. Browser successful-response states used clearly labelled synthetic fixtures; no Production end-to-end claim.

Changed implementation: shared GPT panel/DTO, panel mounts, saved-evidence GET composition, actor-bound persistence read, workspace principal adapter and focused/native tests. This final checkpoint changes only integration/PR documentation and local review artifacts. No Production writes, schema/credentials/config changes, Git push/merge or Vercel deployment. No PR published.

Exact files, owner deliverables, source refs and verification: docs/integration/db04-gpt-website-integration.md.


Latest hardening: removed implicit workspace-role translation; required immutable explicit owner permission policy before session-to-GPT composition. Changed-code tests: **8 passed / 0 failed / 0 skipped**; TypeScript, lint and server boundary passed. Prior suite counts above remain historical. Production policy, identity/job-capability mapping and restricted financial/audit runtime still missing; route remains disabled. No Production operations or privileged RPC calls.
