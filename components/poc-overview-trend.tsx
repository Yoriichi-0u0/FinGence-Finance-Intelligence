"use client";
import Link from "next/link";
import PocFinancialPreview from "./poc-financial-preview";
import type { PocAnalysis } from "../lib/server/poc-anomalies/service";
import { useEffect, useState } from "react";
import { LineChart } from "./charts";
import { clientPrincipal, principalScope } from "../lib/ai-ingestion/m2-client-state";
import { readSelection, browserSelectionStorage } from "../lib/poc-insights/selection";
import type { PocInsights } from "../lib/server/poc-insights/service";

/** Read-only source projection. No financial arithmetic, data cache or inferred source selection. */
export default function PocOverviewTrend() {
  const [data, setData] = useState<PocInsights | null>(null);
  const [analysis, setAnalysis] = useState<PocAnalysis | null>(null);
  const [message, setMessage] = useState("Checking authorized source…");
  useEffect(() => {
    let ended = false, sequence = 0, paused = false;
    let request: AbortController | null = null;
    const clear = () => { sequence++; request?.abort(); request = null; setData(null); setAnalysis(null); setMessage("Open Analytics to view an authorized synthetic source."); };
    const check = async () => {
      if (ended || paused || document.hidden || request) return;
      const epoch = ++sequence, controller = new AbortController(); request = controller;
      setData(null); setAnalysis(null); setMessage("Checking authorized source…");
      const timeout = setTimeout(() => controller.abort(), 8000);
      const get = async (url: string) => { const response = await fetch(url, { cache: "no-store", signal: controller.signal }); if (!response.ok) throw Error(); return response.json(); };
      try {
        const session = await get("/api/ai-ingestion/m2?action=session");
        if (session.active !== true) { if (!ended && epoch === sequence) setMessage("Sign in with Finance to view your authorized synthetic financial activity."); return; }
        const principal = clientPrincipal(session);
        if (principal.role !== "Finance") { if (!ended && epoch === sequence) setMessage("An active Finance membership is required to view financial activity."); return; }
        const selected = readSelection(browserSelectionStorage, principal, "");
        if (!selected) {
          const list = await get("/api/ai-ingestion/m2/insights?action=sources");
          if (list.status !== "OK" || principalScope(list.scope) !== principalScope(principal) || list.scope.role !== principal.role || list.scope.membershipVersion !== principal.membershipVersion || !Array.isArray(list.sources)) throw Error();
          if (!ended && epoch === sequence) setMessage(list.sources.length ? "Choose your authorized source, business and month in Analytics to see financial activity." : "No synthetic financial source has been uploaded yet. Upload an approved source through Anomalies to get started.");
          return;
        }
        const query = new URLSearchParams(Object.entries(selected));
        const value = await get("/api/ai-ingestion/m2/insights?" + query) as PocInsights;
        if (value.status !== "OK" || value.version !== "poc-financial-insights-v1" || value.publicationEligible !== false || value.source.id !== selected.source || principalScope(value.scope) !== principalScope(principal) || value.scope.role !== principal.role || value.scope.membershipVersion !== principal.membershipVersion || (selected.business && value.selection.businessId !== selected.business) || (selected.currency && value.selection.currency !== selected.currency) || (selected.period && value.selection.period !== selected.period)) throw Error();
        if (!ended && epoch === sequence) { setData(value); setMessage(""); }
        const anomalyQuery = new URLSearchParams({action: "analysis", source: value.source.id, business: value.selection.businessId, period: value.selection.period, currency: value.selection.currency});
        try {
          const candidateData = await get("/api/ai-ingestion/m2/anomalies?" + anomalyQuery) as PocAnalysis;
          if (candidateData.status !== "OK" || candidateData.version !== "poc-anomaly-analysis-v1" || candidateData.publicationEligible !== false || candidateData.dataOrigin !== "SYNTHETIC_UPLOADED_SOURCE" || candidateData.source.id !== value.source.id || candidateData.source.sha256 !== value.source.sha256 || principalScope(candidateData.scope) !== principalScope(principal) || candidateData.scope.role !== principal.role || candidateData.scope.membershipVersion !== principal.membershipVersion || candidateData.selection.businessId !== value.selection.businessId || candidateData.selection.period !== value.selection.period || candidateData.selection.currency !== value.selection.currency) throw Error();
          if (!ended && epoch === sequence) setAnalysis(candidateData);
        } catch { if (!ended && epoch === sequence) setAnalysis(null); }
      } catch { if (!ended && epoch === sequence) { setData(null); setAnalysis(null); setMessage("Select an authorized synthetic source in Analytics to view its trend."); } }
      finally { clearTimeout(timeout); if (request === controller) request = null; }
    };
    const sessionCleared = () => { paused = true; clear(); };
    const refresh = () => { void check(); };
    const visibility = () => { if (document.hidden) clear(); else refresh(); };
    refresh(); const timer = setInterval(refresh, 30000);
    window.addEventListener("fingence:poc-session-cleared", sessionCleared); window.addEventListener("focus", refresh); window.addEventListener("blur", clear); document.addEventListener("visibilitychange", visibility);
    return () => { ended = true; sequence++; request?.abort(); clearInterval(timer); window.removeEventListener("fingence:poc-session-cleared", sessionCleared); window.removeEventListener("focus", refresh); window.removeEventListener("blur", clear); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  return <><PocFinancialPreview data={data} analysis={analysis} message={message} /><section aria-labelledby="overview-trend" className="panel-shadow min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-white">
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
      <div><h2 id="overview-trend" className="text-lg font-semibold tracking-tight text-[var(--ink)]">Observed cash movement</h2><p className="mt-1 text-sm text-[var(--muted-strong)]">Monthly net cash movement from the selected authorized bank source</p></div>
      {data && <div aria-label="Selected chart source" className="flex min-w-0 flex-wrap gap-2 text-xs text-[var(--muted-strong)]">
        {[["Source", data.source.fileName], ["Business", data.selection.businessName], ["Currency", data.selection.currency], ["Range", `${data.series[0]?.period} – ${data.series.at(-1)?.period}`]].map(([label,value]) => <span key={label} className="max-w-full break-words rounded-lg border border-[var(--border)] bg-slate-50/60 px-3 py-2"><span className="font-medium text-[var(--ink)]">{label}: </span>{value}</span>)}
      </div>}
    </div>
    {data ? <>
      <p className="px-5 pt-2 text-xs text-[var(--muted-strong)] sm:px-6">Trend: observed monthly history for the selected authorized source.</p>
      <div className="mx-3 mt-3 min-w-0 rounded-xl bg-gradient-to-b from-teal-50/40 to-white px-1 sm:mx-5 sm:px-2">
        <LineChart labels={data.series.map(p => new Intl.DateTimeFormat("en", {month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${p.period}-01T00:00:00Z`)))}
          series={[{label:"Net cash movement (bank)",color:"#0e9f8e",values:data.series.map(p=>Number(p.net)),fill:true}]}
          height={225} formatValue={value=>new Intl.NumberFormat("en",{maximumFractionDigits:0}).format(value)}
          ariaLabel={`Monthly signed bank cash movement in ${data.selection.currency}; exact source amounts in the expandable table`} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-3 text-xs sm:px-6"><span className="inline-flex items-center gap-2 text-[var(--muted-strong)]"><span aria-hidden="true" className="size-2 rounded-full bg-teal-500"/>Net cash movement (bank) · {data.selection.currency}</span><Link href="/analytics" className="inline-flex min-h-11 items-center font-semibold text-[var(--teal-dark)] hover:underline">Open in Analytics →</Link></div>
      <details className="border-t border-[var(--border)] px-5 py-3 text-xs text-[var(--muted-strong)] sm:px-6"><summary className="cursor-pointer font-medium">Source evidence and exact amounts</summary><p className="my-3 break-all">SHA-256: {data.source.sha256}</p><p className="mb-3">Credits add cash; debits subtract cash. Not revenue, profit or a forecast. Chart positions use numeric display coordinates; the original exact decimal amounts are preserved below.</p><div className="overflow-x-auto"><table className="w-full text-left"><caption className="sr-only">Exact monthly signed bank cash movements in {data.selection.currency}</caption><thead><tr><th className="py-2">Month</th><th>Amount ({data.selection.currency})</th><th>Records</th></tr></thead><tbody>{data.series.map(p=><tr key={p.period} className="border-t border-[var(--border)]"><td className="py-2">{p.period}</td><td>{p.net}</td><td>{p.rows}</td></tr>)}</tbody></table></div></details>
    </> : <div className="m-5 rounded-xl border border-teal-100 bg-[var(--teal-soft)] px-4 py-5 text-sm text-[var(--teal-dark)] sm:mx-6"><p role="status">{message}</p><Link href="/analytics" className="mt-2 inline-flex min-h-11 items-center font-semibold underline-offset-4 hover:underline">Open Analytics →</Link></div>}
  </section></>;
}
