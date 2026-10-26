"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";
import type { Stage } from "@/lib/ai-ingestion/contracts";
import type { Run03 } from "@/lib/server/ai-ingestion/increment-03/service";
const button = "inline-flex min-h-11 items-center justify-center rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";
const names: Record<Stage["name"], string> = { extraction: "Read your document", inference: "Interpret with AI", rule_synthesis: "Prepare processing rules", verification: "Independently verify", financial_records: "Prepare checked records" };
const examples = [["h01.csv", "CSV"], ["h02.xlsx", "Excel"], ["h03.pdf", "Digital PDF"], ["h04.pdf", "Scanned PDF"], ["h05.png", "PNG"], ["h06.jpg", "JPEG"]];
export function LiveDocument03() {
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [stages, setStages] = useState<Stage[]>([]), [result, setResult] = useState<Run03 | null>(null);
  const [ready, setReady] = useState(false); const abort = useRef<AbortController | null>(null);
  useEffect(() => { const c = new AbortController(); fetch("/api/ai-ingestion/live", { signal: c.signal }).then(r => r.json()).then(s => setReady(s.ready === true)).catch(() => {}); return () => { c.abort(); abort.current?.abort(); }; }, []);
  function select(f: File | null) { setFile(f); setError(""); setStages([]); setResult(null); }
  async function example(name: string) {
    setBusy(true); setError("");
    try { const r = await fetch(`/samples/ai-ingestion-increment-03/${name}`); if (!r.ok) throw new Error(); select(new File([await r.blob()], name)); }
    catch { setError("The synthetic example could not be loaded."); } finally { setBusy(false); }
  }
  async function process() {
    if (!file || busy) return; setBusy(true); setError(""); setResult(null); setStages([]); abort.current = new AbortController();
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/ai-ingestion/live", { method: "POST", body: form, signal: abort.current.signal });
      if (!response.ok || !response.body) { const data = await response.json(); throw new Error(data.error ?? "Processing unavailable."); }
      const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = "";
      while (true) { const next = await reader.read(); pending += decoder.decode(next.value, { stream: !next.done }); const lines = pending.split("\n"); pending = lines.pop() ?? "";
        for (const line of lines) if (line) { const data = JSON.parse(line); if (data.error) setError(data.error); if (data.stage) setStages(s => [...s.filter(x => x.name !== data.stage.name), data.stage]); if (data.result) setResult(data.result); }
        if (next.done) break;
      }
    } catch (e) { if (!abort.current.signal.aborted) setError(e instanceof Error ? e.message : "Processing failed."); } finally { setBusy(false); }
  }
  function download() {
    if (!result) return; const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `fingence-experiment-${result.mode.toLowerCase()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="space-y-5">
    <PageHeader title="Understand a financial document" description="FinGence 2.0 · Increment 03 · Local synthetic-data experiment" actions={<Link href="/ai-ingestion/developer" className={button}>Developer replay — recorded tests</Link>} />
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Experimental · Synthetic documents only</p><p className="mt-2">{ready ? "Live provider configured. AI proposes rules; independent checks determine which records can be accepted." : "Genuine AI inference is not configured or authorized. You can inspect document extraction; no AI success or accepted records will be claimed."}</p><p className="mt-2">No hosted persistence, production integration or verified accounting advice. Free-plan inference only; recorded results never substitute for live processing.</p></div>
    <Panel title="1. Add your financial document"><div className="space-y-4 p-5">
      <label className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/40 p-4 text-center"><span className="font-medium">Upload CSV, Excel, PDF or a document image</span><span className="text-xs text-slate-600">Registered synthetic files only · Up to 10 MiB</span><input aria-label="Financial document" type="file" accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg" className="max-w-full text-sm" disabled={busy} onChange={e => select(e.target.files?.[0] ?? null)} /></label>
      <details><summary className="cursor-pointer py-2 font-medium">Try a synthetic example</summary><div className="mt-2 flex flex-wrap gap-2">{examples.map(([name, label]) => <button key={name} className={button} disabled={busy} onClick={() => example(name)}>{label}</button>)}</div></details>
      <div className="flex flex-wrap items-center gap-3"><p className="min-w-0 flex-1 break-all text-sm">{file ? `Current document: ${file.name}` : "No document selected"}</p><button className={`${button} !bg-teal-800 !text-white`} disabled={!file || busy} onClick={process}>{busy ? "Processing…" : "Run AI processing"}</button></div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </div></Panel>
    {stages.length > 0 && <Panel title="2. Follow the checks"><ol aria-live="polite" className="divide-y divide-slate-100 p-5">{Object.entries(names).map(([key, label]) => { const s = stages.find(x => x.name === key); return <li key={key} className="py-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-sm">{label}</strong><span className="text-xs font-semibold">{s?.state ?? "PENDING"}</span></div><p className="mt-1 text-sm text-slate-600">{s?.message ?? "Not executed"}</p></li>; })}</ol></Panel>}
    {result && <Panel title="3. Review the result"><div className="space-y-4 p-5">
      <p className="text-sm font-semibold">Execution: {result.mode}{result.receipt ? ` · ${result.receipt.model}` : " · No confirmed model response"}</p>
      {result.verification ? <><p className="text-sm">{result.verification.accepted.length} accepted · {result.verification.rejected.length} cannot be included · {result.verification.unresolved.length} need clarification</p>{result.verification.accepted.map(row => <details key={row.id} className="rounded-lg border border-slate-200 p-3"><summary className="cursor-pointer text-sm">{row.financial.source_transaction_id ?? "Source record"} · {row.financial.canonical_date} · {row.status}</summary><dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">{Object.entries(row.financial).map(([k, v]) => <div key={k} className="break-words"><dt className="text-slate-500">{k.replaceAll("_", " ")}</dt><dd>{String(v ?? "Not supplied")}</dd></div>)}</dl>{row.issues.map((issue, n) => <p key={n} className="mt-2 text-sm">{issue.message}</p>)}</details>)}{[...result.verification.rejected, ...result.verification.unresolved].map(row => <p key={row.id} className="rounded-lg bg-amber-50 p-3 text-sm">This source row cannot be included yet. Its values or financial meaning could not be established safely. Inspect the source references below.</p>)}</> : <p className="text-sm">No verified financial records. Extraction alone cannot establish financial meaning.</p>}
      <button className={button} onClick={download}>Download experiment evidence — JSON</button>
      <details><summary className="cursor-pointer py-2 text-sm font-medium">Source references and technical evidence</summary><pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(result, null, 2)}</pre></details>
    </div></Panel>}
  </div>;
}
