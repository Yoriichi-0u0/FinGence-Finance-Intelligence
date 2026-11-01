# FinGence 2.0 — AI Architecture, Model Selection and Implementation Roadmap

2 November 2026. This is the plan behind the `claude/fingence2-ai-m1-interpretation` branch.
Implemented items are marked **(built)**. Everything else is planned work.

## 1. Current state

**Working and verified (Production `cb5db46`).**
- A browser-only, eight-stage pipeline (`lib/demo/pipeline.ts`): Identify → Extract → Interpret → Verify → Reconcile → Analyze → Forecast → Report.
- One processing context feeds nine connected pages.
- The supporting engines are exact-cent, deterministic and tested:
  - reconciliation (`lib/poc-reconciliation/engine.ts`): seven outcome classes;
  - anomaly rules (`lib/poc-anomalies`);
  - a six-month-mean forecast with rolling backtests (`lib/poc-forecast`);
  - the management summary;
  - rule-based Finance Q&A.

**Main limitation: no intelligence at the boundary.** Role identification is an exact column-signature match. A statement exported by another bank — other headings, `DD/MM/YYYY` dates, `1,234.56` amounts, Withdrawal/Deposit columns, a preamble above the table — is quarantined. Nothing in Phase 1 uses a model.

**Earlier AI work (V2 increments, M2–M4) is reusable as design, not as runtime.**
- *Evidence bundles and plan schemas.* Strict evidence-ID schemas made the model reference only real cells.
- *The live failure.* One `LIVE_GROQ` run of `openai/gpt-oss-20b` (27 Oct) chose all six header rules correctly but returned `conventions: null`.
  - The diagnosis was under-specified conventions in the prompt (`docs/ai-ingestion/increment-03/refinement-03b.md`).
  - Lesson: define every convention with examples, and verify conventions from the data, not from the model.
- *Quota and receipts.* Quota ledgers, uncertain-dispatch receipts and no automatic retries on billable calls.
- *Why none of it is live.* That stack is tenant- and session-scoped to local PGlite, and was deliberately never activated. Rebuilding it is not on the critical path.

**OCR research.**
- Docling + RapidOCR recovered 16/16 table rows across digital, scanned and photographed synthetic documents (`docs/research/open-source-technology-evaluation.md`).
- Xiaomi-OCR-0 read 57/57 rows where Docling read 9/57 on harder pages, but it:
  - takes 54–73 s per page on M2 MPS;
  - gives no coordinates;
  - hallucinates on degraded pages.

  Both need a Python worker, so neither can run on Vercel. The durable lesson is the **independent-reader anchor gate**: zero false acceptances because an independent reader had to agree.

**Celester's AI01–AI05 (PR #40, draft).**
- Multilingual E5-small embeddings raised raw matching recall (E5 18 TP / 2 FP vs exact 14 / 0).
- Under conservative verification all methods kept the **same 8 verified pairs**.
- Semantic similarity alone does not add verified matches. It is useful for *ranking suggestions*, which then need an independent financial check.

## 2. Model selection

### Candidates

Measured live on 2 November with the project key. The key is on Groq's free plan: 8,000 tokens/min, 1,000 requests/day. Groq's current catalogue offers:

| Model (Groq) | Strict JSON schema | Vision | Price in/out per M tokens | Observed latency (trivial schema call) | Role for FinGence |
| --- | --- | --- | --- | --- | --- |
| `openai/gpt-oss-120b` | Yes (constrained decoding) | No | $0.15 / $0.60 | 0.69 s | **Primary interpreter and Q&A planner**: strongest reasoning with guaranteed schema shape |
| `openai/gpt-oss-20b` | Yes | No | $0.075 / $0.30 | 0.75 s | Fallback interpreter, cheap bulk evaluation |
| `qwen/qwen3.8-27b` (preview) | Yes (docs inconsistent) | **Yes**, 3 images | $0.80 / $4.00 | 0.25 s | Scanned statements and images (M3), second-opinion interpreter |
| `meta-llama/llama-prompt-guard-2-86m` | — | No | $0.04 | — | Optional injection screen on cell text |
| `whisper-large-v3-turbo` | — | — | $0.04/h | — | Not needed |

The Llama 3.x/4 text and vision models are no longer served to this key.

