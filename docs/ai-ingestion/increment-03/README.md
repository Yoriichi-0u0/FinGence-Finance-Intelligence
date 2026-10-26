# FinGence 2.0 Increment 03

**IMPLEMENTED / INDEPENDENTLY REVIEWED / LIVE INFERENCE NOT EXECUTED.**
Synthetic documents only. Groq is the primary prepared provider (`openai/gpt-oss-20b`),
not an OpenAI API request. No credentials were created/read through setup, no key was
written, no provider dispatch/model download occurred, and no production release is made.

## Run without credentials

Use the existing Node 24.x / pnpm 11.19.0 and Python 3.12 virtual environment:

```sh
pnpm install --frozen-lockfile
node --conditions=react-server scripts/ai-increment-03.mjs doctor
node --conditions=react-server scripts/ai-increment-03.mjs evaluate
node --conditions=react-server scripts/ai-increment-03.mjs evaluate --regression
pnpm test tests/ai-ingestion-03
node scripts/ai-demo-03.mjs
```

Open **http://127.0.0.1:3107/ai-ingestion/live**. Choose a CSV, XLSX, digital/scanned
PDF, PNG or JPEG sample. Processing genuinely extracts the source and then explicitly
blocks inference. It accepts no records without a model proposal. The JSON download
contains evidence, source coordinates and `NOT_EXECUTED`, never simulated AI success.
`run <registered-source-path>` similarly returns exit 2 when inference is unavailable.
The earlier finance page and `/ai-ingestion/developer` RECORDED_TEST path remain separate.

The CLI defaults to NO INFERENCE and disables dispatch flags unless `--live` is explicitly
supplied. It never loads an environment file itself. Evaluation labels are read only by
the evaluator, never inference/materialization/verification. Reports go to the ignored
`.ai-local/increment-03/` folder. Do not delete/edit its quota ledger to gain more requests.

## Secure setup boundary — not performed

Before any later live run the user must separately authorize synthetic evidence transmission
and dispatch, provide a dedicated **Groq Free Plan** key through an approved secure mechanism,
and verify account/model access and effective limits. Do not reuse an OpenAI key, add a
payment method, upgrade the plan or retry a previously declined key-creation flow.
A future local `.env.local` must first be checked for symlinks/existing credentials,
Git exclusion and owner-only permissions; on Windows use equivalent restrictive ACLs.
This increment creates no credential file or shell command containing a key.

Required server process variables after that separate authorization:

- `GROQ_API_KEY` (secret; never frontend/source/output).
- `FINGENCE_AI03_FREE_PLAN_CONFIRMED=1` after actual account verification.
- `FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED=1` after explicit dispatch authorization.

These flags are operator declarations, not a provider billing API or authentication.
No paid inference is authorized; the older US$5 OpenAI ledger is untouched. A valid
key alone does not authorize dispatch. Real strict-schema acceptance/model availability
is untested until the first authorized request. There is no automatic provider fallback.

## What is implemented

- Opaque evidence-linked, schema-constrained mapping plans; source values are bound by
  deterministic materialization, not generated transactions.
- Unchanged experimental financial policy/verifier; new LIVE_GROQ/LIVE_OLLAMA origins.
- Exclusive durable quota reservations before inference dispatch, with no automatic retries.
- Actual four-format extraction, a separate held-out source/label set, evaluation CLI and
  simple local interface. Unsupported bank/invoice interpretations remain held.
- An Ollama transport seam, tested with mocked HTTP only. It never pulls models.

See [architecture](architecture.md), [evaluation](evaluation.md), [verification](verification.md)
and [Windows preparation](windows.md). Completed source is reviewable, but genuine LLM
accuracy, live latency/free-tier access, Katana execution and lab GPU performance are unmeasured.
