<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Ingestion handoff

Before editing or consuming FinGence, read the single current technical entrypoint:
[docs/handoff/CURRENT.md](docs/handoff/CURRENT.md). Inspect its linked exported interfaces,
tests and owner boundaries in the actual checkout. Older AI_CONTEXT/TEAM_HANDOFF status
sections are historical. Preserve C1/C2 and independent V2 verification; no V2-to-C1 cast
or unauthorized provider dispatch/deployment change. Use narrow, tested integration commits.
