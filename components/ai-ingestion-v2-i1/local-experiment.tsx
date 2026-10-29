"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader, Panel } from "@/components/ui";
import { beginOperation, pendingOperationKey, submitOperation } from "@/lib/ai-ingestion/v2-i1-client";
import type { SyntheticJobResult } from "@/lib/server/ai-ingestion/v2-i1/job";

export function LocalExperiment() {
  const [file, setFile] = useState<File | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertainAttempt, setUncertainAttempt] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<SyntheticJobResult | null>(null);
  const key = pendingOperationKey;
  useEffect(() => {
    const sync = () => { try { setUncertainAttempt(localStorage.getItem(key)); setReady(true); } catch { setMessage("Browser storage is unavailable. Processing is disabled to preserve recovery."); } };
    sync(); window.addEventListener("storage", sync); return () => window.removeEventListener("storage", sync);
  }, [key]);
  function clearPending() { localStorage.removeItem(key); setUncertainAttempt(null); }
  async function process() {
    if (!file || !token || busy || uncertainAttempt || !ready) return;
    if (!navigator.locks) { setMessage("This browser cannot safely coordinate processing tabs."); return; }
    await navigator.locks.request("fingence-v2-i1-process", { ifAvailable: true }, async lock => {
      if (!lock) { setMessage("Another tab is processing a document."); return; }
      await processWithLock();
    });
  }
  async function processWithLock() {
    if (!file || !token) return;
    let id: string;
    try {
      if (localStorage.getItem(key)) { setUncertainAttempt(localStorage.getItem(key)); return; }
      id = beginOperation(localStorage, () => crypto.randomUUID()); setUncertainAttempt(id);
    } catch { setMessage("Browser storage is unavailable. Processing was not started."); return; }
    setBusy(true); setMessage(""); setResult(null);
    try {
      const form = new FormData(); form.append("file", file);
      const data = await submitOperation(fetch, id, token, form);
      setResult(data as SyntheticJobResult); clearPending();
    } catch { setMessage("The response was not confirmed. Check processing status before submitting again."); }
    finally { setBusy(false); }
  }
  async function investigate(cancelUnclaimed = false) {
    if (!uncertainAttempt || !token) return;
    setBusy(true);
    try {
      const response = cancelUnclaimed
        ? await fetch("/api/ai-ingestion/v2-i1?cancel=1", { method: "POST", headers: { Authorization: `Bearer ${token}`, "X-FinGence-Operation": uncertainAttempt } })
        : await fetch(`/api/ai-ingestion/v2-i1?operation=${encodeURIComponent(uncertainAttempt)}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) throw new Error();
      if (data.outcome === "CONFIRMED_COMMITTED" && data.batch?.attemptId === uncertainAttempt && data.batch?.processing) {
        const batch = data.batch;
        setResult({ mode: batch.processing.mode, stages: batch.processing.stages, origin: batch.origin, batch });
        setMessage("The original operation committed. Its stored result is shown below."); clearPending();
      } else if (data.outcome === "CONFIRMED_NOT_COMMITTED" || data.outcome === "KNOWN_FAILURE") {
        setMessage("The operation did not commit. You may explicitly start a new execution."); clearPending();
      } else setMessage("The outcome remains unresolved. Do not submit this document again.");
    } catch { setMessage("Investigation unavailable. Do not submit this document again."); }
    finally { setBusy(false); }
  }
  const verification = result?.batch.verification;
  function references(ids: string[]) {
    return ids.map(id => result?.batch.evidence?.items.find(item => item.id === id)).filter(item => item !== undefined)
      .map(item => [item.sheet && `Sheet ${item.sheet}`, item.page && `Page ${item.page}`, item.address && `Cell ${item.address}`,
        item.row && `Row ${item.row}`, item.box && `Region ${item.box.join(", ")} (${item.coordinateSystem})`].filter(Boolean).join(" · "))
      .filter(Boolean).join("; ");
  }
  return <div className="space-y-5">
    <PageHeader title="Process a financial document" description="Local experimental demonstration · approved synthetic documents only" />
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-semibold">Experimental results only</p><p className="mt-1">This demonstration reuses a verified recorded test blueprint. It does not run a live AI model or publish financial results. Synthetic results are stored locally.</p></div>
    <Link className="inline-block text-sm font-semibold text-teal-800 underline" href="/ai-ingestion/synthetic-financial">Open the separate deterministic synthetic financial demonstration</Link>
    <Panel title="Financial intelligence and questions"><div className="space-y-2 p-5 text-sm text-slate-700">
      <p><strong>Financial intelligence: unavailable.</strong> Secure sign-in and tenant-owned retrieval are not connected to this experimental page.</p>
      <p><strong>Ask AI: unavailable.</strong> This page does not run a live model or generate financial answers.</p>
    </div></Panel>
    <Panel title="Upload and process"><div className="space-y-4 p-5">
      <label className="block text-sm font-medium">Local demonstration access code<input type="password" autoComplete="off" className="mt-2 block w-full rounded-lg border border-slate-300 p-2" value={token} onChange={event => setToken(event.target.value)} /></label>
      <label className="block text-sm font-medium">Financial document<input type="file" accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg" className="mt-2 block w-full text-sm" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
      <button className="min-h-11 rounded-lg bg-teal-800 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={!file || !token || busy || !ready || Boolean(uncertainAttempt)} onClick={process}>{busy ? "Processing…" : result ? "Start a new execution" : "Process document"}</button>
      {message && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{message}</p>}
      {uncertainAttempt && <button className="min-h-11 rounded-lg border px-4 py-2 text-sm" disabled={busy} onClick={() => investigate()}>Check processing status</button>}
      {uncertainAttempt && <button className="min-h-11 rounded-lg border px-4 py-2 text-sm" disabled={busy} onClick={() => investigate(true)}>Close operation only if it never started</button>}
    </div></Panel>
    {result && <Panel title="Processing result"><div className="space-y-4 p-5" aria-live="polite">
      <p className="text-xs text-slate-600">Execution: {result.batch.executionId}</p>
      <p className="text-sm font-medium">{result.mode === "VERIFIED_BLUEPRINT_REUSE" ? "Verified blueprint reuse · RECORDED_TEST origin · no live inference" : "No interpretation available · no live inference"}</p>
      {verification ? <><p>{verification.accepted.length} experimentally verified rows · {verification.rejected.length} rejected rows · {verification.unresolved.length} unresolved rows</p>
        {result.batch.documentQuarantine && <p className="text-sm text-amber-800">The document is quarantined: its source coverage could not be established.</p>}
        {verification.accepted.map(row => <details key={row.id} className="rounded-lg border p-3 text-sm"><summary>{row.financial.source_transaction_id ?? "Source record"} · {row.financial.canonical_date} · {row.status}</summary><p className="mt-2">{row.financial.monetary_basis === "debit_credit" ? `Debit: ${row.financial.debit}; credit: ${row.financial.credit}` : `Amount: ${row.financial.source_amount ?? "Not supplied"}`} · Currency: {row.financial.currency ?? "Not supplied"}</p>{row.issues.map((issue, index) => <p key={index}>{issue.message}</p>)}<p className="mt-2 text-xs">Source: {references(row.evidenceIds) || "Coordinates unavailable"}</p></details>)}
        {[...verification.rejected.map(row => ({ ...row, label: "Rejected" })), ...verification.unresolved.map(row => ({ ...row, label: "Unresolved" }))].map(row => <details key={row.id} className="rounded-lg bg-amber-50 p-3 text-sm"><summary>{row.label}: not included</summary><p className="mt-2">{row.reasons.join(", ")}</p><p className="mt-2 text-xs">Source: {references(row.evidenceIds) || "Coordinates unavailable"}</p></details>)}
      </> : <p>Document quarantined: extraction did not establish source rows. No financial records were accepted.</p>}
      <details><summary>Processing stages</summary><ul className="mt-2 text-sm">{result.stages.map(stage => <li key={stage.name}>{stage.name}: {stage.state}</li>)}</ul></details>
    </div></Panel>}
  </div>;
}
