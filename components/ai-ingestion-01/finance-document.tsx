"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileUp, FlaskConical, CheckCircle2, AlertCircle, Download, LoaderCircle } from "lucide-react";
import { PageHeader, Panel } from "@/components/ui";
import type { Stage, StageName, V2Result } from "@/lib/ai-ingestion/contracts";

const labels: Record<StageName, string> = { extraction: "Read the document", inference: "AI document understanding", rule_synthesis: "Propose processing rules", verification: "Independently check decisions", financial_records: "Prepare financial records" };
const examples = [ ["statement.csv", "CSV statement"], ["statement.xlsx", "Excel statement"], ["statement-digital.pdf", "Digital PDF"], ["statement-scan.pdf", "Scanned PDF"], ["statement.png", "PNG image"], ["statement.jpg", "JPEG image"], ["unreadable.png", "Low-quality image"] ];
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
export default function AIIngestionPage() {
  const [file, setFile] = useState<File | null>(null); const [stages, setStages] = useState<Stage[]>([]);
  const [result, setResult] = useState<V2Result | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null); const generation = useRef(0);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);
  function select(next: File | null) { generation.current++; controller.current?.abort(); setBusy(false); setFile(next); setResult(null); setStages([]); setError(""); }
  async function example(name: string) {
    try { const response = await fetch(`/samples/ai-ingestion/${name}`); if (!response.ok) throw new Error(); select(new File([await response.blob()], name)); }
    catch { setError("The synthetic example could not be opened."); }
  }
  async function run() {
    if (!file) return; const runGeneration = ++generation.current; const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setResult(null); setStages([]);
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/ai-ingestion", { method: "POST", body: form, signal: abort.signal });
      if (!response.ok) { const error = await response.json(); throw new Error(error.error ?? "Processing could not start."); }
      if (!response.body) throw new Error("Processing response is unavailable.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = "";
      while (true) {
        const { done, value } = await reader.read(); pending += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1); if (!line) continue;
          const event = JSON.parse(line) as { stage?: Stage; result?: V2Result; error?: string };
          if (runGeneration !== generation.current) return;
          if (event.error) throw new Error(event.error);
          if (event.stage) setStages(previous => [...previous.filter(s => s.name !== event.stage!.name), event.stage!]);
          if (event.result) setResult(event.result);
        }
        if (done) break;
      }
    } catch (failure) { if (runGeneration === generation.current && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Processing failed."); }
    finally { if (runGeneration === generation.current) setBusy(false); }
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "fingence-v2-synthetic-evidence.json"; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className="space-y-5">
    <PageHeader title="AI financial document ingestion" description="FinGence 2.0 · Local synthetic-data experiment" actions={<Link href="/data" className={button}>Open verified FinGence 1.0</Link>} />
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="flex items-center gap-2 font-semibold"><FlaskConical size={18} /> Experimental · Synthetic documents only</p>
      <p className="mt-2">Upload, process and inspect the evidence. Live AI requires a securely configured OpenAI project. Extraction alone is never presented as AI interpretation or accepted financial data. Maximum experimental API budget: US$5 across CLI and browser runs.</p>
      <p className="mt-2">This local experiment does not change production, save to a hosted database, reconcile transactions or provide verified accounting advice.</p>
    </div>
    <Panel title="1. Add a financial document" eyebrow="CSV · Excel · PDF · PNG/JPEG">
      <div className="space-y-4 p-4 sm:p-5">
        <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/40 p-5 text-center">
          <FileUp className="text-teal-700" /><span className="font-medium">Choose a synthetic financial file</span><span className="text-xs text-slate-600">Up to 10 MiB · PDF up to 4 pages · Initial samples only</span>
          <input className="max-w-full text-sm" type="file" accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg" aria-label="Synthetic financial document" onChange={event => select(event.target.files?.[0] ?? null)} disabled={busy} />
        </label>
        <details><summary className="cursor-pointer py-2 text-sm font-medium text-teal-800">Try a controlled synthetic example</summary><div className="mt-2 flex flex-wrap gap-2">{examples.map(([name, label]) => <button key={name} className={button} disabled={busy} onClick={() => example(name)}>{label}</button>)}</div></details>
        <div className="flex flex-wrap items-center gap-3"><p className="min-w-0 flex-1 break-all text-sm">{file ? <>Current document: <strong>{file.name}</strong></> : "No document selected."}</p>
          <button className={`${button} !border-teal-800 !bg-teal-800 !text-white hover:!bg-teal-900`} onClick={run} disabled={!file || busy}>{busy ? <LoaderCircle className="animate-spin" size={18} /> : <FileUp size={18} />} {busy ? "Processing document…" : "Run document processing"}</button>
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      </div>
    </Panel>
    <Panel title="2. Follow the processing" eyebrow="Every stage has separate evidence">
      <ol className="divide-y divide-slate-100 p-4 sm:p-5" aria-live="polite">{Object.entries(labels).map(([name, label]) => {
        const stage = stages.find(s => s.name === name); const state = stage?.state ?? "PENDING";
        return <li key={name} className="flex gap-3 py-3">{state === "COMPLETED" ? <CheckCircle2 className="mt-0.5 shrink-0 text-teal-700" size={20} /> : state === "RUNNING" ? <LoaderCircle className="mt-0.5 shrink-0 animate-spin text-teal-700" size={20} /> : <AlertCircle className="mt-0.5 shrink-0 text-slate-400" size={20} />}<div className="min-w-0"><p className="font-medium">{label} <span className="ml-2 text-xs font-normal text-slate-600">{state}</span></p><p className="mt-1 text-sm text-slate-600">{stage?.message ?? "Not executed."}</p></div></li>;
      })}</ol>
    </Panel>
    {result && <>
      <Panel title="3. Review the outcome" action={<button className={button} onClick={download}><Download size={16} /> Download evidence</button>}>
        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-3">{[["Evidence items", result.evidence.items.length], ["Accepted financial records", result.verification?.accepted.length ?? 0], ["Live AI", result.inference?.mode === "LIVE_OPENAI" ? "Executed" : result.stages.find(s => s.name === "inference")?.state === "FAILED" ? "No completed result" : "NOT EXECUTED"]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-4"><p className="text-xs text-slate-600">{label}</p><p className="mt-1 break-words text-xl font-semibold">{value}</p></div>)}</div>
          <p className="text-sm"><strong>Document reading:</strong> {result.evidence.extractor} · {result.evidence.durationMs} ms. {result.evidence.coverage === "REGIONS_ONLY" ? "Text regions found; financial row coverage remains unverified." : "Structured table rows extracted; AI interpretation and financial verification are separate checks."}</p>
          {result.evidence.warnings.map((w, i) => <p key={i} className="text-sm text-amber-800">{w}</p>)}
          {result.verification?.checks.filter(c => !c.passed).map((c, i) => <p key={i} className="text-sm text-amber-800">{c.message}</p>)}
          {result.verification?.accepted.map(row => <article className="rounded-lg border border-slate-200 p-3 text-sm" key={row.id}><p>{row.financial.description ?? "Financial record"} · {row.status}</p><p>{row.financial.canonical_date} · {row.financial.source_amount ?? `Debit ${row.financial.debit}; Credit ${row.financial.credit}`} {row.financial.currency}</p><p className="mt-1 text-xs">{row.evidenceIds.length} linked source values. Machine-verified under a synthetic experimental policy; not human-approved C1 data.</p></article>)}
          <h3 className="font-medium">Original source evidence</h3><p className="text-xs text-slate-600">Showing up to 24 values. Full source references are retained in the downloadable local report.</p>
          <div className="grid gap-2 sm:grid-cols-2">{result.evidence.items.filter(i => !i.header).slice(0, 24).map(item => <article className="min-w-0 rounded-lg border border-slate-200 p-3 text-sm" key={item.id}><p className="break-words font-medium">{item.text || "(blank)"}</p><p className="mt-1 text-xs text-slate-600">{item.sheet ? `Worksheet ${item.sheet} · ` : ""}{item.address ?? (item.page ? `Page ${item.page}` : `Row ${item.row} · ${item.column}`)}{item.box ? ` · region ${item.box.map(n => Math.round(n)).join(", ")}` : ""}</p><p className="mt-1 text-xs text-slate-500">{item.method}</p></article>)}</div>
          <details><summary className="cursor-pointer py-2 text-sm font-medium">Local technical evidence and verification</summary><p className="text-xs text-slate-600">No role-based access control is claimed. This experiment is restricted to the local synthetic workspace.</p><pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify({ runId: result.runId, sourceId: result.evidence.sourceId, inference: result.inference, verification: result.verification }, null, 2)}</pre></details>
        </div>
      </Panel>
    </>}
  </div>;
}
