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
