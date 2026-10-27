import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { BudgetLedger } from "@/lib/ai-ingestion/budget";
import { isRegisteredSynthetic, localAccessAllowed, processDocument } from "@/lib/server/ai-ingestion/service";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(request: Request) {
  if (!localAccessAllowed(request)) return Response.json({ error: "Local experimental mode only." }, { status: 403 });
  return Response.json({ enabled: true, liveConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_PROJECT_ID && process.env.FINGENCE_AI_LIVE_APPROVED === "1"), budget: new BudgetLedger(resolve(".ai-local")).summary() }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!localAccessAllowed(request)) return Response.json({ error: "Local experimental mode only." }, { status: 403 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "A file is required." }, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
    if (size > 11 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: "Upload exceeds the experimental limit." }, { status: 413 }); }
    chunks.push(next.value);
  }
  let file: File; let bytes: Uint8Array;
  try {
    const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const selected = form.get("file"); if (!(selected instanceof File)) throw new Error(); file = selected;
    bytes = new Uint8Array(await file.arrayBuffer());
    if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error();
  } catch { return Response.json({ error: "Choose a supported file smaller than 10 MiB." }, { status: 400 }); }
  if (!(await isRegisteredSynthetic(createHash("sha256").update(bytes).digest("hex")))) return Response.json({ error: "Only registered synthetic evaluation files are permitted in this experiment." }, { status: 422 });
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(data) + "\n")); };
      try { const result = await processDocument(bytes, file.name, stage => send({ stage })); send({ result }); }
      catch { send({ error: "Extraction failed or exceeded its limits. No AI success or financial acceptance is claimed." }); }
      finally { if (!closed) { closed = true; controller.close(); } }
    },
    // Disconnection never retries generation or refunds an uncertain reservation.
    cancel() { closed = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
