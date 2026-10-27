import { z } from "zod";
import { developerRequestAllowed, runRecordedReplay } from "../../../../lib/server/ai-ingestion/increment-02/replay";
import { replayCases } from "../../../../lib/server/ai-ingestion/increment-02/cases";
export const runtime = "nodejs";
export const maxDuration = 300;
const requestSchema = z.strictObject({ caseId: z.string().max(100), variant: z.enum(["recorded", "swap", "omit", "reuse"]), templateId: z.string().max(100).optional() });
export async function GET(request: Request) {
  if (!developerRequestAllowed(request)) return Response.json({ error: "Unavailable." }, { status: 404 });
  return Response.json({ origin: "RECORDED_TEST", inference: "NOT_EXECUTED", cases: replayCases }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!developerRequestAllowed(request)) return Response.json({ error: "Unavailable." }, { status: 404 });
  if (request.headers.get("x-fingence-developer-replay") !== "1") return Response.json({ error: "Explicit developer replay request required." }, { status: 400 });
  // Read bounded bytes; do not trust Content-Length or accept arbitrary files/proposals.
  const reader = request.body?.getReader(); if (!reader) return Response.json({ error: "A registered case is required." }, { status: 400 });
  const chunks: Uint8Array[] = []; let count = 0;
  while (true) { const r = await reader.read(); if (r.done) break; count += r.value.length; if (count > 2048) { await reader.cancel(); return Response.json({ error: "Request limit exceeded." }, { status: 413 }); } chunks.push(r.value); }
  let parsed;
  try { parsed = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch { return Response.json({ error: "Choose a registered recorded test." }, { status: 400 }); }
  if (!replayCases.some(c => c.id === parsed.caseId) || parsed.templateId && !replayCases.some(c => c.id === parsed.templateId)) return Response.json({ error: "Unknown case." }, { status: 400 });
  const input = parsed; const encoder = new TextEncoder(); let closed = false;
  return new Response(new ReadableStream({
    async start(controller) {
      const send = (value: unknown) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); };
      try { send({ mode: "RECORDED_TEST", message: "Live inference NOT EXECUTED. No synthesis claim or paid request." }); const result = await runRecordedReplay(input.caseId, input.variant, input.templateId, message => send({ mode: "RECORDED_TEST", message })); send({ result }); }
      catch { send({ error: "Recorded replay failed safely; no inference was attempted." }); }
      finally { if (!closed) { closed = true; controller.close(); } }
    }, cancel() { closed = true; },
  }), { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
