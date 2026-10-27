import { liveRequestAllowed03, processLiveDocument03, providerStatus03 } from "../../../../lib/server/ai-ingestion/increment-03/service";
export const runtime = "nodejs";
let running = false;
export async function GET(request: Request) {
  if (!liveRequestAllowed03(request)) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(providerStatus03(), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!liveRequestAllowed03(request)) return Response.json({ error: "Not found" }, { status: 404 });
  if (running) return Response.json({ error: "Another local document is processing. Wait for it to finish." }, { status: 409 });
  const reader = request.body?.getReader(); if (!reader) return Response.json({ error: "Choose a financial document." }, { status: 400 });
  running = true; let handedOff = false;
  try {
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) { const n = await reader.read(); if (n.done) break; size += n.value.byteLength; if (size > 11 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: "Maximum upload: 10 MiB plus form headers." }, { status: 413 }); } chunks.push(n.value); }
    let file: File, bytes: Uint8Array;
    try {
      const form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
      const selected = form.get("file"); if (!(selected instanceof File) || [...form.keys()].some(k => k !== "file") || form.getAll("file").length !== 1) throw new Error();
      file = selected; bytes = new Uint8Array(await file.arrayBuffer());
    } catch { return Response.json({ error: "Choose a supported synthetic file. Replay options are not accepted here." }, { status: 400 }); }
    // Stream ownership retains the local single-job gate until work completes, including disconnects.
    handedOff = true; const cancellation = new AbortController();
    let closed = false; const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (value: unknown) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(value) + "\n")); };
        try { const result = await processLiveDocument03(bytes, file.name, stage => send({ stage }), undefined, AbortSignal.any([request.signal, cancellation.signal])); send({ result }); }
        catch { send({ error: "Only registered synthetic sources are allowed; processing was not started or was canceled." }); }
        finally { running = false; if (!closed) { closed = true; controller.close(); } }
      },
      cancel() { closed = true; cancellation.abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } finally {
    if (!handedOff) running = false;
  }
}
