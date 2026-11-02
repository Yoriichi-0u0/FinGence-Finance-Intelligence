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
2. `/api/ai/interpret` admits it against the shared spend budget and forwards it once to **Groq `openai/gpt-oss-120b`** with a strict JSON schema (`lib/server/ai/groq-interpreter.ts`). The model returns a *layout proposal* in the v2 contract (`modelProposalSchema` in `lib/interpretation/contracts.ts`): `layout` is a union keyed by role, and its `money` mapping a union keyed by representation, so strict decoding cannot emit a contradictory combination. The proposal holds role, header line, column meanings, formats, money mapping, direction tokens and verbatim scope evidence. It never returns an amount. `parseProposal` flattens it for the gates; legacy flat proposals stored before v2 still pass through every gate.
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
# hosted deployments ONLY: a durable shared budget store (Redis over HTTPS, Upstash REST protocol).
# Without both values the gateway does not exist on Vercel (404). Locally an in-process store is used.
FINGENCE_AI_BUDGET_REST_URL=https://<instance>.upstash.io
FINGENCE_AI_BUDGET_REST_TOKEN=...
# optional overrides (clamped): daily USD cap (max 20), calls per client per day (max 200), all calls per day (max 5000)
FINGENCE_AI_DAILY_BUDGET_USD=0.50
FINGENCE_AI_CLIENT_DAILY_CALLS=30
FINGENCE_AI_GLOBAL_DAILY_CALLS=300
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

The gateway is public and unauthenticated, so every protection is enforced **before** a billable call:

| Layer | Control (`app/api/ai/interpret/route.ts`, `lib/server/ai/budget.ts`) |
| --- | --- |
| Origin | `Origin` is required, parsed safely (`URL.canParse`), must be http(s) with the request's host; `Sec-Fetch-Site`, when sent, must be `same-origin`. Missing, `null` or malformed → 403, never an exception. This stops other sites' pages, not scripts that forge headers. |
| Size | `Content-Length` over 48 KB (or not a number) → 413 before reading; otherwise the stream is counted and cancelled once past 48 KB. Invalid UTF-8 → 400. |
| Shape | Strict evidence schema (≤ 18 head + 3 tail lines, ≤ 24 profiles, 80-character cells). |
| Per client | 6 calls/minute and 30/day per client address. The address is HMAC-hashed before storage; IPv6 is grouped by /64. On Vercel the platform's `x-vercel-forwarded-for` is used; elsewhere `X-Forwarded-For` can be forged, so per-client limits are advisory there and the global limits are the bound. |
| Global | 10 calls/minute and 300/day across all clients. A client over its own limit never touches the global counters. |
| Spend | Daily USD cap (default $0.50). Each call reserves its worst case first (one token per prompt character + the full 3,000-token completion ≈ $0.004 for 120B) and settles to the measured cost. An unknown outcome keeps the reservation; a provider 429 (not billed) refunds it. |
| Store | Counters live in a shared store so limits hold across serverless instances. On Vercel the gateway **does not exist** without a durable https store; if the store is unreachable admission fails closed (503) and nothing is sent. |
| Provider | One completion per request (`max_completion_tokens` 3,000, 45 s timeout). The server never retries. |

**Retries, precisely.** The server makes exactly one provider call per request and never retries. The
*browser* (`lib/interpretation/client.ts`) may make **one** new request after a refusal that was never
billed: a provider 429 or the gateway's own per-minute refusal, and only when `Retry-After` ≤ 45 s. That
second request is admitted and budgeted again like any other.

Each call costs about $0.0004–0.0012 (see the evaluation); the default daily cap therefore allows
roughly 400–600 interpretations a day.

**Recommended extra layers before a public launch** (each needs its own owner approval, none is required by
the code): a dedicated Groq project key with a spend limit set in the Groq console; a Vercel Firewall
rate-limit rule on `/api/ai/interpret`; and a bot challenge (e.g. Vercel BotID or Cloudflare Turnstile)
if abuse is observed.

**Production remains Phase 1 until the owner sets `FINGENCE_AI_GATEWAY=1` and the budget store on Vercel.**
Rollback is to unset `FINGENCE_AI_GATEWAY`.

## Evaluation

