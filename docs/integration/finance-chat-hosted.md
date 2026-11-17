# Running the Finance chatbot on the live site

**For:** Jason (owner of `finance-chat`). **Status:** guide; nothing here is built yet.
**Goal:** signed-in SAIC users can use your review-first Groq chat on the live site, safely, with the same checks it has
locally today.

Read [`AGENTS.md`](../../AGENTS.md), [`CONTRIBUTING.md`](../../CONTRIBUTING.md) and
[`docs/ai-integration/ai-calls.md`](../ai-integration/ai-calls.md) first. Work on a branch from the latest `main` with git
(`git fetch origin && git switch -c feature/finance-chat-hosted origin/main`). Do not use "Add files via upload": it replaces
whole files with old copies and drops other people's changes.

## Why it does not run on the live site today

Your chat (`lib/server/poc-finance-qa/groq-chat.ts`, `components/poc-finance-qa/workspace.tsx`) is built for a developer's
machine:

| Today (local only) | On the live site |
|---|---|
| Starts only with `pnpm poc:groq`, which sets `FINGENCE_POC_LOCAL=1` and `FINGENCE_POC_GROQ=1` | Vercel never sets these, so `/chatbot` shows Fin |
| `pocRequestAllowed()` accepts loopback requests only | Requests come from the internet |
| Signs people in with the local M2 accounts (`m2Runtime().identity`) | People sign in to the SAIC workspace (`fingence_session` cookie) |
| Reads verified facts from a local database (`resolveFacts`) | Verified results live in the person's processed run in the browser (and History) |
| Keeps previews in memory (`const previews = new Map()`) | Vercel runs many short-lived copies of the server; a preview saved on one is missing on the next |

The Obsidian demo (`lib/server/obsidian-demo/*`) reads notes from a folder on disk. It cannot run on Vercel and stays a
local demo. Leave it as it is.

## What stays exactly as it is

These are the strong parts; keep them and their tests:

- The review-first flow: the person sees the exact passages that will be sent, approves, then the question is sent once.
- `FINANCE_CHAT_SYSTEM`, the output schema, and every answer check: citations, `hasUnsupportedNumber`, `hasUnboundFigure`
  (figures bound to their cited measure), and the refusal checks (`questionRefusal`, `preCheck`).
- Budget admission before any provider call, and the `finance-chat` feature on its own key, `GROQ_API_KEY4`
  (already set on Vercel). Every call already appears on the Technical log through `structuredCompletion`.

## The changes, in order

### 1. One switch, off by default

Add `financeChatHostedEnabled()` (for example in `lib/server/poc-finance-qa/hosted.ts`):

```ts
export const financeChatHostedEnabled = () =>
    process.env.FINGENCE_FINANCE_CHAT === '1' && aiGatewayEnabled() && groqConfiguredFor('finance-chat') && !!budgetStore();
```

When it is false, the route returns 404 and the page shows only Fin. The owner turns it on, first on Preview, then on
Production. Nothing changes for users until then.

### 2. Build the passages from the person's processed run

`financeChatPassages(facts, question)` takes `QaFacts`. The browser already has the same type:
`qaFacts(context)` in `lib/demo/questions.ts` builds it from the processed run (`useDemoProcessing().context`).

- Move the pure parts out of the server-only file into `lib/poc-finance-qa/passages.ts`, with no `server-only` import:
  `financeChatPassages`, `numberTokens`, `hasUnsupportedNumber`, `hasUnboundFigure`, `isoMonths` and the types.
  `groq-chat.ts` imports them from there, so local mode keeps working unchanged.
- The browser builds the passages for the preview. The server validates their shape with zod before anything else:
  at most 3 passages, each heading one of the known headings, and length limits on every string. It also re-runs
  `questionRefusal` on the question.

This is the same trust model as Fin and the grounded Q&A: the signed-in person's own processed run is the source, and
every figure in the answer must come from the passages that were shown and approved.

### 3. A hosted API route with the workspace sign-in

Create `app/api/ai/finance-chat/route.ts`. Copy the shape of `app/api/ai/fin/route.ts`:

```ts
export async function POST(request: Request) {
    if (!financeChatHostedEnabled()) return notFound();
    const read = await boundedJson(request, MAX_BODY_BYTES);
    if ('refusal' in read) return read.refusal;
    const gate = await processingGate(request.headers, { ai: true });          // signed in, AI allowed, not paused
    if ('refusal' in gate) return json({ code: gate.refusal.code }, gate.refusal.status);
    return runAsCaller(aiCaller(gate.principal), () => handle(request, read.body)); // attributed on the Technical log
}
```

