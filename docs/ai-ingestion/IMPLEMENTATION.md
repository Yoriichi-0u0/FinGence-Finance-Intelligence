# FinGence 2.0 experimental ingestion — execution ledger

Approved plan: four-format extraction, genuine provider-based rule synthesis,
independent verification, deterministic financial processing and an isolated local UI.
Baseline: da10e2f21add1fec5449ac32ea1affdd8024563b.

## Constraints

- Synthetic data only. No production, main-branch, database or C1/C2 changes.
- US$5 aggregate application-level inference ceiling; no live call without credentials,
  model/pricing verification and an atomic persistent reservation.
- Never manufacture human approval. V2 uses its own machine-verification report.
- Preserve existing ingestion source and fixture bytes; use existing normalizers and validator.
- No commit, push or deployment in this increment.

## Progress and rulings

- Isolated branch `feature/v2-multimodal-ingestion` prepared.
- Credential destination was declined twice. No key was created or written.
- Ruling: continue non-inference implementation under the user's explicit fallback
  instruction; live AI remains unavailable, never replaced by a UI mock.
- Existing ingestion tests in planning: 168 passed, 1 optional workbook skipped.
- Extraction comparison and current implementation verification are recorded separately
  as executed; planned tests are not results.
- Ruling: exclude only `/ai-ingestion` from the shared shell's illustrative-page notice.
  Its extraction is real; its own experimental notice identifies missing live AI. All
  existing route behavior is preserved. This is a one-line local-branch shell change.
- Actual extraction benchmark selected Docling/RapidOCR for PDF/images; the existing
  CSV/XLSX readers remain unchanged. Results are in `docs/research/`.
- Independent review identified exact-citation mapping swaps/omissions and partial
  Docling conversion. Regression tests reproduced the former; both gates are fixed
  and the focused re-review found the two P1 issues closed.
- The Python environment is external local runtime configuration, not a traced Next
  production asset. This resolved the actual initial build failure.
- Final full verification: 452 tests passed, 9 historical optional/native skips;
  lint, typecheck, build, server guards and frozen installation passed. Actual audit:
  0 critical, 6 high, 5 moderate, 1 low. See `verification.md` for limits and commands.
- Browser: eight desktop uploads/downloads and a restarted-launcher scanned-PDF
  check; 768/390/320 px without horizontal overflow. Live inference remains blocked.
- Credentials absent; no OpenAI requests/tokens/spend/reservations. Recorded proposals
  are test-only. No commit, push, main edit, deployment or hosted database operation.
