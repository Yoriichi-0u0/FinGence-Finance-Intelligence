import { readFile } from "node:fs/promises";
import { localTenant } from "../../../../lib/server/ai-ingestion/v2-i1/local-auth";
import { localDatabase } from "../../../../lib/server/ai-ingestion/v2-i1/local-db";
import { JobPersistenceError, runSyntheticJob } from "../../../../lib/server/ai-ingestion/v2-i1/job";
import { createV2Persistence } from "../../../../lib/server/ai-ingestion/v2-i1/persistence";
import { extractSemanticEvidence } from "../../../../lib/ai-ingestion/increment-02/extract";
import { bindRecordedProposal } from "../../../../lib/ai-ingestion/increment-02/recorded";
import { createSemanticTemplate } from "../../../../lib/ai-ingestion/increment-02/reuse";
import { registeredSynthetic03 } from "../../../../lib/server/ai-ingestion/increment-03/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
let busy = false;
const uncertainAttempts = new Map<string, string>();
const noStore = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
function unavailable() { return Response.json({ error: "Not found" }, { status: 404, headers: noStore }); }
export async function GET(request: Request) {
  const tenant = localTenant(request); if (!tenant) return unavailable();
  const id = new URL(request.url).searchParams.get("attempt");
  if (!id) return unavailable();
  try {
    const service = createV2Persistence(await localDatabase());
    if (new URL(request.url).searchParams.get("investigate") === "1") {
      if (uncertainAttempts.get(id) !== tenant) return unavailable();
      return Response.json({ outcome: await service.investigate(id, tenant) }, { headers: noStore });
    }
    const result = await service.get(id, tenant);
    return result ? Response.json(result, { headers: noStore }) : unavailable();
  } catch { return unavailable(); }
}
export async function POST(request: Request) {
  const tenant = localTenant(request); if (!tenant) return unavailable();
  if (busy) return Response.json({ error: "Another document is processing." }, { status: 409, headers: noStore });
  const reader = request.body?.getReader(); if (!reader) return unavailable();
  busy = true;
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
      if (size > 11 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: "Upload too large." }, { status: 413, headers: noStore }); }
      chunks.push(next.value);
    }
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("file");
    if (!(file instanceof File) || form.getAll("file").length !== 1 || [...form.keys()].some(key => key !== "file")) return unavailable();
    // A recorded synthetic template is explicitly labeled; it is not a live-model proposal.
    const seedBytes = await readFile("public/samples/ai-ingestion-increment-02/bank-narrative.csv");
    if (!(await registeredSynthetic03(seedBytes))) throw new Error("SYNTHETIC_TEMPLATE_CHANGED");
    const seed = await extractSemanticEvidence(seedBytes, "synthetic-template.csv");
    const template = createSemanticTemplate(seed, bindRecordedProposal(seed, "BANK_STATEMENT"), "RECORDED_TEST");
    const result = await runSyntheticJob({ bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, tenantId: tenant, template, database: await localDatabase() });
    return Response.json(result, { headers: noStore });
  } catch (error) {
    if (error instanceof JobPersistenceError) {
      uncertainAttempts.set(error.attemptId, tenant);
      return Response.json({ error: "Persistence did not complete. Do not retry; investigate the attempt.", code: error.code, attemptId: error.attemptId }, { status: 503, headers: noStore });
    }
    return Response.json({ error: "Processing did not complete. No automatic retry was attempted." }, { status: 422, headers: noStore });
  } finally { busy = false; }
}