See [the M1 evaluation](../research/fingence2-ai-m1-evaluation.md) and the reproducible harness `tests/interpretation/live-eval.test.ts`. The harness is opt-in and billable.

```bash
FINGENCE_AI_LIVE_EVAL=1 GROQ_API_KEY=... \
FINGENCE_AI_EVAL_MODELS=openai/gpt-oss-120b,openai/gpt-oss-20b,qwen/qwen3.8-27b FINGENCE_AI_EVAL_REPEATS=2 \
FINGENCE_AI_EVAL_OUT=.local/research/fingence2-ai-m1/eval.json \
pnpm exec vitest run tests/interpretation/live-eval.test.ts
```

## Tests

| Suite | What it covers |
| --- | --- |
| `tests/interpretation/gates.test.ts` | Parsers; evidence bounds; correct proposals accepted (4 public layouts + 2 no-balance bank statements); 12 wrong proposals; adversarial documents; sign conventions without a running balance (opaque or one-sided signed columns, bank Debit/Credit perspective, role misdeclared either way, unstated role); ledger account identity (several accounts mapped or unmapped, sales or bank-loan account, no account evidence, single-valued account column) |
| `pipeline.test.ts` | Both unfamiliar pairs reproduce every Phase 1 figure; determinism; identity follows content; Phase 1 behaviour without an interpreter; interpreter outage; a second bank statement passed off as the ledger never reconciles; wrong proposal |
| `route.test.ts` | Gateway off is 404; hosted without a durable store is 404; durable store settles to measured cost, stores no raw address and fails closed; malformed/missing/`null` Origin and cross-site fetch → 403; declared and streamed oversize → 413 without buffering; invalid UTF-8; per-client and global limits; daily spend cap; 429/502 mapping without retrying |
| `budget.test.ts` | Client address extraction (/64 grouping, Vercel header); store selection; override clamps; admission order; reservation and settlement; fail-closed; Redis REST pipeline |
| `panel.test.ts` | Receipt, mapping and gates are rendered; the rationale is labelled "not evidence" |

## Limitations

- **Formats:** CSV only. XLSX, PDF and images are later milestones.
- **Scope:** one month, one business, MYR only, single cash account.
- **Without a running balance,** direction rests on vocabulary: Debit/Credit or Withdrawal/Deposit headings, DR/CR tokens, or a signed column whose heading states a signed cash movement ("Net cash movement"). A signed column headed only "Amount" is quarantined, because card-style exports print withdrawals as positive. Opaque headings are quarantined.
- **Role and account come from the document.** Whose books a document is decides what Debit/Credit and DR/CR mean, so the role must be stated by its title or headings, never by transaction cells or the file name (a file name may guide the model but anyone can rename a file: an ambiguous bank statement renamed `general-ledger….csv` was accepted with every sign inverted before this was closed); both or neither → quarantined. A ledger must name exactly one cash or bank account (an account column, mapped or not; an "Account" line; or the money headings); a non-cash term such as "sales" or "loan" contradicts. This is deliberately strict: a correct but unlabelled document is quarantined rather than guessed.
- **The vocabulary** is a small English/Malay list; other languages quarantine unless a running balance confirms direction.
- **Budget store.** Hosted enablement needs a Redis REST store (Upstash protocol) and its two environment values; this checkout has not been run against a real hosted store (the protocol is covered by recorded tests). Groq's account limits (free tier: 8k tokens/min) remain an outer cap; a provider 429 quarantines with "AI interpretation unavailable".
- **Model choice.** With the v2 contract both `gpt-oss` sizes accept every hard acceptable layout (6/6); `gpt-oss-120b` stays the default because `gpt-oss-20b` failed strict decoding on 12% of calls (`json_validate_failed`, no proposal) and mis-read the Malay sample's number format once. See the evaluation.
- **Free tier.** A v2 call is ~4.9k tokens, so two documents in one minute exceed Groq's free 8k tokens/minute: the second is refused (unbilled 429) and the browser's single retry waits for Retry-After. Groq's free daily token cap can refuse for much longer, and the documents are then quarantined. Hosted activation requires a dedicated paid key, which removes both.
- **Finance Q&A** is still rule-based (M2).
