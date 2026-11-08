# FinGence 2.0 AI M1 → M2: sequential, feature-disabled integration plan

**Timing.** Not before the 3 November poster presentation. Production stays on `cb5db46` (Phase 1) for the poster.

**Throughout:**
- The Groq gateway stays **disabled**: no `FINGENCE_AI_GATEWAY`, `GROQ_API_KEY` or `FINGENCE_AI_BUDGET_REST_*` in Production or Preview.
- Public AI activation is a separate decision. It requires hosted budget-store testing, spending controls and complete live walkthrough evidence.

| Order | PR | Approved head | Base at approval |
| --- | --- | --- | --- |
| 1 | #56 AI M1 (layout interpretation) | `ef18819eac875ef830b5a92e93c30a260d6edb53` | `main` @ `cb5db46` |
| 2 | #58 AI M2 (grounded Q&A) | the head recorded in the M2 review package (feature-disabled merge candidate) | `claude/fingence2-ai-m1-interpretation` → retarget to `main` in step B1 |

## 0. Before either merge (owner)

1. **Environment variables.** In Vercel → `fingence-financeintelligence` → Settings → Environment Variables, confirm **none** of these exist for Production or Preview:
   - `FINGENCE_AI_GATEWAY`
   - `GROQ_API_KEY`
   - `FINGENCE_AI_BUDGET_REST_URL`
   - `FINGENCE_AI_BUDGET_REST_TOKEN`
2. **Base commit.** `git fetch origin && git rev-parse origin/main` must still be `cb5db46`. If `main` moved, stop, update, and re-verify both PRs.
3. **Rollback target.** Record the current Production deployment: GitHub deployment 7466018233 of `cb5db46`, Vercel `dpl_6y1hEJdmGwuRBT8yoGCVkyLZxW5N`.

## A. Merge PR #56 (M1)

**Pre-merge checks:**

A1. **PR state.**
```sh
gh pr view 56 --json headRefOid,baseRefName,isDraft,statusCheckRollup
```
- The head must be `ef18819…` and the base `main`.
- `verify` and both Vercel checks must pass.
- If the head changed, stop: it is no longer the approved commit.

A2. **Merge.** Mark it ready (`gh pr ready 56`), then merge with **Create a merge commit**, as for #55. Record the merge SHA as `M1_MERGE`.

**Post-merge checks on the new Production deployment** (follow `MERGE-AND-ROLLBACK-CHECKLIST.md` in the M1 handoff package):

A3. **Deployment.** Production is a READY deployment of `M1_MERGE`, and the GitHub Production deployment `sha` equals `M1_MERGE`.

A4. **Gateway off.** Both must print `404`:
```sh
curl -s -o /dev/null -w '%{http_code}\n' https://fingence-financeintelligence.vercel.app/api/ai/interpret
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' https://fingence-financeintelligence.vercel.app/api/ai/interpret
```
`/data` must not contain the text `unfamiliar-layout samples (AI)`.

A5. **Phase 1 flow, signed out, desktop and 390 px.** Expect:
- processing **f53429a06ee2870a62a3da07**;
- difference **MYR −2,692.92**;
- outcomes **46/4/3/2/2/1/1**;
- **6** anomaly candidates;
- April net **MYR 35,446.45**.

A6. **Console.** Expect exactly one line, `Failed to load resource: … 404` (the M1 status probe of `/api/ai/interpret`). This is known at `ef18819` and removed by M2. Any other console error is a failure.

A7. **Restricted routes.** Replay the isolation probes read-only.
- *Strict 403/404 rule:* expect 70 of 71 blocked. The other probe is the forecast POST, which returns HTTP 405 because that route has no POST handler; the repository checker accepts this.
- *Failure:* any other status, or a changed count.

**Rollback (M1):** Vercel Instant Rollback to `dpl_6y1hEJdmGwuRBT8yoGCVkyLZxW5N` (`cb5db46`). Alternatively, `git revert -m 1 M1_MERGE` through a PR. Then repeat A4–A7.

## B. Merge PR #58 (M2), only after A passes

B1. **Retarget and verify.**
```sh
gh pr edit 58 --base main
gh pr view 58 --json headRefOid,baseRefName,commits
```
- The head must be the approved M2 head.
- The PR must now list only the M2 commits (since `ef18819`).
- `git diff --stat M1_MERGE origin/claude/fingence2-ai-m2-grounded-qa` must show only the M2 files listed in the review package.

B2. **CI against `main`.** Wait until `verify` and both Vercel checks pass on the retargeted PR. The Preview must have the gateway off:
- `/api/ai/ask` and `/api/ai/interpret` both return 404;
- `/ask` is the rule-based page.

B3. **Merge.** Mark it ready (`gh pr ready 58`), then merge with **Create a merge commit**. Record the merge SHA as `M2_MERGE`.

**Post-merge checks on the new Production deployment:**

B4. **Deployment.** Production is a READY deployment of `M2_MERGE`, and the GitHub deployment `sha` equals `M2_MERGE`.

B5. **Gateway off.** All four must print `404`:
```sh
for p in interpret ask; do for m in GET POST; do curl -s -o /dev/null -w "$p $m %{http_code}\n" -X $m -H 'content-type: application/json' -d '{}' https://fingence-financeintelligence.vercel.app/api/ai/$p; done; done
```

B6. **Phase 1 flow.** The same figures as A5 must hold.

B7. **`/ask`.**
- It shows "Rule-based source assistant, not live AI".
- There is no "AI-assisted (verified)" button.
- A suggested question gives an "Answered from source" answer.

B8. **Console and network.**
- **0** console errors: the M1 404 line is gone.
- **No** requests to `/api/ai/*` on `/data` or `/ask`.

B9. **Restricted routes.** As A7: strict rule 70/71, with the 405 explained.

**Rollback (M2):** Vercel Instant Rollback to the `M1_MERGE` Production deployment, or `git revert -m 1 M2_MERGE`. Then repeat B5–B9 against the M1 expectations in A4–A7.

## Not part of this integration

- Setting any AI environment variable.
- Provisioning the hosted budget store.
- A Groq key.
- Live AI walkthroughs on Production.

Activation needs its own approval and the evidence listed in the M1 and M2 reports.
