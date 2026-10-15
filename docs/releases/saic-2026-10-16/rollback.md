# Release gates and rollback

Recorded original remote main checkpoints, 15 October 2026:

- Team `Xinyr/FYP-A-B/main`: `aa434d17e248bb509e586bd0e909eefcad6b1b74`.
- Personal `Yoriichi-0u0/FinGence-Finance-Intelligence/main`: `af637c5e497baf11b8d58910f4f98b50cb24d87e`.
- Reviewed personal source: `ingestion-c3-i0-v0.1` → `c32216e191706d1e4c6f80c57165f160bb70bc77`.
- Last verified production deployment: `dpl_JPnDJjnChTQXvRx3RSGAVvofXnYa`, C2 commit `88f2e2362aae58738107ed73a1b152da04ce8656`.
- Existing public hostname: `https://finsight-financeintelligence.vercel.app/`.

## Before publication

Recheck remote main and candidate SHAs, CI results and a non-author approval on the exact integration candidate. Approval to implement does not replace the team review gate. Do not force push, overwrite feature branches or merge obsolete PR #1 as a shortcut.

## Candidate failure

Do not merge it. Keep the last working production deployment. Repair in the isolated integration branch and rerun affected tests/build/browser rehearsal. A new commit requires current review/checks.

## After an authorized release

Use ordinary GitHub revert PRs for repository rollback; never reset or force push main. Preserve the release and all earlier ingestion/branding tags. Rehearse the application through a verified preview before making another production change.

If a production release is broken, restore the recorded working deployment through the existing Vercel project's rollback controls, then open the public hostname and verify actual content. Record the alias target and note that Vercel rollback may disable automatic production alias assignment until a deliberate later promotion.

No hosted migration is run by this release. There is therefore no hosted database rollback to invent. Disposable local databases are destroyed by the tests; unknown COMMIT outcomes on a future hosted write must be investigated using its retained attempt UUID, without automatic replay.

The two original worktrees, stash `1aa97d83500cab7055d1d8dda0b3fe727ae11556`, external modified-sample backups and historical release packages are protected and never used as integration working copies.