- Use the actions `preview` and `send` (and a `GET` for availability), with the request bodies validated by zod.
- Bind each preview to the person: use `gate.principal.memberId` where the local version hashes the M2 session token.
- Keep `admit({ client: clientAddress(request.headers), worstCaseUsd })` before the provider call, and `settle()` after it.
- The proxy (`proxy.ts`) already answers 401 for any `/api/` request without a session, so do not add the route to its
  open list.

### 4. Previews that survive Vercel's many server copies

Replace the in-memory `previews` map:

- **Preview:** return a signed preview token. Sign `{ memberId, payloadHash, expiresAt, nonce }` with HMAC-SHA256, using
  `budgetStore().secret` (or a new `FINGENCE_FINANCE_CHAT_SECRET` if the owner prefers). Keep the 5-minute expiry.
- **Send:** the browser sends the token and the exact approved payload. The server checks the signature, the member, the
  expiry and that the payload hashes to `payloadHash`, then claims the nonce once:
  `await budgetStore().store.add('finance-chat:nonce:' + nonce, 1, 600) === 1`. Any other value means a replay; refuse it
  with `PREVIEW_UNAVAILABLE`. Claim the nonce **before** budget admission, so two parallel sends cannot both spend.

### 5. The page

On `/chatbot`, when `financeChatHostedEnabled()` is true, show two tabs: **Fin** (the default) and **Review before
sending** (your chat). Your hosted component:

- reads `useDemoProcessing().context`; with no processed run, it says "Process a sample or your own documents on Data
  first" and links to `/data`;
- shows the preview card (the passages that will be sent), then **Approve and send**, then the answer with its cited
  sections, or your safe fallback;
- follows the app's look (`components/ui`, `components/demo/shared`) and works on a phone (44 px tap targets).

Keep `FinanceQuestionsWorkspace` for local mode. Do not change Fin.

## Tests to add

Under `tests/finance-chat-hosted/`, with a fake transport only (never a real key):

1. The route is 404 when the switch is off, or when `GROQ_API_KEY4` or the budget store is missing.
2. Signed out → 401; signed in but AI disabled or processing paused → the gate's refusal.
3. A malformed body, too many passages or an unknown heading → 400, before budget or provider.
4. A tampered token, another member's token, an expired token, or a payload that does not match → refused.
5. Replaying a token, or two parallel sends of one token → only one reaches the budget and the provider.
6. The budget is admitted before the provider call, and a budget refusal means no provider call.
7. Your existing answer checks still withhold an invented figure, a figure under the wrong measure, and a missing citation.
8. Local mode (`poc:groq`) behaves exactly as before: the existing tests pass unchanged.

Run `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` before you push.

## Trying it before the live site

1. Locally: `FINGENCE_FINANCE_CHAT=1 FINGENCE_AI_GATEWAY=1 GROQ_API_KEY4=<your key> pnpm dev`, then process a sample on
   Data and open `/chatbot`.
2. Open your PR. The owner sets `FINGENCE_FINANCE_CHAT=1` for **Preview** only and you test the Vercel preview link
   while signed in.
3. After review and green CI, the owner merges and sets `FINGENCE_FINANCE_CHAT=1` for **Production**, then redeploys.

## Definition of done

- [ ] Off by default; on only through `FINGENCE_FINANCE_CHAT=1`, with `GROQ_API_KEY4` and the budget store present.
- [ ] Signed-in SAIC members only, through `processingGate(..., { ai: true })`; calls attributed with `runAsCaller`.
- [ ] Previews signed and single-use across server copies; no in-memory state on the live path.
- [ ] Every existing answer check kept; new tests above pass; local `poc:groq` unchanged.
- [ ] A `CHANGELOG.md` line under **Unreleased**, and screenshots (light, dark, phone) in the PR.

## Prompt to paste into your AI coding assistant

> Read AGENTS.md, CONTRIBUTING.md, docs/ai-integration/ai-calls.md and docs/integration/finance-chat-hosted.md in this
> repository. Implement the hosted Finance chatbot exactly as that guide describes, in its order: the off-by-default
> switch, passages built from the browser's processed run, the hosted route with the workspace sign-in, signed
> single-use previews, and the /chatbot tab. Keep every existing answer check and test, keep local poc:groq unchanged, do
> not change Fin, never log or commit prompts, answers, figures or keys, and add the tests the guide lists. Run
> pnpm typecheck, pnpm lint, pnpm test and pnpm build before finishing.
