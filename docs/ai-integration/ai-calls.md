# AI calls: the door every model call goes through

**Rule: every call to an AI model in FinGence goes through `withAiCall` from `lib/ai-calls`.** That one line is what puts your feature on the **Technical log** (`/log`, Admin and Superadmin). SAIC asked to see clearly what the AI did, so this is how they see your feature: what was called, which model, whose key, tokens, cost, time and outcome.

It works with any provider SDK and with your own Groq key. It records **metadata only**. A logging problem never breaks your feature.

CI enforces the rule: `tests/ai-calls/guard.test.ts` fails the build if a file calls a model provider (`api.groq.com`, `groq-sdk`, `new OpenAI(`, `.chat.completions.create(`, …) without `withAiCall`.

## Quick start (three steps)

1. **Register your feature** with one line in [`lib/ai-calls/features.ts`](../../lib/ai-calls/features.ts):

   ```ts
   'recon-suggest': { label: 'Reconciliation suggestions', owner: 'Celester' },
   ```

   Use lower-case words joined by hyphens. Some slugs are already reserved:

   | Slug | Feature | Owner |
   |---|---|---|
   | `finance-chat` | chatbot | Jason |
   | `recon-suggest` | reconciliation suggestions | Celester |
   | `report-explain` | report explanation | Izzat |
   | `forecast-note` | forecast notes | Frederick |

2. **Wrap the call.** `withAiCall(meta, run, judge?)` returns exactly what `run` returns.

   ```ts
   import { withAiCall } from '@/lib/ai-calls';

   const reply = await withAiCall(
       { feature: 'recon-suggest', model: 'openai/gpt-oss-120b' },
       () => groq.chat.completions.create({ model: 'openai/gpt-oss-120b', messages }),
   );
   ```

3. **Name your key (optional, recommended).** In your `.env.local`, set `AI_KEY_LABEL=celester-groq`. The log then shows whose key paid. It is a name only; **never put the key itself there.**

## Examples

**groq-sdk**
```ts
import Groq from 'groq-sdk';
import { withAiCall } from '@/lib/ai-calls';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const reply = await withAiCall({ feature: 'finance-chat', model: 'openai/gpt-oss-120b' },
    () => groq.chat.completions.create({ model: 'openai/gpt-oss-120b', messages, temperature: 0 }));
```

**OpenAI SDK pointed at Groq**
```ts
import OpenAI from 'openai';
import { withAiCall } from '@/lib/ai-calls';

const client = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
const reply = await withAiCall({ feature: 'report-explain', model: 'openai/gpt-oss-120b' },
    () => client.chat.completions.create({ model: 'openai/gpt-oss-120b', messages }));
```

**Plain fetch.** Return the parsed JSON, so the door can read `id`, `model` and `usage`.
```ts
const reply = await withAiCall({ feature: 'forecast-note', model: 'openai/gpt-oss-120b' }, async () => {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-oss-120b', messages }),
    });
    if (!res.ok) throw Object.assign(new Error('Groq refused'), { status: res.status });
    return res.json();
});
```

**FinGence's shared client.** `structuredCompletion` in `lib/server/ai/groq.ts` already goes through the door. Pass your `feature`:
```ts
const { content, receipt } = await structuredCompletion({ feature: 'recon-suggest', model, system, user, schemaName, schema, maxCompletionTokens: 800, reasoningEffort: 'low' });
```

**Tell the log what your checks decided (optional).** If your feature checks the answer on the server, pass a `judge`. It returns a verdict and, optionally, a reason code:
```ts
await withAiCall({ feature: 'recon-suggest', model }, () => call(),
    reply => verifySuggestion(reply).ok ? { verdict: 'ACCEPTED' } : { verdict: 'QUARANTINED', reasonCode: 'AMOUNT_MISMATCH' });
```
- Verdicts: `ACCEPTED`, `QUARANTINED`, `ANSWERED`, `WITHHELD`.
- Reason codes are upper-case words joined by `_`.

**Streaming.** Collect the final `usage` and record it on the note the door passes in:
```ts
await withAiCall({ feature: 'finance-chat', model }, async note => {
    const stream = await groq.chat.completions.create({ model, messages, stream: true });
    for await (const part of stream) { /* … */ if (part.x_groq?.usage) { note.inputTokens = part.x_groq.usage.prompt_tokens; note.outputTokens = part.x_groq.usage.completion_tokens; } }
    return null;
});
```

**Refused before any model call** (for example, your pre-check blocked the question):
`await recordAiRefusal({ feature: 'finance-chat', model }, 'REFUSED_BEFORE_MODEL')`.

## Who made the call

- **FinGence routes:** the route sets the caller once, and every `withAiCall` inside it (however deep) is attributed to that person. Copy what `app/api/ai/ask/route.ts` does:
  ```ts
  const gate = await processingGate(request.headers, { ai: true });          // signed in, not paused, AI on
  if ('refusal' in gate) return json({ code: gate.refusal.code }, gate.refusal.status);
  return runAsCaller(aiCaller(gate.principal), () => yourHandler(request));
  ```
  `processingGate` also respects the Superadmin's AI switch and the Admin's pause. Use it for every AI route.
- **Server processing jobs** are attributed automatically (`app/api/processing/jobs/route.ts`).

## What is recorded, and what never is

| Recorded | Never recorded |
|---|---|
| feature, provider, model | the prompt or question |
| key **name** (`AI_KEY_LABEL`, or `key-1`/`key-2` for FinGence's two keys) | the answer or any model output |
| provider request ID | document text, file contents, records |
| input/output tokens, estimated cost (from `lib/ai-calls/prices.ts`) | amounts, names of counterparties |
| time taken, status (`OK`, `REFUSED`, `RATE_LIMITED`, `FAILED`) | the API key |
| your verdict and reason code, who and when | |

- **The contract enforces this.** `lib/ai-calls/contract.ts` is strict, so an extra field is rejected rather than stored, and every text field has a fixed pattern.
- **Retention:** 90 days.
- **New model?** Add its price to `lib/ai-calls/prices.ts`. Without it, the cost shows as "—" and is never guessed.

## Where you see it

- **Your machine:** with no FinGence database, each call is appended to `.local/ai-calls/YYYY-MM-DD.jsonl`, one JSON line per call. `.local/` is git-ignored.
- **Local FinGence with sign-in** (`scripts/dev-store.mjs`): calls go to the local database and appear on `http://localhost:3000/log`.
- **Production:** `/log`, for Admins and Superadmins. It has filters for feature, person, "AI only" and "Problems", plus a CSV export.

## Checks to run before you push

```bash
pnpm exec vitest run tests/ai-calls
```
- The guard test tells you which file bypasses the door.
- The door tests show the behaviour (usage parsing, errors, verdicts, "never the content").

## Paste this to your AI coding assistant

> In FinGence, every AI model call must go through `withAiCall` from `@/lib/ai-calls` (read `docs/ai-integration/ai-calls.md` first).
> - Register my feature slug `<your-slug>` in `lib/ai-calls/features.ts` with label `<label>` and owner `<name>`.
> - Wrap each model call as `withAiCall({ feature: '<your-slug>', model: '<model>' }, () => <the call>)`. Return the provider's reply unchanged so the door can read `id`, `model` and `usage`.
> - If my code checks the answer on the server, pass a judge returning `{ verdict, reasonCode }`.
> - In API routes, gate with `processingGate(request.headers, { ai: true })` and run the handler inside `runAsCaller(aiCaller(gate.principal), …)`.
> - Never log or store prompts, answers, document contents, amounts or keys.
> - Run `pnpm exec vitest run tests/ai-calls` and fix anything the guard test reports.
