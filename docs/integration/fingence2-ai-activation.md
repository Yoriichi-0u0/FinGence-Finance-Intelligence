# FinGence 2.0 — switching on live AI on the hosted demo (proof of concept)

Both AI features are merged into `main` and are **dormant** on Production. They are:
- **M1** layout interpretation on `/data`;
- **M2** grounded Q&A on `/ask`.

They switch on only when **all** of the following are set on the Vercel project. Otherwise both `/api/ai/*` routes return 404 and the site is exactly the Phase 1 demo.

| Variable | What | Who sets it |
| --- | --- | --- |
| A Redis REST store | The durable spend and abuse budget that every AI call is admitted against. The code refuses to run AI on Vercel without it, and fails closed if it is unreachable. | The owner. In Vercel → Storage → **Upstash for Redis** (Marketplace, free plan), connect it to `fingence-financeintelligence`. That injects `UPSTASH_REDIS_REST_URL`/`_TOKEN`, `KV_REST_API_URL`/`_TOKEN`, or `<PREFIX>_KV_REST_API_URL`/`_TOKEN` with a custom prefix. All three are accepted; a prefixed store is used only if it is the only one. `FINGENCE_AI_BUDGET_REST_URL`/`_TOKEN` take precedence if set. |
| `GROQ_API_KEY` | The Groq key. It stays server-side and is never sent to the browser. | The owner pastes it in Vercel → Settings → Environment Variables. Nobody else should handle its value. A dedicated key with a Groq-side spend limit is recommended; a free-tier key is rate-limited rather than billed. |
| `FINGENCE_AI_GATEWAY=1` | The explicit on-switch. | The owner, the same way. |
| Optional | `FINGENCE_AI_DAILY_BUDGET_USD` (default 0.50, maximum 20), `FINGENCE_AI_CLIENT_DAILY_CALLS` (default 30), `FINGENCE_AI_GLOBAL_DAILY_CALLS` (default 300), `FINGENCE_AI_QA_MODEL` / `FINGENCE_AI_INTERPRET_MODEL` (default `openai/gpt-oss-120b`) | The owner |

Set them for **Production** (and Preview only if wanted), then **Redeploy**: Vercel → Deployments → latest → Redeploy. Environment variables apply only to new deployments.

## Verify after activation

1. **Endpoints.** `curl https://fingence-financeintelligence.vercel.app/api/ai/interpret` and `/api/ai/ask` each return **200** with `{"available":true,…}`. Neither response contains a key or a token.
2. **`/data`.** *Use unfamiliar-layout samples (AI)* → *Process*.
   - Both documents show **AI proposal · verified**.
   - Processing `753eda94b854300e91d1de27`, with the Phase 1 figures: MYR −2,692.92 and April MYR 35,446.45.
3. **`/ask`.** *AI-assisted (verified)* →
   - "Who did we pay the most this month?" gives a verified answer with highlighted figures.
   - "Which supplier did we pay the most?" is refused, with the classification explanation.
4. **Budget.** Repeated calls from one browser eventually return `CLIENT_RATE_LIMITED` (6 per minute) rather than unbounded calls.
5. **Rule-based Phase 1 still works.** The synthetic sample gives processing `f53429a06ee2870a62a3da07`.

## Switching it off

Remove `FINGENCE_AI_GATEWAY` (or the key) and redeploy. Both routes return 404 again and the pages fall back to Phase 1. No data is stored server-side, so there is nothing to clean up.

## Known limits (proof of concept)

- **Free-tier Groq:** at 8k tokens per minute, two AI documents in one minute trigger one designed retry, and a heavy day can hit the daily cap. When that happens documents are quarantined, never guessed.
- **Misgrounding:** the grounded Q&A withholds known classes of semantic misgrounding. An unseen paraphrase can still answer a nearby question; "How this was answered" always shows the queries used.
