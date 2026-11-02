# Supabase continuation: access dependency

Starting commit: d667d72d4f9b2dd9cf8c1ff3d6b0a194b5c2fbb2.

No Supabase connector, CLI, connection environment variables or .env files are
available in this worktree. FYP A development-branch availability, approval and
project reference remain unverified. No hosted connection was attempted, no
hosted migration ran and no hosted write/read evidence exists. Production was
not contacted or modified. Supabase integration is not complete.

`inspectReconciliationPrerequisites` is an internal catalog-only read service.
It sets its transaction READ ONLY before inspecting database/role identity,
M2/M3 prerequisite existence and reconciliation table RLS flags. It never
authorizes writes, bootstraps identity, installs migrations or exposes an HTTP
route. It reuses the existing TransactionDatabase adapter. Existence checks are
only an initial diagnostic, not proof of complete migration compatibility.

The existing pg adapter retains certificate verification, bounded pooling,
cleanup and uncertain-commit behavior unchanged. The older Phase 2 target guard
permits an explicitly opted-in FYP A postgres connection; it is not evidence of
nonproduction isolation and must not be used to authorize this milestone.

DB04 prerequisites remain v2-verified-document-local, v2-m2-local and
v2-m3-local, followed by db04-001 and db04-002. These are LOCAL identity/security
schemas, not approved hosted bootstrap migrations. Do not install them on a
hosted target without reviewing ownership, auth and role privileges. Optional
M5 suspension checks do not make local sessions hosted identities.

Required access: an approved isolated Supabase branch or separate development
project; exact project/branch reference and isolation evidence; securely supplied
connection configuration; approved migration and restricted runtime identities;
and Jason's reviewed hosted identity boundary. Credentials must not be pasted
into chat. Before writes, independently verify target host/database/role and
prerequisite definitions. An environment variable name is not approval.

Executed continuation tests: 33 passed, 0 failed, 0 skipped, including the existing
18 native disposable PostgreSQL tests and one new PGlite catalog-preflight test.
PGlite is not hosted Supabase evidence. Typecheck and focused ESLint pass.
Raw report: outputs/db04-ai06/continuation-tests.json. Earlier evidence is retained;
the earlier full-project run still has 30 failures also reproduced on main.

AI06 deterministic proposals and the internal authorized retrieval service remain
unchanged. Fuzzy/E5 integration, hosted identity and dashboard HTTP activation are
not claimed or enabled by this diagnostic increment.
