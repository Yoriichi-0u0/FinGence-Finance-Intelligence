"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertOctagon, AlertTriangle, Check, CircleGauge, Download, FileJson, FileText, Flag, LogOut, RotateCcw, Upload } from "lucide-react";
import { EmptyState, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { M2ClientFence, principalScope, type M2ClientPrincipal } from "@/lib/ai-ingestion/m2-client-state";
import { readSelection, rememberSelection, forgetSelection, browserSelectionStorage } from "@/lib/poc-insights/selection";
import { groupDigits } from "@/lib/poc-anomalies/format";
import type { PocAnalysis, PocCandidate, PocSource, ReviewState } from "@/lib/server/poc-anomalies/service";

type Notice = { tone: "success" | "error"; text: string } | null;
type Selection = { sourceId: string; businessId?: string; period?: string; currency?: string };
const auth = "/api/ai-ingestion/m2", api = auth + "/anomalies";
const scopeKey = (p: { userId: string; organizationId: string; role: string; membershipVersion: number }) => JSON.stringify([principalScope(p as M2ClientPrincipal), p.role, p.membershipVersion]);
const uploadRefusals: Record<string, string> = {
  EVALUATOR_FILE: "This file contains evaluation labels. Label and ground-truth files are never used as detector input.",
  UNSUPPORTED_LAYOUT: "Unsupported layout. Upload the normalized transaction CSV or the bank statement CSV of the synthetic PoC pack.",
  INVALID_ROWS: "Some rows are invalid, so nothing was stored.",
  NOT_UTF8: "The file is not UTF-8 text.",
  EMPTY: "The file has no rows.",
  TOO_MANY_ROWS: "The file has more than 20,000 rows.",
};
const reviewLabels: Record<ReviewState, string> = { OPEN: "Open", EXPLAINED: "Explained", ESCALATED: "Escalated" };
const money = (currency: string, value: string) => `${currency} ${groupDigits(value)}`;
const query = (s: Selection) => new URLSearchParams(Object.entries({ source: s.sourceId, business: s.businessId, period: s.period, currency: s.currency }).filter((e): e is [string, string] => Boolean(e[1]))).toString();
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const field = "mt-1 block min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm";

function Severity({ value }: { value: "HIGH" | "MEDIUM" }) {
  const high = value === "HIGH";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${high ? "bg-[var(--red-soft)] text-[var(--red)] ring-red-200" : "bg-[var(--amber-soft)] text-[var(--amber)] ring-amber-200"}`}>
      <AlertTriangle aria-hidden="true" size={12} />{high ? "High" : "Medium"}
    </span>
  );
}

export default function AnomalyWorkspace() {
  const fence = useRef(new M2ClientFence()), authenticating = useRef(false), request = useRef(0), file = useRef<HTMLInputElement>(null);
  const [principal, setPrincipal] = useState<M2ClientPrincipal | null>(null), [checked, setChecked] = useState(false);
  const [sources, setSources] = useState<PocSource[] | null>(null), [analysis, setAnalysis] = useState<PocAnalysis | null>(null), [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState<string | null>(null), [notice, setNotice] = useState<Notice>(null);
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");

  const clear = useCallback(() => { request.current++; setSources(null); setAnalysis(null); setSelectedRow(null); setBusy(null); setLoading(false); }, []);
  const invalidate = useCallback(() => { forgetSelection(browserSelectionStorage, fence.current.principal); fence.current.invalidate(); clear(); setPrincipal(null); }, [clear]);
  const load = useCallback(async (selection: Selection) => {
    const p = fence.current.principal;
    if (!p || p.role !== "Finance") return;
    const epoch = fence.current.epoch, sequence = ++request.current;
    setLoading(true);
    try {
      const r = await fetch(`${api}?action=analysis&${query(selection)}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const data = await r.json() as PocAnalysis;
      if (epoch !== fence.current.epoch || sequence !== request.current) return;
      // A response for another user, organization, role or membership version is discarded.
      if (scopeKey(data.scope) !== scopeKey(p) || data.source.id !== selection.sourceId) throw new Error();
      rememberSelection(browserSelectionStorage, p, { source: data.source.id, business: data.selection.businessId, period: data.selection.period, currency: data.selection.currency });
      setAnalysis(data);
      setSelectedRow(current => data.candidates.some(c => c.rowId === current) ? current : data.candidates[0]?.rowId ?? null);
      history.replaceState(null, "", `/anomalies?${query({ sourceId: data.source.id, businessId: data.selection.businessId, period: data.selection.period, currency: data.selection.currency })}`);
    } catch {
      if (epoch === fence.current.epoch && sequence === request.current) { setAnalysis(null); setNotice({ tone: "error", text: "The selected source could not be analyzed for this account. Refresh or choose another source." }); }
    } finally {
      if (epoch === fence.current.epoch && sequence === request.current) setLoading(false);
    }
  }, []);
  const refresh = useCallback(async (preferred?: Selection) => {
    const p = fence.current.principal;
    if (!p || p.role !== "Finance") return;
    const epoch = fence.current.epoch;
    try {
      const r = await fetch(api + "?action=sources", { cache: "no-store" });
      if (!r.ok) throw new Error();
      const data = await r.json() as { scope: PocAnalysis["scope"]; sources: PocSource[] };
      if (epoch !== fence.current.epoch) return;
      if (scopeKey(data.scope) !== scopeKey(p)) throw new Error();
      setSources(data.sources);
      const hint = preferred ?? (() => { const s = readSelection(browserSelectionStorage, p, location.search); return s ? { sourceId: s.source, businessId: s.business, period: s.period, currency: s.currency } : undefined; })();
      const chosen = hint && data.sources.some(s => s.id === hint.sourceId) ? hint : data.sources[0] ? { sourceId: data.sources[0].id } : null;
      if (chosen) void load(chosen);
    } catch {
      if (epoch === fence.current.epoch) setNotice({ tone: "error", text: "Sources could not be authorized or audited. Sign in again or refresh." });
    }
  }, [load]);
  const adopt = useCallback((data: unknown) => {
    const changed = fence.current.observe(data);
    setPrincipal(fence.current.principal);
    if (changed) { clear(); void refresh(); }
  }, [clear, refresh]);
  useEffect(() => {
    let ended = false;
    const check = async () => {
      if (authenticating.current) return;
      const epoch = fence.current.epoch;
      try {
        const r = await fetch(auth + "?action=session", { cache: "no-store" });
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (ended || epoch !== fence.current.epoch) return;
        if (data.active) adopt(data); else invalidate();
      } catch {
        if (!ended && epoch === fence.current.epoch) invalidate();
      } finally {
        if (!ended) setChecked(true);
      }
    };
    void check();
    const timer = setInterval(() => { void check(); }, 1000);
    window.addEventListener("focus", check);
    return () => { ended = true; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [adopt, invalidate]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    authenticating.current = true;
    invalidate();
    const epoch = fence.current.epoch;
    setBusy("sign-in"); setNotice(null);
    try {
      const r = await fetch(auth + "?action=login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (r.status === 429) { setNotice({ tone: "error", text: "Please wait a moment before signing in again." }); return; }
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (epoch !== fence.current.epoch) return;
      setPassword("");
      adopt(data);
    } catch {
      setNotice({ tone: "error", text: "Sign-in refused. Check the address and password; the account and membership must both be active." });
    } finally {
      authenticating.current = false;
      setBusy(null);
    }
  }
  async function signOut() {
    await fetch(auth + "?action=logout", { method: "POST" }).catch(() => undefined);
    invalidate(); setNotice(null);
  }
  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    const epoch = fence.current.epoch;
    setBusy("upload"); setNotice(null);
    try {
      const r = await fetch(api + "?action=upload", { method: "POST", headers: { "Content-Type": "text/csv", "X-FinGence-File-Name": encodeURIComponent(chosen.name) }, body: chosen });
      const data = await r.json().catch(() => ({}));
      if (epoch !== fence.current.epoch) return;
      if (r.status === 422) { setNotice({ tone: "error", text: [uploadRefusals[data.refused] ?? "The file was refused.", ...(data.details ?? [])].join(" ") }); return; }
      if (!r.ok) throw new Error();
      setNotice({ tone: "success", text: `${chosen.name}: ${data.rowCount.toLocaleString()} rows ${data.duplicate ? "were already stored; the existing source was selected" : "stored and analyzed"}.` });
      await refresh({ sourceId: data.sourceId });
    } catch {
      if (epoch === fence.current.epoch) setNotice({ tone: "error", text: "Upload refused. Only Finance members can upload a source of at most 5 MB with a .csv name." });
    } finally {
      if (epoch === fence.current.epoch) setBusy(null);
    }
  }
  async function review(candidate: PocCandidate, state: ReviewState) {
    if (!analysis) return;
    const epoch = fence.current.epoch, current = analysis.selection;
    setBusy(candidate.rowId); setNotice(null);
    try {
      const r = await fetch(api + "?action=review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: analysis.source.id, rowId: candidate.rowId, state, expectedVersion: candidate.review.version }) });
      if (epoch !== fence.current.epoch) return;
      if (r.status === 409) setNotice({ tone: "error", text: "This review changed since it was loaded. The list was refreshed; check it and try again." });
      else if (!r.ok) throw new Error();
      else setNotice({ tone: "success", text: `${candidate.rowId} marked ${reviewLabels[state].toLowerCase()}.` });
      await load({ sourceId: analysis.source.id, ...current });
    } catch {
      if (epoch === fence.current.epoch) setNotice({ tone: "error", text: "The review decision could not be recorded or audited." });
    } finally {
      if (epoch === fence.current.epoch) setBusy(null);
    }
  }

  const notices = notice ? <p role={notice.tone === "error" ? "alert" : "status"} className={`mb-4 rounded-lg border px-4 py-3 text-sm ${notice.tone === "error" ? "border-red-200 bg-[var(--red-soft)] text-[var(--red)]" : "border-green-200 bg-[var(--green-soft)] text-[var(--green)]"}`}>{notice.text}</p> : null;
  const header = (actions?: React.ReactNode) => <PageHeader title="Anomaly review" description="Rule-based review candidates calculated from your organization's uploaded synthetic source data." actions={actions} />;

  if (!principal) {
    return (
      <>
        {header()}
        {notices}
        {!checked ? <Panel><p className="p-5 text-sm text-[var(--muted)]" role="status">Checking your session…</p></Panel> : (
          <Panel title="Sign in" eyebrow="Finance access">
            <form onSubmit={signIn} className="grid gap-4 p-5 sm:max-w-md">
              <label className="text-sm font-medium">Email<input className={field} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
              <label className="text-sm font-medium">Password<input className={field} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
              <button className={primary} disabled={busy === "sign-in"}>{busy === "sign-in" ? "Signing in…" : "Sign in"}</button>
            </form>
          </Panel>
        )}
      </>
    );
  }
  const signOutButton = <button type="button" className={secondary} onClick={signOut}><LogOut aria-hidden="true" size={16} /> Sign out</button>;
  if (principal.role !== "Finance") {
    return (
      <>
        {header(signOutButton)}
        {notices}
        <Panel><div className="p-5"><EmptyState title="Finance access required" description={`Anomaly review reads organization financial source rows, so it is available to Finance members only. You are signed in as ${principal.role}.`} /></div></Panel>
      </>
    );
  }

  const selected = analysis?.candidates.find(c => c.rowId === selectedRow) ?? null;
  const business = analysis?.options.find(o => o.businessId === analysis.selection.businessId);
  const reportQuery = analysis ? query({ sourceId: analysis.source.id, ...analysis.selection }) : "";
  return (
    <>
      {header(<div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)]"><CircleGauge aria-hidden="true" size={15} className="text-[var(--teal)]" /> Transparent rules · synthetic data</span>{signOutButton}</div>)}
      {notices}

      <Panel title="Source data" eyebrow="Finance-owned input" action={<>
        <input ref={file} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Choose a source CSV" onChange={upload} />
        <button type="button" className={primary} disabled={busy === "upload"} onClick={() => file.current?.click()}><Upload aria-hidden="true" size={16} />{busy === "upload" ? "Uploading…" : "Upload CSV"}</button>
      </>}>
        <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-4">
          {sources === null ? <p className="text-sm text-[var(--muted)] md:col-span-4" role="status">Loading sources…</p> : !sources.length ? (
            <div className="md:col-span-4"><EmptyState title="No source uploaded yet" description="Upload source_transactions_6000.csv or the March bank statement from the synthetic PoC pack. Label and ground-truth files are refused." /></div>
          ) : (<>
            <label className="text-sm font-medium md:col-span-2">Source file
              <select className={field} value={analysis?.source.id ?? ""} onChange={e => void load({ sourceId: e.target.value })}>
                {sources.map(s => <option key={s.id} value={s.id}>{s.fileName} · {s.rowCount.toLocaleString()} rows · {new Date(s.uploadedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">Business
              <select className={field} disabled={!analysis} value={analysis?.selection.businessId ?? ""} onChange={e => analysis && void load({ sourceId: analysis.source.id, businessId: e.target.value })}>
                {analysis?.options.map(o => <option key={o.businessId} value={o.businessId}>{o.businessId} · {o.businessName}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">Period
              <select className={field} disabled={!analysis} value={analysis?.selection.period ?? ""} onChange={e => analysis && void load({ sourceId: analysis.source.id, businessId: analysis.selection.businessId, period: e.target.value, currency: analysis.selection.currency })}>
                {business?.periods.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            {analysis ? <p className="break-all text-xs text-[var(--muted)] md:col-span-4">SHA-256 {analysis.source.sha256} · {analysis.source.layout === "BANK_STATEMENT" ? "bank statement layout" : "normalized transaction layout"} · {analysis.selection.currency}</p> : null}
          </>)}
        </div>
      </Panel>

      {loading && !analysis ? <Panel className="mt-4"><p className="p-5 text-sm text-[var(--muted)]" role="status">Calculating review candidates…</p></Panel> : null}
      {analysis ? (<>
        <section className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Anomaly review metrics" aria-busy={loading}>
          {([
            ["Review candidates", String(analysis.counts.candidates), `${analysis.cashMovement.rows} source rows in ${analysis.selection.period}`, AlertTriangle, "var(--amber)"],
            ["High severity", String(analysis.counts.high), `${analysis.counts.medium} medium`, AlertOctagon, "var(--red)"],
            ["Open reviews", String(analysis.counts.byReview.OPEN), `${analysis.counts.byReview.EXPLAINED} explained · ${analysis.counts.byReview.ESCALATED} escalated`, Flag, "var(--teal)"],
            ["Net signed movement", money(analysis.selection.currency, analysis.cashMovement.net), "Source bank amounts; not revenue or profit", CircleGauge, "var(--teal)"],
          ] as const).map(([label, value, note, Icon, color], index) => (
            <article key={label} className={`panel-shadow min-w-0 rounded-xl border border-[var(--border)] bg-white p-4 sm:p-5 ${index === 3 ? "col-span-2 xl:col-span-1" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><p className="text-xs text-[var(--muted)]">{label}</p><p className="mt-2 break-words text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">{value}</p></div>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-50" style={{ color }}><Icon aria-hidden="true" size={20} /></span>
              </div>
              <p className="mt-3 text-[11px] text-[var(--muted)]">{note}</p>
            </article>
          ))}
        </section>

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel title="Review candidates" action={<span className="text-xs text-[var(--muted)]">{analysis.selection.businessId} · {analysis.selection.period}</span>}>
            {!analysis.candidates.length ? <div className="p-5"><EmptyState title="No review candidates" description="No rule produced a candidate for this business and period." /></div> : (<>
              <div className="thin-scrollbar hidden overflow-x-auto md:block">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="bg-[var(--surface-subtle)] text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                    <tr>{["Severity", "Source row", "Counterparty and rules", "Signed amount", "Review"].map(h => <th key={h} className={`px-3 py-3 font-semibold ${h === "Signed amount" ? "text-right" : ""}`}>{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {analysis.candidates.map(c => (
                      <tr key={c.rowId} className={selected?.rowId === c.rowId ? "bg-[var(--teal-soft)]/60" : "hover:bg-slate-50"}>
                        <td className="px-3 py-3"><Severity value={c.severity} /></td>
                        <td className="px-3 py-3"><button type="button" onClick={() => setSelectedRow(c.rowId)} className="text-left font-semibold hover:text-[var(--teal)] hover:underline">{c.rowId}<span className="mt-0.5 block text-[10px] font-normal text-[var(--muted)]">{c.date} · Ref {c.reference}</span></button></td>
                        <td className="px-3 py-3">{c.counterparty}<span className="mt-0.5 block text-[10px] text-[var(--muted)]">{c.findings.map(f => f.title).join(", ")}</span></td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums">{money(c.currency, c.signedAmount)}</td>
                        <td className="px-3 py-3"><StatusBadge status={reviewLabels[c.review.state]} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="divide-y divide-[var(--border)] md:hidden">
                {analysis.candidates.map(c => (
                  <li key={c.rowId}>
                    <button type="button" onClick={() => setSelectedRow(c.rowId)} className={`block w-full px-4 py-3 text-left ${selected?.rowId === c.rowId ? "bg-[var(--teal-soft)]/60" : ""}`}>
                      <span className="flex items-center justify-between gap-2"><Severity value={c.severity} /><StatusBadge status={reviewLabels[c.review.state]} /></span>
                      <span className="mt-2 block break-all text-sm font-semibold">{c.rowId}</span>
                      <span className="mt-0.5 block text-xs text-[var(--muted)]">{c.date} · {c.counterparty}</span>
                      <span className="mt-1 block text-sm font-semibold tabular-nums">{money(c.currency, c.signedAmount)}</span>
                      <span className="mt-1 block text-xs text-[var(--muted-strong)]">{c.findings.map(f => f.title).join(", ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>)}
          </Panel>

          <Panel title="Source row and rationale" action={selected ? <Severity value={selected.severity} /> : undefined}>
            {!selected ? <div className="p-5"><EmptyState title="Select a candidate" description="Choose a review candidate to see its source row and why it was flagged." /></div> : (
              <div className="p-5">
                <p className="break-all text-lg font-semibold tracking-[-0.02em]">{selected.rowId}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">{selected.date} · {selected.direction} · {selected.counterparty}</p>
                <section className="mt-5">
                  <h3 className="text-sm font-semibold">Why this needs review</h3>
                  <ul className="mt-3 space-y-3">
                    {selected.findings.map(f => (
                      <li key={f.ruleId} className="flex gap-2.5 text-xs leading-5 text-[var(--muted-strong)]"><AlertTriangle aria-hidden="true" size={15} className={`mt-0.5 shrink-0 ${f.severity === "HIGH" ? "text-[var(--red)]" : "text-[var(--amber)]"}`} /><span><span className="font-semibold text-[var(--ink)]">{f.title} · {f.ruleId}</span><br />{f.rationale}</span></li>
                    ))}
                  </ul>
                </section>
                <dl className="mt-5 divide-y divide-[var(--border)] border-y border-[var(--border)] text-sm">
                  {([["Source row ID", selected.rowId], ...(selected.sourceTransactionId ? [["Source transaction ID", selected.sourceTransactionId]] : []), ["Reference", selected.reference], ["Bank description", selected.description], ["Direction", selected.direction], ["Amount", money(selected.currency, selected.amount)], ["Signed movement", money(selected.currency, selected.signedAmount)], ["Review", `${reviewLabels[selected.review.state]}${selected.review.decidedAt ? ` · ${new Date(selected.review.decidedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : ""}`]] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-4 py-2.5"><dt className="shrink-0 text-[var(--muted)]">{k}</dt><dd className="min-w-0 break-words text-right font-medium">{v}</dd></div>
                  ))}
                </dl>
                <div className="mt-5 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                  <button type="button" disabled={busy !== null || selected.review.state === "EXPLAINED"} onClick={() => review(selected, "EXPLAINED")} className={secondary}><Check aria-hidden="true" size={15} /> Explained</button>
                  <button type="button" disabled={busy !== null || selected.review.state === "ESCALATED"} onClick={() => review(selected, "ESCALATED")} className={primary}><Flag aria-hidden="true" size={15} /> Escalate</button>
                  <button type="button" disabled={busy !== null || selected.review.state === "OPEN"} onClick={() => review(selected, "OPEN")} className={secondary}><RotateCcw aria-hidden="true" size={15} /> Reopen</button>
                </div>
                <p className="mt-3 text-[11px] leading-4 text-[var(--muted)]">A candidate is a reason to review, not a fraud finding. Decisions are recorded with your account and audited; nothing is cleared automatically.</p>
              </div>
            )}
          </Panel>
        </div>

        <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
          <Panel title="Management report" eyebrow="Download" className="scroll-mt-24">
            <div id="management-report" className="p-5 text-sm">
              <p className="text-[var(--muted-strong)]">One report for <span className="font-semibold text-[var(--ink)]">{analysis.selection.businessName} ({analysis.selection.businessId}), {analysis.selection.period}</span>, built from this exact source file and these review decisions.</p>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <dt className="text-[var(--muted)]">Credits</dt><dd className="text-right font-semibold tabular-nums">{money(analysis.selection.currency, analysis.cashMovement.credits)}</dd>
                <dt className="text-[var(--muted)]">Debits</dt><dd className="text-right font-semibold tabular-nums">{money(analysis.selection.currency, analysis.cashMovement.debits)}</dd>
                <dt className="text-[var(--muted)]">Net signed movement</dt><dd className="text-right font-semibold tabular-nums">{money(analysis.selection.currency, analysis.cashMovement.net)}</dd>
                <dt className="text-[var(--muted)]">Reconciliation</dt><dd className="text-right">Included only when a FinancePoCReconciliationV1 snapshot exists for this scope</dd>
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <a className={primary} href={`${api}?action=report&format=pdf&${reportQuery}`} download><FileText aria-hidden="true" size={16} /> Download PDF</a>
                <a className={secondary} href={`${api}?action=report&format=json&${reportQuery}`} download><FileJson aria-hidden="true" size={16} /> JSON evidence</a>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--muted)]"><Download aria-hidden="true" size={12} /> Each download is audited and content-hashed. Separate downloads have their own generation time; source figures and references remain consistent.</p>
            </div>
          </Panel>
          <Panel title="Rules and evaluation" eyebrow={analysis.detectorVersion}>
            <div className="p-5 text-xs">
              <ul className="space-y-2">
                {analysis.rules.map(r => <li key={r.id} className="flex justify-between gap-3"><span><span className="font-semibold text-[var(--ink)]">{r.title}</span> <span className="text-[var(--muted)]">— {r.basis}</span></span><span className="shrink-0 font-semibold tabular-nums">{analysis.counts.byRule[r.id]}</span></li>)}
              </ul>
              <p className="mt-4 text-[var(--muted)]">Baseline: {analysis.baseline}</p>
              {analysis.evaluation ? (
                <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3">
                  <p className="font-semibold text-[var(--ink)]">Offline evaluation · dataset-specific</p>
                  <p className="mt-1 text-[var(--muted-strong)]">Precision {analysis.evaluation.precision} · recall {analysis.evaluation.recall} on {analysis.evaluation.rows.toLocaleString()} rows (TP {analysis.evaluation.truePositives}, FP {analysis.evaluation.falsePositives}, FN {analysis.evaluation.falseNegatives}, TN {analysis.evaluation.trueNegatives}).</p>
                  <p className="mt-1 text-[var(--muted)]">Measured once, offline, against held-out synthetic labels for this exact file. Not a live model metric; the app never reads labels.</p>
                </div>
              ) : <p className="mt-4 text-[var(--muted)]">No offline evaluation exists for this exact file, so no precision or recall is shown.</p>}
              <ul className="mt-4 list-disc space-y-1 pl-4 text-[var(--muted)]">{analysis.limitations.map(l => <li key={l}>{l}</li>)}</ul>
            </div>
          </Panel>
        </div>
      </>) : null}
    </>
  );
}
