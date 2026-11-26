# Assistant v3: a colleague with a mood, and the person's own controls

FinGence's assistant (Fin by default; each person may rename theirs) is moving from a passive chat panel to a colleague
whose state follows the books. The plan is the nine-PR MVP in the v3.0 proposal; this note records what is built.

## Moods come from FinGence, never from the model

`lib/fin/mood.ts` (`assistantMood`) turns signals FinGence already has into one mood, in this order:

| Mood | Signal | Face | Line (counts from code) |
|---|---|---|---|
| working | processing is running, or a reply is in flight | thinking | "Reading and checking your documents." |
| paused | the AI is off here, rate-limited or over budget | eyes closed, dimmed, "z" | FinGence's own checks still work |
| unsure | the last reply failed `verifyFinReply` or the grounded gate, or confidence is LOW or INCOMPLETE | brow tilted, no sparkle | what failed and where to look |
| found | `attentionCounts`: reconciliation differences no rule explained, flagged payments, documents set aside | wide eyes, amber "!" | "{n} bank differences aren't explained yet." |
| pleased | the run is reconciled, nothing needs a person and confidence is HIGH | happy, one hop under a second | "{period} reconciles: every check passed and nothing needs you." |
| resting | everything else | idle | none |

- The model never sets a mood and never writes a mood line.
- "Pleased" is the only cheerful mood, and only code can earn it.
- "Needs you" (a Fin proposal waiting for accept or reject) arrives with the proposals table in PR 7.

## Where the mood shows

- **The floating button:** the face, and a count badge for "found".
- **The panel header and the full page:** the face, and a one-line status with a link to the page.
- **Screen readers:** a polite live region announces only "found", once per change.
- **Waiting states** (`components/waiting.tsx`) use the same face, thinking.

## The person's controls

Settings are kept per member (`workspace-v9-assistant.sql`, `workspace-v10-assistant-controls.sql`), or in this browser
when the workspace is off. The strict shape is `{v: 2, name, tone, quiet, character, motion}`, and a name-only v1 row
still reads.

| Control | Effect |
|---|---|
| Name | The name the assistant introduces itself by; the rules are in `cleanAssistantName` |
| How it writes | Concise (the default) or friendly; sent as `tone`, and the system prompt sets the rules for each |
| Quiet mode | No status line and no announcements, and the face stays resting; the count badge stays |
| Show the character | Off draws a plain chat icon everywhere, waiting states included (`AssistantFace`, `AssistantLook`) |
| Motion | Follow the device, or off (`data-assistant-motion="off"` stops every assistant and waiting animation) |

## Ethical lines kept in code

- No guilt, no streaks, no notifications outside the app.
- The AI is disclosed in the greeting and the footer.
- A test keeps every mood line free of exclamation marks, money and "missed you".

## The narrated run (PR 3)

On Data, Step 2 is the assistant's live narration of the eight stages (`components/fin/run-trace.tsx`,
`lib/fin/narrate.ts`).

- **While processing:** each finished stage gets one line written by code from its own decision and checks ("Matched the
  bank to the books · 54 of 54 checks"), followed by what is running now ("Matching the bank to the books…").
- **A stage that was set aside or could not run** shows the stage's own summary as the reason.
- **When the run ends:** a closing line counted from the stages ("Done: all 8 stages passed and 72 of 72 checks
  passed."), then the assistant's mood line with a link ("1 payment is worth a second look. Open Anomalies").
- **Every check:** the full stage list folds behind "Show every check", and stays open for a quarantined run.
- **No model calls:** the narration can say nothing the pipeline did not report. `tests/fin/narrate.test.ts` checks it
  stage by stage against all three samples.

## The assistant's tools (PR 4)

`lib/fin/tools.ts` gives the assistant sixteen tools. They are read-only or compute only: none applies, writes or
proposes anything. Each one wraps code FinGence already has, runs without a model or I/O, and returns facts in the
grounded Q&A's shape:
- typed values with the record IDs behind them;
- at most 20 rows, with a `truncated` flag;
- facts numbered F1, F2… across one task, so an answer can cite a figure only as a placeholder such as `{F3.net}`.

| Tools | Wraps |
|---|---|
| `cash_summary`, `transactions`, `counterparties`, `monthly_history`, `reconciliation`, `anomalies` | The grounded Q&A tools, unchanged, with the run's own months and counterparties checked |
| `exceptions`, `exception_detail` | The reconciliation layer's unexplained items, their records and any correcting entry |
| `candidate_matches` | New pure code that ranks records on the other side by a shared reference token and the amount (exact, within 1%, within 5%), then days apart; labelled as leads, never matches |
| `anomaly_detail` | One anomaly candidate, the rules it met and what the books say |
| `categories`, `cash_flow_statement`, `biggest_changes` | Cash classification and its insights (the books' own categories) |
| `cash_plan`, `confidence` | The six-month cash plan with its backtest, and processing confidence |
| `compute` | Sum, difference, percent change or share of amounts already in the task: the only way to derive a new figure |

Guard rails:
- **Errors are results:** a bad tool name, bad arguments or a value not in the run comes back as a readable error result,
  never an exception.
- **Untrusted document text:** fields holding text from the documents (`UNTRUSTED_FIELDS`: description, reference,
  counterparty, name, category, rationale) are quoted to the model as untrusted data.
- **Tests:** `tests/fin/tools.test.ts` runs every tool on the three samples, plus a March run with one ledger amount
  changed in memory to create a real unexplained item.
