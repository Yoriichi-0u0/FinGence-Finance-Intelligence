# FinGence server processing v1: jobs, stored results, Management console

5 November 2026, checkpoint 10 of the roadmap (#78). Processing runs as **server jobs**. Each finished job stores its
reconciliation and anomaly results and every flagged item **next to its ingestion run** (the verified records). One
**Management console** lists the jobs and the flagged items and holds the switch that pauses processing. FinGence stays
autonomous: no job waits for approval, and nothing in the console approves anything.

## Flow

1. **Data page.** With server processing on, *Process Financial Documents* sends the documents to `POST /api/processing/jobs`.
   - The request must be same-origin, bounded, schema-checked and rate-limited per client.
   - It is refused with **423** and the stated reason while processing is paused. The pause is checked by the store in the statement that creates the job.
   - Otherwise the server answers **202** with the job ID straight away.
2. **The job** runs after the response (`after()`, `maxDuration` 300 s, its own 280 s limit). It uses the same pure pipeline the browser runner uses (`processDocuments`), with:
   - the AI layout reader called in-process from the same spend budget and retry rule as the browser gateway (`lib/server/ai/interpret.ts`);
   - PDF text and OCR read on the server (`pdf.js` and `tesseract.js` are `serverExternalPackages`). A scanned page that is not one stored JPEG is rendered on pdf.js's own Node canvas (`@napi-rs/canvas`), as the browser renders it on its canvas.
   Each stage is recorded as it finishes (`fingence_processing_job_stage`).
3. **Finishing** (`fingence_processing_finish_job`) is one transaction. It stores:
   - the ingestion run (`fingence_ingestion_record_run`: fingerprints, decisions, model receipts, gate checks, verified records);
   - the results (`lib/processing/job-result.ts`: reconciliation per month with every resolved item and correcting entry, anomaly resolutions, management summary, document decisions);
   - every flagged item (`flaggedItems`: the context's quarantine, with month, date and amount, plus documents no reader could take).
   A failure is recorded as a short code (`STORE_HTTP_500`, `TIMED_OUT`, `PROCESSING_FAILED`). A run with more than 10,000 flagged items is refused as a whole (`TOO_MANY_FLAGGED`); it is never stored as an apparently complete subset.
4. **The browser re-checks** the job. It polls `GET /api/processing/jobs/<id>`. Then it re-runs the same pipeline on the same documents and must reach the job's processing ID, or nothing is shown. The re-check uses:
   - the job's accepted layout readings (no model call);
   - for PDFs and scans, the table the job read. OCR engines differ between server and browser, so a second OCR pass would not re-check the first; every gate and the arithmetic anchor still run on that table.
   A browser running on its own (server processing off) is unchanged. After a reload, a saved job result is shown only if the replay still reaches that job's processing ID. An open tab re-reads the pause state every 15 s and whenever it is focused again, so a resume reaches Finance users without a reload.

## What is stored, and what is not

- **Never stored:** the uploaded documents. They exist only in the job's memory.
- **Kept for the browser's re-check, then deleted:** for PDFs and scans, the words read from them. They are deleted 15 minutes after the job finishes.
- **Stored per job:**
  - input names, sizes and fingerprints;
  - stage decisions and failed checks;
  - the processing ID, outcome and scope;
  - the accepted AI layout readings (no amounts);
  - the results;
  - the flagged items;
  - a link to the ingestion run.

Schema `fingence_processing` (`supabase/sql/processing-jobs-v1.sql`) has the tables `controls` (the pause), `jobs`, `results` and `flagged`. It requires `ingestion-layer-v1.sql`. It follows the ingestion schema's rules:

- it is not exposed to the Data API;
- RLS is enabled and forced with no policies;
- every read and write goes through a `SECURITY DEFINER` function that only `service_role` may execute.

A job still queued or running after 10 minutes is failed as `TIMED_OUT`. A job that reaches its own 280 s limit stops itself: no further document is read, sent to the model or calculated after the limit.

**Cleanup without user activity:** `fingence_processing_reap_all()` fails stopped jobs and deletes scan readings older than 15 minutes. It runs:
- every 5 minutes through `pg_cron`, when that extension is enabled before the migration (on Supabase: Database → Extensions; otherwise schedule it once with `cron.schedule`);
- every minute in the local store;
- on every job read, every new job, and every Data page's 15 s state check.

## Switches

| Variable | Effect |
| --- | --- |
| `FINGENCE_PROCESSING_JOBS=1` | Server processing on (with a store and a rate-limit store). Off: the app is the browser-only demo exactly as before |
| `FINGENCE_PROCESSING_LOCAL_URL` | Development only (`NODE_ENV=development`, not on Vercel): the local store from `node scripts/dev-store.mjs` (PGlite under `.local/dev/processing-store`, 127.0.0.1 only; it refuses any request that looks like it came from a browser: Origin, Referer or Sec-Fetch-Site, a non-JSON body, or a Host other than its loopback address) |
| Ingestion store (`FINGENCE_INGESTION_STORE=1`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`) | The hosted store, once `processing-jobs-v1.sql` is applied |
| `FINGENCE_MANAGEMENT_CONSOLE=1` | Opens `/management` on a hosted deployment. Without sign-in it is otherwise local-only; it should stay closed until the workspace's Management (Technical) role (#74) guards it |

Without sign-in, every job belongs to one organization (`fingence-default`). The workspace (#74) will supply real organizations and limit the console to Management (Technical).

## Local run

```bash
node scripts/dev-store.mjs
FINGENCE_PROCESSING_JOBS=1 FINGENCE_PROCESSING_LOCAL_URL=http://127.0.0.1:54329 pnpm dev
```

Open `/data`, process a sample, then open `/management`. Add `FINGENCE_AI_GATEWAY=1` and the Groq keys to read unfamiliar layouts, PDFs and scans on the server.

## Limits

- **Hosted request size:** a hosted function accepts at most 4.5 MB per request, so on Vercel a job's documents must total about 3 MB. The scanned sample (4.1 MB) runs locally but not hosted. Larger files need direct upload to storage, which is not built.
- **Hosted OCR and PDF reading** are untested on Vercel: bundle size and the worker files of `pdf.js` and `tesseract.js`. CSV and XLSX jobs need neither.
- **Production:** the migration is not applied to the Production Supabase project, and `FINGENCE_PROCESSING_JOBS` is not set on Vercel. Both are owner decisions. Until then Production is the browser-only demo.
- **Job IDs** are unguessable UUIDs. Anyone with a job ID can read its status and processing ID. Results and flagged items are read only through the Management API.

## Tests

- `tests/processing/jobs.test.ts` runs the real migrations in PGlite. It covers:
  - a full job (stored results equal the result rebuilt from the same documents; records stored under the run; no bytes stored);
  - the browser re-check reaching the same ID;
  - pause and resume;
  - the overview, with flagged items deduplicated per processing;
  - failure codes, the job time limit and the 10-minute reaping;
  - scan readings kept for the re-check and deleted after 15 minutes;
  - service-role-only grants and forced RLS.
- `tests/processing/routes.test.ts` covers the routes:
  - off by default, and the local store refused outside development;
  - 202 then run after the response;
  - cross-origin, malformed and oversized submissions refused before any job;
  - 423 with the pause reason;
  - the hosted body limit.
