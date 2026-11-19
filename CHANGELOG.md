# Changelog

All notable changes to FinGence are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every pull request that changes what a user sees or what the system does adds one line under
**Unreleased**, in plain language, with its PR number. At a release, the Unreleased lines move under
the new version and its date.

## [Unreleased]

### Added
- AI report page (`/ai-report`): a quarterly or annual style cash report for any processed run, with a summary of results against the preceding period, five sections written by AI over verified facts (every figure filled in and checked by FinGence, or FinGence's own summary instead) and print to PDF; runs only on its own key `GROQ_API_KEY5`. Reports is unchanged (#145).
- AI06 now considers only final unexplained transactions, preserves failed checks alongside valid suggestions, and supports audited proposal review without changing financial totals (#141).
- AI06 GPT matching suggestions for unexplained reconciliation items, checked independently before they
  are shown and never changing a figure; owner-scoped role views and a categorised results table
  (#121, #122, #126, #129, #131, #132, #133).
- Experimental XGBoost forecast shown beside the six-month baseline on Forecasting, scored on the same
  backtest months; the baseline stays primary and the challenger runs only where its local worker is
  enabled, never on Vercel (#89).
- Jason's local C1 transaction and batch read API (`/api/transactions`, `/api/batches/[id]`): local M2 mode only,
  loopback requests and a loopback database, audited scoped reads; still needs its ownership SQL migration (#138).
- **Fin**, a named assistant on every page (floating button or Ctrl/⌘ K on desktop, the Chat tab on phones): a guide
  to FinGence and a colleague for your figures. Fin's own words never contain a figure; money questions go to the
  verified Q&A, which fills every figure from the records (#137).
- Jason's Finance chatbot integrated: one `/chatbot` route (the old `/ask` and `/finance-questions` redirect to it),
  with Groq chat over verified uploaded data in local mode (#134, #136).
- Changelog, pull request and issue templates, and a Definition of Done in `CONTRIBUTING.md` (#108, #115).

### Changed
- Next.js 16.4.5 (from 16.4.1), clearing moderate advisory GHSA-mfr8-8qww-v76h; a local `next build` no longer stops
  with `SecurityFatalError` (#144).
- The Finance chatbot (`finance-chat`) runs on its own Groq key, `GROQ_API_KEY4`, like AI06 on key 3 (#138).
- "Signal ledger" design: the Overview, Anomalies and Reconciliation lead with what needs attention,
  with counts on the navigation and fewer status chips for Finance users (#123, #124, #125).

### Fixed
- Signed-in users no longer see a moment of "Public demo" and "Public prototype" wording while their session loads (UAT finding, #147).
- AI answers that say "decreased by" or "increased by" a negative amount (a double negative) are now withheld, like "lower by" (UAT finding, #147).
- AI report: the review-of-performance section asks for at most three facts a sentence, after its reply was rejected as malformed twice (UAT finding, #147).
- AI report: a section stopped by FinGence's per-person limit of six AI calls a minute now waits and retries, like Groq's own rate limit, instead of showing "AI unavailable" (#146).
- AI06 evidence API no longer returns false "unavailable" errors; it uses its own Groq key and safe
  server-only diagnostics, honours the Finance preview, and polls until saved evidence is ready
  (#127, #128, #130).

## [2.0.0] - to be tagged at the start of UAT

Everything from the 16 October 2026 SAIC demonstration (`fingence-saic-demo-2026-10-16`) to 15 November 2026.

### Added
- FinGence 2.0 ingestion baseline and Phase 1 processing workflow on synthetic data (#4, #13, #15, #16, #21, #29, #52, #55).
- AI layout interpretation with deterministic acceptance gates: the AI proposes, code verifies (#56, #63).
- Grounded Finance Q&A: answers come only from verified records, with numbers filled in by code (#58, #83).
- Excel workbooks (one document per worksheet), PDF statements and scanned documents with browser OCR
  anchored by arithmetic checks (#64, #71, #81).
- AI-written management commentary on Reports, checked by the same gates (#67, #69).
- A proposed bank reconciliation statement that proves the difference (#68).
- Ingestion layer v1 with a Supabase store and a benchmark; reconciliation layer v1 that resolves every
  exception by rule or leaves it visibly unexplained (#73, #75).
- Several months and any currency end to end; anomalies resolved against the books (#79).
- Server processing jobs with stored results, including hosted PDF and OCR reading (#80, #81, #85).
- Document evidence view: the document and what FinGence read, side by side (#84).
- Automated ingestion evaluation with fixed targets and held-out layouts; runs 4, 5 and 6 and an
  external-documents test, all with 0 false acceptances (#76, #86, #90).
- Workspace for SAIC users only: sign-in with Finance user, Admin and Superadmin roles, a role preview,
  and changing your own password (#74, #91, #118).
- Technical log: every AI call goes through one logging door and appears on a log page for Admins (#97).
- Customisable Overview, a processing confidence figure, previews on Data, and History, where every run
  is saved per person and can be reopened exactly (#98, #100, #101, #103).

### Changed
- Frontend redesign with light and dark themes and phone-first layouts; Sapphire brand colour; account
  menu, status chips and branded sign-in; Overview as a finance dashboard; one pattern for results pages
  (#87, #92, #93, #94, #95, #96).
- Sidebar collapses to an icon rail and can be resized (#99, #102).
- Phone and accessibility pass after Apple's Human Interface Guidelines, then a simpler look with
  stronger contrast (#119, #120).
- Deployed function code halved, from 590 MB to 299 MB per deployment (#104).
- AI calls alternate across two Groq keys and retry after a rate limit (#66, #70, #72).

### Fixed
- Processing waits for the AI status check before starting (#62).
- Data shows the real check count right after a server job (#88).
- Codex review findings: side-bound totals, opening-balance anchor, OCR choice uniqueness and
  appositive ranks (#77).
- Tests start a disposable PostgreSQL under the C locale (#65).
- AI budget accepts a custom-prefixed Upstash store (#60, #61).

### Security
- Next.js patched to 16.4.1 (#3).
- Local scoped backend reads, and private machine-local artefacts kept out of the repository (#11, #12).

[Unreleased]: https://github.com/Yoriichi-0u0/FinGence-Finance-Intelligence/compare/fingence-saic-demo-2026-10-16...main
[2.0.0]: https://github.com/Yoriichi-0u0/FinGence-Finance-Intelligence/compare/fingence-saic-demo-2026-10-16...main