**Outside Groq:**
- *Docling/RapidOCR and Xiaomi-OCR-0 (local Python).* Best evidence for scanned layouts, but they cannot run on Vercel. They stay as an optional local/backend reader (Katana GPU), not the hosted path.
- *E5-small (local, ONNX via transformers.js).* Proven by AI03. It could run in the browser, but it adds a ~120 MB model download and a dependency. Deferred until a ranking milestone needs it.
- *Hosted embeddings.* Groq has none.
- *Hosted frontier APIs* (OpenAI/Gemini) need separate credentials and budget approval. They are not needed: the gating, not the model, carries correctness.

### Decision

The architecture is multi-model and verification-first.

1. **Interpretation** uses `gpt-oss-120b` with strict JSON schema. The model proposes the document role, the header row, a column→field mapping, date/number formats, the sign representation, direction tokens and scope evidence. It never transcribes amounts.
2. **Every accepted fact is re-derived deterministically from the original bytes.** Model confidence is never an acceptance criterion; sections 3–4 give the gates.
3. **Vision** (M3) uses `qwen3.8-27b` to transcribe images and scanned PDFs into a table. Transcription is accepted only when an independent arithmetic anchor holds: the running balance across every row, the stated totals, and opening/closing balances.
4. **Finance Q&A** (M2): `gpt-oss-120b` plans calls to a fixed set of deterministic finance tools over the verified context. Every number in the answer must equal a tool output, or the answer is withheld.
5. **Forecasting** stays statistical (baseline + backtests). M4 adds model *selection* among ETS/seasonal-naive by backtest; LLMs only narrate.
6. **Matching suggestions** (M4): LLM or E5 ranking for exceptions only. A suggestion is shown as "AI-suggested" and never clears an outcome without the existing exact-money/date gates.

**Why the model only proposes and never transcribes amounts.** A mis-mapped column breaks *every* row, so deterministic checks catch it; a mistyped amount is hard to catch. This makes false acceptance structurally unlikely. It also keeps prompts small (headings + 8 sample rows + column profiles ≈ 2–3k tokens), which fits the free 8k TPM tier and keeps costs to fractions of a cent per document.

## 3. Architecture

```
Browser (public demo)                     Server (Next.js route, key held server-side)
──────────────────────                    ───────────────────────────────────────────
file bytes → SHA-256
exact signature? ──yes──► canonical path (Phase 1, unchanged)
   │ no
   ▼
layout evidence (first rows, last rows,   POST /api/ai/interpret  ──► Groq gpt-oss-120b
column profiles; no full document) ─────►  validate size/shape         strict JSON schema
                                           receipt: model, tokens, latency, cost
◄──────────────────────── proposal + receipt
   ▼
deterministic gates on ALL rows of the ORIGINAL bytes
   ├─ any gate fails ─► QUARANTINED (with reasons)
   ▼ all pass
materialize canonical CSV (lineage: canonical row → source line)
   ▼
existing Extract → Verify (second parser) → Reconcile → Analyze → Forecast → Report
```

- **Processing identity.** The processing ID is `H(version, role:sha256, interpretation:sha256:mappingHash)`. It changes when the accepted mapping changes and is stable for equivalent proposals.
- **Reload.** An accepted proposal and its receipt are kept with the documents in `sessionStorage`. A reload re-runs the gates on the stored proposal instead of calling the model again; the receipt stays marked as the original live call.
- **Deployment.** The route answers only when `GROQ_API_KEY` and `FINGENCE_AI_GATEWAY=1` are set. Otherwise it returns 404 and the UI behaves exactly like Phase 1.
- **Request bounds.** Bodies are limited to 48 KB, with a per-instance rate limit and no persistence or logging of content.

## 4. Verification gates (built in M1)

Each gate is computed from the original bytes, independently of the model:

| Gate | What it proves |
| --- | --- |
| Table structure | The header row exists. Every data row below it has the same width; preamble and footer lines are excluded explicitly. |
| Mapping integrity | Required fields are mapped to distinct, existing columns, and the role-specific representation is complete. |
| Heading agreement | Each sign-critical mapping is checked against a bilingual (English/Malay) heading lexicon: debit, credit, money in, money out, direction, balance and date. Contradiction → fail. An opaque heading needs arithmetic confirmation. |
| Full-column parsing | Every date and amount parses under the declared format. Dates must be unambiguous: an alternative order must fail, or be refuted by the stated statement period. |
| Direction tokens | Every direction cell is covered by the proposed inflow/outflow tokens, and no token is in both. |
| Split exclusivity | Exactly one of in/out (or debit/credit) is non-zero per row. |
| Running balance | When a balance column exists, `balance[i] − balance[i−1] = signed[i]` for every row. This independently confirms amounts and direction. |
| Sign confirmation | Each document's direction must be confirmed by the heading lexicon or by the running balance. If both exist and disagree → fail. |
| Scope evidence | Every cited scope literal (business ID, name, currency, period) appears verbatim in the cited source line. Currency must be supported; the stated period must agree with the dates. |
| Uniqueness | Record IDs are unique, or line-derived IDs are used, as disclosed. |
| Canonical round trip | The materialized canonical CSV goes through the Phase 1 normalizer and second parser, and its totals equal the totals computed directly from the source. |

