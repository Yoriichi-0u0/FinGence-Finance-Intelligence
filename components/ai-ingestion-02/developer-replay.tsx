"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Download, FlaskConical, LoaderCircle } from "lucide-react";
import { PageHeader, Panel } from "../ui";
import type { ReplayCase } from "@/lib/server/ai-ingestion/increment-02/cases";
import type { ReplayResult, ReplayVariant } from "@/lib/server/ai-ingestion/increment-02/replay";
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700";
export default function DeveloperReplay() {
  const [cases, setCases] = useState<ReplayCase[]>([]); const [caseId, setCaseId] = useState("bank-narrative.csv"); const [variant, setVariant] = useState<ReplayVariant>("recorded");
  const [templateId, setTemplateId] = useState("bank-narrative.csv"); const [messages, setMessages] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [result, setResult] = useState<ReplayResult | null>(null);
  const abort = useRef<AbortController | null>(null); const generation = useRef(0);
  const cancelActive = useCallback(() => { generation.current++; abort.current?.abort(); }, []);
  useEffect(() => { const controller = new AbortController(); fetch("/api/ai-ingestion/developer-replay", { signal: controller.signal }).then(r => { if (!r.ok) throw new Error("Developer replay is unavailable."); return r.json(); }).then(d => setCases(d.cases)).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => { controller.abort(); cancelActive(); }; }, [cancelActive]);
  function reset() { generation.current++; abort.current?.abort(); setResult(null); setMessages([]); setError(""); setBusy(false); }
  async function run() {
    const id = ++generation.current; abort.current?.abort(); const controller = new AbortController(); abort.current = controller; setBusy(true); setError(""); setResult(null); setMessages([]);
    try {
      const r = await fetch("/api/ai-ingestion/developer-replay", { method: "POST", headers: { "Content-Type": "application/json", "X-FinGence-Developer-Replay": "1" }, body: JSON.stringify({ caseId, variant, templateId }), signal: controller.signal });
      if (!r.ok || !r.body) throw new Error("Replay could not start. Check local developer mode.");
      const reader = r.body.getReader(); const decoder = new TextDecoder(); let pending = "";
      while (true) {
        const { done, value } = await reader.read(); pending += decoder.decode(value, { stream: !done }); let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) { const line = pending.slice(0, newline); pending = pending.slice(newline + 1); if (!line) continue; const event = JSON.parse(line); if (id !== generation.current) return; if (event.error) throw new Error(event.error); if (event.message) setMessages(m => [...m, event.message]); if (event.result) setResult(event.result); }
        if (done) break;
      }
    } catch (e) { if (!controller.signal.aborted && id === generation.current) setError(e instanceof Error ? e.message : "Replay failed."); }
    finally { if (id === generation.current) setBusy(false); }
  }
  function download() { if (!result) return; const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = `fingence-02-RECORDED_TEST-${result.case.file}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  const report = result?.verification;
  return <div className="space-y-5">
    <PageHeader title="Developer evaluation" description="FinGence 2.0 · Increment 02 · Local synthetic replay" actions={<Link href="/ai-ingestion" className={button}>Return to finance upload</Link>} />
    <aside className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950"><p className="flex items-center gap-2 font-semibold"><FlaskConical size={19} /> RECORDED_TEST · Live LLM inference NOT EXECUTED</p><p className="mt-2">Real extraction and deterministic verification of hand-authored test proposals. This view does not demonstrate actual AI-generated rules. No paid requests, tokens or spending. Experimental policies are not client accounting approvals.</p></aside>
    <Panel title="Choose a controlled experiment" eyebrow="No arbitrary uploads or generated code">
      <form className="space-y-4 p-4 sm:p-5" onSubmit={e => { e.preventDefault(); void run(); }}>
        <div className="grid gap-4 md:grid-cols-2"><label className="space-y-2 text-sm">Synthetic document<select className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" value={caseId} onChange={e => { reset(); setCaseId(e.target.value); }} disabled={busy}>{cases.map(c => <option key={c.id} value={c.id}>{c.file}</option>)}</select></label>
          <label className="space-y-2 text-sm">Recorded test variant<select className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" value={variant} onChange={e => { reset(); setVariant(e.target.value as ReplayVariant); }} disabled={busy}><option value="recorded">Recorded interpretation</option><option value="swap">Adversarial financial-field swap</option><option value="omit">Adversarial omitted field</option><option value="reuse">Rebind a verified template</option></select></label></div>
        {variant === "reuse" && <label className="block space-y-2 text-sm">Template source<select className="block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3" value={templateId} onChange={e => { reset(); setTemplateId(e.target.value); }} disabled={busy}>{["bank-narrative.csv", "ledger-dmy.csv", "metadata.csv"].map(name => <option key={name} value={name}>{name}</option>)}</select></label>}
        <button type="submit" disabled={busy || !cases.length} className={`${button} !border-teal-800 !bg-teal-800 !text-white`}>{busy && <LoaderCircle size={17} className="animate-spin" />}{busy ? "Running recorded test…" : "Run RECORDED_TEST"}</button>
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      </form>
    </Panel>
    <Panel title="Observable processing"><ol aria-live="polite" className="space-y-2 p-4 text-sm sm:p-5">{messages.length ? messages.map((m, n) => <li key={n}>{n + 1}. {m}</li>) : <li>Choose a registered case. No processing has run.</li>}</ol></Panel>
    {result && <Panel title="RECORDED_TEST outcome" action={<button className={button} onClick={download}><Download size={16} /> Download evidence</button>}>
      <div className="space-y-5 p-4 sm:p-5">
        <p className="text-sm"><strong>{result.case.file}</strong> · {result.runtimeMs} ms · LLM tokens 0 · Estimated spend US$0 · <strong>RECORDED_TEST</strong></p>
        {result.error && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{result.error}</p>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Observed rows", report?.coverage.rowCountEstablished ? report.coverage.sourceRows : "Not established"], ["Accepted", report?.accepted.length ?? 0], ["Rejected", report?.rejected.length ?? 0], ["Unresolved rows", report?.unresolved.length ?? 0]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><p className="text-xs text-slate-600">{label}</p><p className="break-words text-2xl font-semibold">{value}</p></div>)}</div>
        {report && !report.coverage.rowCountEstablished && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Document unresolved: source row count could not be established. Zero observed rows is not a claim that the document contains no records.</p>}
        <p className="text-sm">Decision: <strong>{report?.decision ?? "EXTRACTION_FAILED"}</strong>{result.reuse && <> · Reuse: <strong>{result.reuse.decision}</strong></>}. Accepted V2 test records are not human-approved C1 transport data.</p>
        {!!report?.documentReasons.length && <p className="break-words text-sm text-amber-900">Document-level decisions: {report.documentReasons.join(" · ")}</p>}
        {report?.accepted.map(row => <article key={row.id} className="rounded-lg border border-teal-200 p-3 text-sm"><p className="font-medium">Accepted · {row.status} · {row.financial.source_transaction_id ?? "Source row"}</p><p>{row.financial.transaction_date} · Posting {row.financial.posting_date ?? "not supplied"}</p><p>{row.financial.monetary_basis === "debit_credit" ? `Debit ${row.financial.debit}; Credit ${row.financial.credit}` : `Source amount ${row.financial.source_amount}; source direction ${row.financial.entry_side ?? "not supplied"}`} · {row.financial.currency ?? "Currency not supplied"}</p><p>{row.financial.description}</p>{row.issues.map((i, n) => <p key={n} className="mt-1 text-amber-800">{i.message}</p>)}</article>)}
        {[...(report?.rejected ?? []).map(r => ({ ...r, outcome: "Rejected" })), ...(report?.unresolved ?? []).map(r => ({ ...r, outcome: "Unresolved" }))].map(row => <article key={row.id} className="rounded-lg border border-amber-200 p-3 text-sm"><p className="font-medium">{row.outcome} · Source references retained</p><p className="mt-1 break-words">{row.reasons.join(" · ")}</p><p className="mt-1 text-xs text-slate-600">{row.evidenceIds.length} source cells; excluded from accepted records.</p></article>)}
        <details><summary className="cursor-pointer py-2 font-medium">Field dispositions and policy decisions</summary><div className="mt-2 grid gap-2 md:grid-cols-2">{report?.dispositions.map(f => <article key={f.id} className="rounded-lg border border-slate-200 p-3 text-sm"><p className="font-medium">{f.column}</p><p>{f.role} → {f.target ?? "No normalization target"}</p><p>{f.disposition}</p><p className="mt-1 break-words text-xs text-slate-600">{f.ruleId} · {f.reason}</p></article>)}</div>{report?.checks.filter(c => !c.passed).map((c, n) => <p key={n} className="mt-2 break-words text-sm text-amber-900">{c.code}: {c.detail}</p>)}</details>
        <details><summary className="cursor-pointer py-2 font-medium">Real source evidence and coordinates</summary><div className="mt-2 grid gap-2 md:grid-cols-2">{result.evidence?.items.map(i => <article key={i.id} className="min-w-0 rounded-lg border border-slate-200 p-3 text-sm"><p className="break-words font-medium">{i.text || "(blank)"}</p><p className="mt-1 text-xs text-slate-600">{i.page ? `Page ${i.page} · ` : ""}{i.sheet ? `${i.sheet} · ` : ""}{i.address ?? `Row ${i.row ?? "context"}`} · {i.column ?? "Document context"}{i.box ? ` · ${i.box.map(n => Math.round(n)).join(", ")}` : ""}</p></article>)}</div></details>
        <details><summary className="cursor-pointer py-2 font-medium">Full developer trace · RECORDED_TEST</summary><pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(result, null, 2)}</pre></details>
      </div>
    </Panel>}
  </div>;
}
