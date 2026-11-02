# FinGence 2.0 AI M2 — grounded financial question answering (runbook)

- **Branch:** `claude/fingence2-ai-m2-grounded-qa`, stacked on the approved M1 head `ef18819`.
- **Design:** [M2 architecture](../architecture/fingence2-ai-m2-grounded-qa.md).
- **Evaluation:** [M2 evaluation](../research/fingence2-ai-m2-evaluation.md).

## What it does

`/ask` keeps the Phase 1 rule-based assistant as the default. When the AI gateway is available (`GET /api/ai/ask` → 200), an **AI-assisted (verified)** mode appears. For one question it runs:

1. **Pre-check.** Advice and allegation questions are refused before any call. The pattern is the rule-based answerer's own, and the server enforces it too.
2. **Plan call** (`/api/ai/ask`, `stage: plan`).
   - *Input:* the question and a value-free **catalogue**: scope, months, counterparties, statuses and severities. It contains no amounts, dates or records.
   - *Output:* a strict-schema plan of 1–4 queries, whose filter values are enums built from the catalogue, or a typed refusal.
3. **Plan gate, then deterministic tools.** Seven tools (`lib/grounded-qa/tools.ts`) read the verified processing context in the browser and return **facts**. Each fact has a typed value (money in exact cents, a count, a date, a period or text) and its source record IDs.
4. **Answer call** (`stage: answer`). The question and the bounded facts are sent.
   - *Output:* 1–5 sentences whose figures are **placeholders** (`{F3}`, `{F3.date}`, `{D1}`), plus typed derivations (`DIFFERENCE`, `SUM`, `SHARE_PERCENT`). FinGence computes the derivations itself.
5. **Answer gate** (`lib/grounded-qa/gates.ts`), then rendering.

The gate passes an answer only when all of these hold:

| Check | Requirement |
| --- | --- |
| Schema | The answer matches the strict grounded-answer schema. |
| Derived | Each derivation is computed from two compatible verified fields. |
| Placeholders | Every placeholder resolves to a fact and is cited by its sentence. |
| No free figures | The free text has no digits, number words, percentages or years. A month name is allowed only for a verified period. |
| Entities | A named counterparty must be cited; any other proper name must occur in the question or the facts. |
| Conclusions | No profit, revenue, expense, tax, cause, advice or allegation language. |
| Relevance | A counterparty named in the question is what the cited facts are about. |

**Rendering.** Code substitutes every value and lists the facts and source records behind it. "How this was answered" shows the queries the model chose, every check and the receipts.

**Every other outcome** (refused, withheld, insufficient, unavailable) says why and shows the rule-based answer. Model text is never shown unless it passed.

## How to run

The same switch, budget and request bounds as M1 apply (see the [M1 runbook](fingence2-ai-m1-layout-interpretation.md)).

```bash
# .env.local (never commit)
GROQ_API_KEY=...
FINGENCE_AI_GATEWAY=1
# optional; default openai/gpt-oss-120b
FINGENCE_AI_QA_MODEL=openai/gpt-oss-120b
```

`pnpm dev` → `/data` → *Use synthetic sample documents* → *Process* → `/ask` → *AI-assisted (verified)*.

**With the gateway off:**
- `/api/ai/ask` returns 404 for GET and POST, and on Vercel it also returns 404 without the durable budget store.
- `/ask` is exactly the Phase 1 rule-based page.

## What is sent, and what it costs

| Stage | Sent |
| --- | --- |
| Plan | The question, the business and period, the list of months and counterparties, and the status and severity names. |
| Answer | The question and the facts the chosen queries returned (at most 48). |

- **Never sent:** the full bank statement or ledger.
- **Not stored:** nothing is stored or logged server-side.
- **Cost:** each question makes two calls, each admitted against the shared M1 budget. A typical call is about 2.5k tokens, roughly $0.0004 per question on `gpt-oss-120b`.

## Tests

| Suite | Covers |
| --- | --- |
| `tests/grounded-qa/tools.test.ts` | The catalogue has no amounts, dates or records. Filter values must come from the catalogue. Tools reproduce the Phase 1 figures and agree with an independent recomputation from the rows. Determinism. |
| `gates.test.ts` | Pre-check and plan gate. Accepted answers with code-computed derivations. 17 adversarial recorded answers each withheld by the intended gate, plus out-of-answer citations, a wrong-counterparty answer, three invalid derivations and a prompt-injected figure. Verified versus unverified month names. Prompt injection. |
| `route.test.ts` | 404 when off or unbudgeted. A value-free plan request with catalogue-bound enums. A bounded answer request. Refusal before budget or provider use. Schema-bounded requests. Shared request bounds. Per-client budget. Provider error mapping. |
| `client.test.ts` | Full orchestration with a recorded model: answered, pre-check, model refusal, invalid plan, fabricated answer (none of its text rendered), outage. |
| `oracle.test.ts` | All 24 evaluation questions with hand-written ideal answers meet their expectation and are never withheld. Scoring of fabrication and misgrounding. |
| `live-eval.test.ts` | Opt-in, billable live evaluation (3 repeats, both models). |

## Limitations

- **Scope:** one processing (one business, one month, plus its history) and cash records only. Accounting classifications, causes and advice are refused or withheld by design.
- **Misgrounding can survive the gates.** A grounded answer can still answer a nearby question.
  - *Example:* "Which supplier did we pay the most?" is answered with payroll, because the records carry no supplier classification.
  - *How it is handled:* the evaluation measures it (`MISGROUNDED`), and "How this was answered" always shows the queries used.
- **The gates are conservative.**
  - The vocabulary rules (conclusions, proper names) can withhold a correct answer. The rule-based answer is then shown.
  - English and Malay month names only; the conclusion vocabulary is English.
- **Activation:** the same M1 conditions apply. That means a durable-store integration test, a dedicated Groq key with spend limits, verified spending controls, and a clean live walkthrough.
