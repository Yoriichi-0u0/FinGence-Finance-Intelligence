<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Ingestion handoff

Before editing or consuming FinGence, read the single current technical entrypoint:
[docs/handoff/CURRENT.md](docs/handoff/CURRENT.md). Inspect its linked exported interfaces,
tests and owner boundaries in the actual checkout. Older AI_CONTEXT/TEAM_HANDOFF status
sections are historical. Preserve C1/C2 and independent V2 verification; no V2-to-C1 cast
or unauthorized provider dispatch/deployment change. Use narrow, tested integration commits.

## Workspace operation and delivery

The application and Git root are the same directory; run `pnpm dev` from your clone's
root. Read `docs/ai-ingestion/workspace.md` for runtime requirements and local setup.
`.local/` holds private machine-local datasets, evidence, tools and recovery manifests;
it must remain ignored and excluded from type scanning and deployment artifacts.
Never publish its contents, `.ai-local/`, credentials, quota state or private datasets.

Follow the owner's current task authorization. Planning is not implementation approval.
For a planning task, inspect and return a plan only. For approved execution, complete
in-scope work and automated verification without optional teammate-review gates.
Provider setup/dispatch, hosted infrastructure and publication require their own scope.
Preserve financial contracts, independent verification, local-only work and stashes.
Do not cast V2 records into C1 or apply/drop protected recovery stashes.

Deliver a concise summary and one verified temporary review ZIP under `.local/reviews/`,
with relevant changes, manifests, commands/results and limitations. Exclude secrets,
private recovery data, Git internals, dependencies, large datasets and older ZIPs.
Do not rerun application tests solely to package unchanged source. Preserve dated
verification evidence; current operational guidance supersedes old workspace paths.
