# FinGence 2.0 AI M1 — layout interpretation with deterministic acceptance

Branch `claude/fingence2-ai-m1-interpretation`, stacked on `main` (`cb5db46`). The plan and model
selection are in the [AI roadmap](../architecture/fingence2-ai-roadmap.md).

## What it does

Phase 1 accepted only documents whose columns exactly match the PoC schema. M1 lets FinGence read the
same financial content in **unfamiliar layouts**, including:

- other headings, including Malay;
- `DD/MM/YYYY`, `DD-Mon-YYYY` and `DD.MM.YYYY` dates;
- `1,234.56` and `1.234,56` amounts;
- Withdrawal/Deposit, Dr/Cr or signed-amount columns;
- semicolon delimiters;
- bank preambles and footers.

The run works like this:

1. The browser builds a bounded **evidence window** (`lib/interpretation/evidence.ts`): up to 18 head lines, 3 tail lines and per-column profiles. It is never the whole file.
2. `/api/ai/interpret` forwards it once to **Groq `openai/gpt-oss-120b`** with a strict JSON schema (`lib/server/ai/groq-interpreter.ts`). The model returns a *layout proposal*: role, header line, column meanings, formats, sign representation, direction tokens and verbatim scope evidence. It never returns an amount.
3. `verifyProposal` (`lib/interpretation/gates.ts`) re-reads **every row of the original bytes** under the proposal and runs its gates (roadmap §4).
   - Model confidence and rationale are never inputs.
   - Any failed gate quarantines the document, with the reason shown.
4. An accepted proposal is materialized into the Phase 1 canonical CSV. Extract, the second-parser Verify, Reconcile, Analyze, Forecast, Report and every connected page then run **unchanged**. Verify adds a canonical round-trip total check.
5. The processing ID includes the accepted mapping hash. A reload replays the stored proposal through the gates without a new model call; the panel shows "Replayed".

## How to run

The gateway is **off unless explicitly enabled**. With it off, `/api/ai/interpret` returns 404 and the app is exactly Phase 1.

```bash
# .env.local (never commit); the key stays server-side
GROQ_API_KEY=...
FINGENCE_AI_GATEWAY=1
# optional: openai/gpt-oss-20b or qwen/qwen3.8-27b
FINGENCE_AI_INTERPRET_MODEL=openai/gpt-oss-120b
```

Then run `pnpm dev`, open `/data`, choose **Use unfamiliar-layout samples (AI)** and press **Process Financial Documents**. The results must equal the Phase 1 sample exactly:

| Result | Value |
| --- | --- |
| Reconciliation outcomes | 46 / 4 / 3 / 2 / 2 / 1 / 1 |
| Bank − ledger difference | MYR −2,692.92 |
| Anomaly candidates | 6 |
| April 2026 net | MYR 35,446.45 |

**Regenerate the samples and fixtures:** `node scripts/generate-unfamiliar-documents.mjs` (`--check` in CI).

## Privacy and cost

The Data page states what is sent when the gateway is on. For an unfamiliar document that is its headings, column profiles and a few sample lines; the full file never leaves the browser, and all calculations run there. Nothing is stored or logged server-side.

The gateway has these protections:

- **Request limits:** same-origin requests only, a 48 KB body cap and a strict evidence schema.
- **Rate limit:** 12 calls per minute and 400 per day per server instance.
- **No retries.**

Each call costs about $0.001–0.002 (see the evaluation).

**Production remains Phase 1 until the owner sets `FINGENCE_AI_GATEWAY=1` on Vercel.** Rollback is to unset it.

## Evaluation

See [the M1 evaluation](../research/fingence2-ai-m1-evaluation.md) and the reproducible harness `tests/interpretation/live-eval.test.ts`. The harness is opt-in and billable.

```bash
FINGENCE_AI_LIVE_EVAL=1 GROQ_API_KEY=... \
FINGENCE_AI_EVAL_MODELS=openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b \
FINGENCE_AI_EVAL_OUT=.local/research/fingence2-ai-m1/eval.json \
pnpm exec vitest run tests/interpretation/live-eval.test.ts
```

## Tests

| Suite | What it covers |
| --- | --- |
| `tests/interpretation/gates.test.ts` | Parsers; evidence bounds; 4 correct proposals accepted; 13 wrong proposals and 6 adversarial documents quarantined |
| `pipeline.test.ts` | Both unfamiliar pairs reproduce every Phase 1 figure; determinism; Phase 1 behaviour without an interpreter; interpreter outage; wrong proposal |
| `route.test.ts` | Gateway off is 404; no secret in responses; one bounded call; refusals before any provider call; 429/502 mapping; rate limit |
| `panel.test.ts` | Receipt, mapping and gates are rendered; the rationale is labelled "not evidence" |

## Limitations

- **Formats:** CSV only. XLSX, PDF and images are later milestones.
- **Scope:** one month, one business, MYR only, single cash account.
- **Ledgers without a running balance** rely on heading vocabulary to confirm Dr/Cr. Opaque ledger headings are quarantined.
- **The heading vocabulary** is a small English/Malay list; other languages quarantine unless a running balance confirms direction.
- **The rate limit** is per instance, not distributed. Groq's account limits (free tier: 8k tokens/min) are the hard cap; a 429 quarantines with "AI interpretation unavailable".
- **Finance Q&A** is still rule-based (M2).
