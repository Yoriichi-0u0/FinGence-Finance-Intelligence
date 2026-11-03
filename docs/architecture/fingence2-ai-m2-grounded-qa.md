# FinGence 2.0 AI M2 — grounded financial question answering

**Branch:** `claude/fingence2-ai-m2-grounded-qa`, stacked on the approved M1 head (`ef18819`).

**What it reuses from M1:**
- the browser processing context;
- the opt-in AI gateway (`FINGENCE_AI_GATEWAY`);
- the durable fail-closed budget (`lib/server/ai/budget.ts`);
- the strict-schema Groq transport;
- the M1 evaluation discipline: recorded tests first, then live repeats.

**What it keeps:** the Phase 1 demonstration is unchanged. The rule-based answerer stays the default and the fallback.

## Goal and non-goals

**Goal:** answer genuine financial questions about one verified processing, with model assistance, where every amount, date, count, reference and record identifier in the answer comes from the verified records. Questions with no natural keyword route should still work, for example:
- "Which supplier did we pay the most in March?"
- "How much did we receive from GrabFood compared with POS settlements?"
- "Which payments still need review and why were they flagged?"

**Non-goals (refused or withheld, never improvised):**
- profit, revenue, expense classification, tax or any accounting conclusion the cash records cannot support;
- causes not stated in the records;
- advice;
- fraud or other allegations;
- other businesses, periods or currencies.

## The trust boundary

```
question ──► [pre-check: advice/allegation]──refuse
   │
   ▼  (1) PLAN call: question + catalogue (tool list, allowed filter values: counterparties, months,
   │      statuses, rules; NO amounts or records)
   ▼  model returns a union-typed plan: ≤ 4 tool queries, or a typed refusal
[plan gate] arguments must be members of the catalogue (exact counterparty, month, status)
   │
   ▼  deterministic tools run in the browser over the verified context → facts F1…Fn
   │  (MONEY/COUNT/DATE/PERIOD/TEXT, each with source record IDs)
   ▼  (2) ANSWER call: question + facts (values included, so the model can reason)
   ▼  model returns sentences whose figures are placeholders {F3}, plus optional typed derivations
   │  (D1 = DIFFERENCE/SUM/SHARE of two facts) computed by code — never by the model
[answer gate] schema · every placeholder and citation resolves · no free digits, number words,
   │          month names or dates · named entities must be cited facts · no unsupported accounting
   │          or advice/allegation language · ≥ 1 citation per sentence
   ▼
rendered answer: code substitutes verified values; each figure links to its source records.
Any failed gate → "AI answer withheld" + the deterministic rule-based answer + the facts table.
```

**Why placeholders.** The model sees the values but cannot emit them. The figures shown are substituted by code from the facts, so a fabricated amount, date or reference is impossible by construction. The gate's job reduces to proving that the free text contains no figures at all and makes no unsupported claim.

**What the gates cannot prove.** A grounded answer can still answer a slightly different question, for example by filtering the wrong counterparty or citing the right fact with a misleading word. That residual risk is measured in the evaluation (`MISGROUNDED`: accepted, but the key figure is not the expected one) and disclosed. The plan is shown to the user ("The model asked for: …") so the basis of the answer is always visible.

## Components (incremental, each with tests)

| # | Increment | Files |
| --- | --- | --- |
| 1 | This plan | `docs/architecture/fingence2-ai-m2-grounded-qa.md` |
| 2 | Deterministic grounding index, catalogue, tools → facts with provenance | `lib/grounded-qa/index.ts`, `tools.ts` |
| 3 | Strict union contracts (plan, answer) and deterministic gates; adversarial tests | `lib/grounded-qa/contracts.ts`, `gates.ts` |
| 4 | Server: shared strict-schema Groq call and request bounds extracted from M1 (M1 behaviour unchanged); `/api/ai/ask` behind the same gateway flag and budget | `lib/server/ai/groq.ts`, `request.ts`, `app/api/ai/ask/route.ts` |
| 5 | Browser orchestration and `/ask` UI: rule-based by default; an "AI-assisted" answer only when the gateway is available, with plan, receipts, gates and citations | `lib/grounded-qa/client.ts`, `components/demo/grounded-answer.tsx`, `modules.tsx` |
| 6 | Evaluation set (supported / refusal / adversarial) and a live harness (3 repeats; 120B default, 20B comparison); runbook | `tests/grounded-qa/*`, `docs/integration/…`, `docs/research/…` |

## Evaluation metrics

| Metric | Definition | Target |
| --- | --- | --- |
| Grounded-correct | Accepted, and every expected key figure is cited and rendered | Maximize |
| Withheld | Gate refused the model answer; the rule-based fallback is shown | Report |
| Correct refusal | Out-of-scope questions refused (by pre-check, plan or gate) | 100% |
| **Fabricated figure** | Any rendered amount, date or ID not from a fact | **0, by construction and tested** |
| **Misgrounded** | Accepted, but the key figure is not the expected one | **Measure and report**; target 0 |
| Latency, tokens, cost | Per question (two calls) | Report |

## Operational notes

- **Two calls per question,** each admitted separately by the M1 budget.
- **Free tier:** Groq allows 8k tokens per minute, so calls are paced. Production activation stays a separate owner decision with the M1 conditions:
  - a durable store integration test;
  - a dedicated key;
  - spend controls.
- **Nothing is stored server-side.** The question and the bounded facts are sent; the full ledger never is.
