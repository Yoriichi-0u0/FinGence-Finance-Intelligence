# Contributing to FinGence

Five people commit to this repository, and `main` deploys straight to Production for SAIC.
Every change therefore goes through a pull request.

## Before you start

1. Read [`docs/handoff/CURRENT.md`](docs/handoff/CURRENT.md) and [`AGENTS.md`](AGENTS.md). If you use an
   AI coding assistant, it reads `AGENTS.md` first.
2. Branch from the latest `main` (`git fetch origin && git switch -c feature/<name> origin/main`).
   Do not upload files through the GitHub web page: it replaces whole files from an old copy and drops
   other people's changes.
3. Link the issue your change resolves, for example "Closes #113".

## Rules that protect the figures

- Every call to an AI model goes through `withAiCall` from `lib/ai-calls`. Read
  [`docs/ai-integration/ai-calls.md`](docs/ai-integration/ai-calls.md). `tests/ai-calls/guard.test.ts`
  fails the build for a direct provider call.
- The AI proposes; code verifies. A figure shown to a user comes from verified records, never from model text.
- Never log or commit prompts, answers, document contents, amounts, API keys or passwords.
- Never change the bytes of a pinned fixture (`synthetic/`, `public/demo/`, `public/samples/`): their
  SHA-256 is tested. On Windows, check `git diff --stat` shows no line-ending rewrites.
- `.local/` and `.ai-local/` stay on your machine and are never committed.

## Definition of Done

A pull request is ready to merge when:

- [ ] CI (`verify`) is green: tests, lint, types, server boundary, database checks and build.
- [ ] It has been reviewed by one other team member (or the owner).
- [ ] `CHANGELOG.md` has a plain-language line under **Unreleased** for any change a user can see or
      that changes what the system does.
- [ ] Every new AI call goes through `withAiCall`.
- [ ] UI changes include screenshots in light and dark mode, and on a phone.
- [ ] Any database migration is named in the PR, with the order to apply it on Production.
- [ ] It is up to date with `main` and has no merge conflicts.

Merging to `main` publishes to Production, so the owner merges once the Definition of Done is met.

## Issues

Use the **Bug** or **UAT finding** template, add an `area: …` label, and set the current sprint milestone.