## 5. Milestones

| # | Milestone | Definition of done |
| --- | --- | --- |
| **M1 (built)** | **AI layout interpretation with deterministic acceptance** | Server Groq gateway; proposal schema; gates; canonical materialization; pipeline + UI integration with receipts; unfamiliar-layout public samples; recorded-proposal tests (positive and adversarial); live evaluation harness with accuracy, false-acceptance, latency and cost report; positive variants reproduce the exact Phase 1 figures (difference MYR −2,692.92). |
| M2 | Grounded AI Finance Q&A + narrated report | Tool-calling planner over deterministic tools; numeric-citation gate; refusal of unsupported questions; answer evaluation set (supported, unsupported, adversarial); AI narrative clearly separated from verified figures. |
| M3 | Images/scanned PDFs via vision | `qwen3.8-27b` transcription to rows → arithmetic anchor gates (running balance, stated totals) → same materializer; Docling/OCR-0 as an optional local reader for comparison. |
| M4 | Intelligent exception matching and forecasting choice | LLM/E5 candidate ranking for BANK_ONLY/LEDGER_ONLY/REFERENCE_REVIEW with an exact-money/date gate, shown as suggestions; backtest-selected forecasting model. |
| M5 | Backend jobs + Supabase persistence | `ProcessingRunner` backend implementation on Celester's DB04/AI06 contracts: content-addressed sources, stage records, receipts, quarantine inbox, audit. |

### Production

Enabling the gateway on Production needs owner approval and a Vercel environment variable. Until then, Production stays the Phase 1 build. The rollback is to unset `FINGENCE_AI_GATEWAY`.

## 6. Evaluation methodology

Ground truth is the generator's canonical documents; every variant derives from the same transactions.

**Metrics:**
- per variant: accept/quarantine;
- for accepted variants: exact parity of every downstream figure (counts, difference, totals, anomalies, forecast);
- false acceptance, meaning an accepted variant whose figures differ;
- model mapping accuracy *before* gates, field by field;
- latency, tokens and estimated cost per call.

**Variant classes:**
- *Positive layouts:* bilingual headings, `DD/MM/YYYY`, `DD-Mon-YYYY`, `1.234,56`, split/direction/signed amounts, preambles.
- *Adversarial:*
  - opaque headings with no balance;
  - corrupted running balance;
  - all-ambiguous dates;
  - prompt injection in cells;
  - mislabelled Deposit/Withdrawal columns;
  - foreign currency;
  - non-financial CSV.

The target is zero false acceptances. Recall on positive layouts is reported, not assumed.

## 7. Risks and fallbacks

| Risk | Mitigation |
| --- | --- |
| Free-tier 8k TPM | Compact evidence and per-document calls. A 429 shows "AI unavailable" and the document is quarantined; the exact-signature path still works. |
| Model drift or preview removal | The model is configurable, every receipt records the model actually served, and the gates are model-independent. |
| Prompt injection in cells | Cells are data in a JSON payload. The schema only allows column indices and enums, so injection can at most produce a wrong mapping, which the gates reject. |
| Privacy | The public demo uses fictional data. The UI states that headings and up to 8 sample rows are sent to Groq when AI interpretation is used. |
| Cost abuse on a public route | Per-instance rate limit, 48 KB body cap, single small completion budget, no retries. Production enablement is a separate owner decision. |

## 8. Team coordination

- **Celester (DB04/AI06):** M5 persists `InterpretationRecord { sourceSha256, proposal, receipt, gates, mappingHash }` next to stage records. The proposal/receipt shapes in `lib/interpretation/contracts.ts` are the proposed contract.
- **Celester (AI01–AI05):** AI05 shows verification is the bottleneck. M4 reuses AI04's verification policy for suggestions.
- **OCR (Katana):** M3 can consume Docling/OCR-0 output as a second reader for the vision path's anchor gate.
