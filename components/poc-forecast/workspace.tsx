"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarRange, FlaskConical, LogOut, Scale } from "lucide-react";
import { LineChart } from "@/components/charts";
import { EmptyState, PageHeader, Panel } from "@/components/ui";
import { M2ClientFence, principalScope, type M2ClientPrincipal } from "@/lib/ai-ingestion/m2-client-state";
import { groupDigits } from "@/lib/poc-anomalies/format";
import type { Method, MethodScore, Metric, MonthTotals } from "@/lib/poc-forecast/forecast";
import type { ForecastSource, ForecastView } from "@/lib/server/poc-forecast/service";
import { readSelection, rememberSelection, forgetSelection, forecastContext, browserSelectionStorage } from "@/lib/poc-insights/selection";

type Notice = { tone: "success" | "error"; text: string } | null;
type Selection = { sourceId: string; businessId?: string };
const auth = "/api/ai-ingestion/m2", api = auth + "/forecast";
const scopeKey = (p: { userId: string; organizationId: string; role: string; membershipVersion: number }) => JSON.stringify([principalScope(p as M2ClientPrincipal), p.role, p.membershipVersion]);
const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (period: string, long = false) => { const [y, m] = period.split("-"); return `${monthNames[Number(m) - 1]} ${long ? y : y.slice(2)}`; };
const money = (currency: string | null, value: string) => `${currency ?? ""} ${groupDigits(value)}`.trim();
const methodLabels: Record<Method, string> = { LAST_MONTH: "Last month", MEAN_3: "3-month mean", MEAN_6: "6-month mean" };
const metricLabels: Record<Metric, string> = { credits: "Receipts (credits)", debits: "Payments (debits)", net: "Net movement" };
const refusalTitles: Record<string, string> = { INSUFFICIENT_HISTORY: "Not enough history", NONCONSECUTIVE_MONTHS: "Months are not consecutive", CURRENCY_MIX: "More than one currency", SIGN_CONVENTION: "Sign convention mismatch", NO_ROWS: "No rows" };
const percent = (value: string | null) => value === null ? "n/a" : `${value}%`;
const points = (value: string | null) => value === null ? "n/a" : `${value.startsWith("-") ? "" : "+"}${value} pp`;
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-50";
const field = "mt-1 block min-h-11 w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm";
const th = "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--muted)]", td = "px-3 py-2 text-sm tabular-nums";

function ScoreTable({ title, rows, currency }: { title: string; rows: { metric: Metric; methods: MethodScore[]; lowestWape: Method | null }[]; currency: string | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse">
        <caption className="sr-only">{title}</caption>
        <thead className="border-b border-[var(--border)] bg-[var(--surface-subtle)]">
          <tr><th className={th} scope="col">Metric</th>{(["LAST_MONTH", "MEAN_3", "MEAN_6"] as Method[]).map(m => <th key={m} className={th} scope="col">{methodLabels[m]}<span className="block font-normal normal-case tracking-normal">WAPE · MAE</span></th>)}<th className={th} scope="col">6-month vs last month</th></tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map(r => {
            const six = r.methods.find(m => m.method === "MEAN_6")!;
            return (
              <tr key={r.metric} className={r.metric === "net" ? "bg-amber-50/60" : undefined}>
                <th scope="row" className="px-3 py-2 text-left text-sm font-semibold">{metricLabels[r.metric]}{r.metric === "net" ? <span className="block text-[11px] font-medium text-[var(--amber)]">Experimental · low confidence</span> : null}</th>
                {r.methods.map(m => (
                  <td key={m.method} className={td}>
                    <span className={`font-semibold ${r.lowestWape === m.method ? "text-[var(--teal)]" : ""}`}>{percent(m.wape)}</span>{r.lowestWape === m.method ? <span className="ml-1 text-[10px] font-bold uppercase text-[var(--teal)]">lowest</span> : null}
                    <span className="block text-xs text-[var(--muted)]">{money(currency, m.mae)} · {m.tests} tests</span>
                  </td>
                ))}
                <td className={td}>{points(six.wapeChangeVsLastMonth)}<span className="block text-xs text-[var(--muted)]">{six.wapeChangeVsLastMonth === null ? "" : six.wapeChangeVsLastMonth.startsWith("-") ? "lower error" : six.wapeChangeVsLastMonth === "0.00" ? "same error" : "higher error"}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ForecastWorkspace() {
  const fence = useRef(new M2ClientFence()), authenticating = useRef(false), request = useRef(0), sessionPaused = useRef(false);
  const [principal, setPrincipal] = useState<M2ClientPrincipal | null>(null), [checked, setChecked] = useState(false);
  const [sources, setSources] = useState<ForecastSource[] | null>(null), [view, setView] = useState<ForecastView | null>(null);
  const [navigation, setNavigation] = useState("");
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState<Notice>(null);
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");

  // Every financial figure is dropped on sign-out, session loss, or any user, organization, role or membership change.
  const clear = useCallback(() => { request.current++; setSources(null); setView(null); setNavigation(""); setLoading(false); }, []);
  const invalidate = useCallback(() => { forgetSelection(browserSelectionStorage, fence.current.principal); fence.current.invalidate(); clear(); setPrincipal(null); }, [clear]);
  const load = useCallback(async (selection: Selection) => {
    const p = fence.current.principal;
    if (!p || p.role !== "Finance") return;
    const epoch = fence.current.epoch, sequence = ++request.current;
    setLoading(true); setView(null); setNotice(null);
    try {
      const q = new URLSearchParams({ action: "forecast", source: selection.sourceId, ...(selection.businessId ? { business: selection.businessId } : {}) });
      const r = await fetch(`${api}?${q}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const data = await r.json() as ForecastView;
      if (epoch !== fence.current.epoch || sequence !== request.current) return;
      if (scopeKey(data.scope) !== scopeKey(p) || data.source.id !== selection.sourceId || (selection.businessId && data.selection.businessId !== selection.businessId)) throw new Error();
      const context = forecastContext(readSelection(browserSelectionStorage, p, location.search), data.source.id, data.selection.businessId, data.business.currency, data.business.history.map(m => m.period));
      rememberSelection(browserSelectionStorage, p, context);
      setView(data);
      const query = new URLSearchParams(context).toString();
      setNavigation(query);
      history.replaceState(null, "", `/forecasting?${query}`);
    } catch {
      if (epoch === fence.current.epoch && sequence === request.current) { setView(null); setNotice({ tone: "error", text: "The selected source could not be forecast for this account. Refresh or choose another source." }); }
    } finally {
      if (epoch === fence.current.epoch && sequence === request.current) setLoading(false);
    }
  }, []);
  const refresh = useCallback(async () => {
    const p = fence.current.principal;
    if (!p || p.role !== "Finance") return;
    const epoch = fence.current.epoch;
    try {
      const r = await fetch(api + "?action=sources", { cache: "no-store" });
      if (!r.ok) throw new Error();
      const data = await r.json() as { scope: ForecastView["scope"]; sources: ForecastSource[] };
      if (epoch !== fence.current.epoch) return;
      if (scopeKey(data.scope) !== scopeKey(p)) throw new Error();
      setSources(data.sources);
      const hinted = readSelection(browserSelectionStorage, p, location.search);
      if (hinted && !data.sources.some(s => s.id === hinted.source)) throw new Error();
      const chosen = hinted ? { sourceId: hinted.source, businessId: hinted.business } : data.sources[0] ? { sourceId: data.sources[0].id } : null;
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
      if (authenticating.current || sessionPaused.current) return;
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
    sessionPaused.current = true;
    invalidate();
    const epoch = fence.current.epoch;
    setBusy(true); setNotice(null);
    try {
      const r = await fetch(auth + "?action=login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (r.status === 429) { setNotice({ tone: "error", text: "Please wait a moment before signing in again." }); return; }
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (epoch !== fence.current.epoch) return;
      setPassword("");
      sessionPaused.current = false;
      adopt(data);
    } catch {
      setNotice({ tone: "error", text: "Sign-in refused. Check the address and password; the account and membership must both be active." });
    } finally {
      authenticating.current = false;
      setBusy(false);
    }
  }
  async function signOut() {
    sessionPaused.current = true;
    invalidate(); setNotice(null);
    try { const r = await fetch(auth + "?action=logout", { method: "POST" }); if (!r.ok) throw new Error(); }
    catch { setNotice({ tone: "error", text: "Financial results are hidden. Server sign-out is unconfirmed; sign in again explicitly to continue." }); }
  }

  const notices = notice ? <p role={notice.tone === "error" ? "alert" : "status"} className={`mb-4 rounded-lg border px-4 py-3 text-sm ${notice.tone === "error" ? "border-red-200 bg-[var(--red-soft)] text-[var(--red)]" : "border-green-200 bg-[var(--green-soft)] text-[var(--green)]"}`}>{notice.text}</p> : null;
  const header = (actions?: React.ReactNode) => <PageHeader title="Cash forecasting" description="Bank cash receipts and payments from your organization's uploaded synthetic source, with a backtested deterministic baseline." actions={actions} />;
  const label = (
    <aside className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" aria-label="Forecast basis">
      <FlaskConical aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-amber-700" />
      <p><strong>Synthetic data · deterministic six-month-average baseline.</strong> This is NOT AI, machine learning or a trained model, and NOT revenue, profit or a statutory cash flow statement. No confidence intervals are produced.</p>
    </aside>
  );

  if (!principal) {
    return (
      <>
        {header()}
        {label}
        {notices}
        {!checked ? <Panel><p className="p-5 text-sm text-[var(--muted)]" role="status">Checking your session…</p></Panel> : (
          <Panel title="Sign in" eyebrow="Finance access">
            <form onSubmit={signIn} className="grid gap-4 p-5 sm:max-w-md">
              <label className="text-sm font-medium">Email<input className={field} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
              <label className="text-sm font-medium">Password<input className={field} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
              <button className={primary} disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
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
        <Panel><div className="p-5"><EmptyState title="Finance access required" description={`Cash forecasting reads organization financial source rows, so it is available to Finance members only. You are signed in as ${principal.role}.`} /></div></Panel>
      </>
    );
  }

  const b = view?.business, f = b?.forecast, currency = b?.currency ?? null, available = f?.status === "AVAILABLE" ? f : null;
  const totals: MonthTotals[] = b?.history ?? [];
  const labels = [...totals.map(m => monthLabel(m.period)), ...(available ? [monthLabel(available.period)] : [])];
  const tail = (values: number[], next?: string) => available ? [...values.slice(0, -1).map(() => null), values.at(-1)!, Number(next)] : [];
  const credits = totals.map(m => Number(m.credits)), debits = totals.map(m => Number(m.debits));
  const netTest = available?.backtest.net, netSix = netTest?.methods.find(m => m.method === "MEAN_6"), netLowest = netTest?.lowestWape ? netTest.methods.find(m => m.method === netTest.lowestWape) : undefined;
  const pooled = view?.portfolio.backtest, pooledNet = pooled?.net, pooledSix = pooledNet?.methods.find(m => m.method === "MEAN_6"), pooledLowest = pooledNet?.lowestWape ? pooledNet.methods.find(m => m.method === pooledNet.lowestWape) : undefined;

  return (
    <>
      {header(<div className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--muted)]"><Scale aria-hidden="true" size={15} className="text-[var(--teal)]" /> Measured baseline · synthetic data</span>{signOutButton}</div>)}
      {label}
      {notices}

      {view && !loading ? <nav aria-label="Selected source views" className="mb-4 flex flex-wrap gap-2"><Link className={secondary} href={`/transactions?${navigation}`}>Transactions</Link><Link className={secondary} href={`/analytics?${navigation}`}>Analytics</Link><Link className={secondary} href={`/anomalies?${navigation}`}>Anomalies</Link><Link className={secondary} href={`/anomalies?${navigation}#management-report`}>Management report</Link></nav> : null}

      <Panel title="Source data" eyebrow="Finance-uploaded input">
        <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-3">
          {sources === null ? <p className="text-sm text-[var(--muted)] md:col-span-3" role="status">Loading sources…</p> : !sources.length ? (
            <div className="md:col-span-3"><EmptyState title="No source uploaded yet" description="Forecasts read the same Finance-uploaded source as anomaly review. Upload source_transactions_6000.csv on the Anomalies page first." /><p className="mt-3 text-center"><Link className="text-sm font-semibold text-[var(--teal)] underline" href="/anomalies">Open Anomalies to upload a source</Link></p></div>
          ) : (<>
            <label className="min-w-0 text-sm font-medium md:col-span-2">Source file
              <select aria-label="Source file" className={field} disabled={loading} value={view?.source.id ?? ""} onChange={e => void load({ sourceId: e.target.value })}>
                {!view ? <option value="">Choose a source</option> : null}
                {sources.map(s => <option key={s.id} value={s.id}>{s.fileName} · {s.rowCount.toLocaleString()} rows · {new Date(s.uploadedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-sm font-medium">Business
              <select aria-label="Business" className={field} disabled={!view || loading} value={view?.selection.businessId ?? ""} onChange={e => view && void load({ sourceId: view.source.id, businessId: e.target.value })}>
                {view?.options.map(o => <option key={o.businessId} value={o.businessId}>{o.businessName} ({o.businessId})</option>)}
              </select>
            </label>
            {view ? (
              <dl className="grid gap-3 text-sm md:col-span-3 sm:grid-cols-3">
                <div className="min-w-0"><dt className="text-xs text-[var(--muted)]">Source SHA-256</dt><dd className="mt-1 break-all font-mono text-xs">{view.source.sha256}</dd></div>
                <div><dt className="text-xs text-[var(--muted)]">History interval</dt><dd className="mt-1 font-medium">{b?.interval ? `${monthLabel(b.interval.first, true)} – ${monthLabel(b.interval.last, true)} · ${b.interval.months} month${b.interval.months === 1 ? "" : "s"}` : "None"}</dd></div>
                <div><dt className="text-xs text-[var(--muted)]">Rows for this business</dt><dd className="mt-1 font-medium">{view.options.find(o => o.businessId === view.selection.businessId)?.rows.toLocaleString()} of {view.source.rowCount.toLocaleString()} · {currency ?? "no single currency"}</dd></div>
              </dl>
            ) : null}
          </>)}
        </div>
      </Panel>

      {loading && !view ? <Panel className="mt-4"><p className="p-5 text-sm text-[var(--muted)]" role="status">Computing forecast…</p></Panel> : null}

      {view && b && f ? (<>
        {f.status === "UNAVAILABLE" ? (
          <div role="status" className="mt-4 flex items-start gap-3 rounded-lg border border-red-200 bg-[var(--red-soft)] p-4 text-sm text-[var(--red)]">
            <AlertTriangle aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
            <p><strong>Forecast unavailable: {refusalTitles[f.code] ?? f.code}.</strong> {f.detail} No forecast, backtest or confidence figure is shown.</p>
          </div>
        ) : (
          <section className="mt-4 grid gap-3 md:grid-cols-3" aria-label={`Next-month forecast for ${monthLabel(f.period, true)}`}>
            {([["credits", "Receipts forecast", ArrowDownLeft, f.credits], ["debits", "Payments forecast", ArrowUpRight, f.debits], ["net", "Net movement (derived)", Scale, f.net]] as const).map(([metric, title, Icon, value]) => {
              const six = f.backtest[metric].methods.find(m => m.method === "MEAN_6")!, net = metric === "net";
              return (
                <article key={metric} className={`panel-shadow min-w-0 rounded-xl border p-4 sm:p-5 ${net ? "border-amber-300 bg-amber-50" : "border-[var(--border)] bg-white"}`}>
                  <p className="flex items-center gap-2 text-[13px] font-medium text-[var(--muted-strong)]"><Icon aria-hidden="true" size={16} className={net ? "text-amber-700" : "text-[var(--teal)]"} />{title} · {monthLabel(f.period, true)}</p>
                  <p className="mt-2 break-words text-[22px] font-semibold leading-tight tracking-[-0.03em] tabular-nums sm:text-[25px]">{money(currency, value)}</p>
                  <p className="mt-2 text-xs text-[var(--muted)]">Mean of {monthLabel(f.basis.first, true)} – {monthLabel(f.basis.last, true)}{net ? " receipts minus payments" : ""}</p>
                  <p className={`mt-1 text-xs font-medium ${net ? "text-[var(--amber)]" : "text-[var(--muted-strong)]"}`}>Backtest WAPE {percent(six.wape)} · MAE {money(currency, six.mae)} over {six.tests} months{net ? " · experimental, low confidence" : ""}</p>
                </article>
              );
            })}
          </section>
        )}

        {netTest && netSix ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-white p-3 text-xs leading-5 text-amber-950">
            <AlertTriangle aria-hidden="true" size={15} className="mt-0.5 shrink-0 text-amber-700" />
            <span>Net movement is the small difference between two large flows, so its relative error is large: six-month WAPE {percent(netSix.wape)} for this business{netLowest && netLowest.method !== "MEAN_6" ? `, worse than the ${methodLabels[netLowest.method].toLowerCase()} baseline (${percent(netLowest.wape)})` : ""}.{pooledSix && pooledLowest && pooledLowest.method !== "MEAN_6" ? ` Across all ${view?.portfolio.included.length} businesses the ${methodLabels[pooledLowest.method].toLowerCase()} baseline had lower net error (${percent(pooledLowest.wape)} vs ${percent(pooledSix.wape)}), so the six-month baseline is not better for net movement.` : ""} Do not use it for decisions.</span>
          </p>
        ) : null}

        <Panel title="Monthly receipts and payments" eyebrow={`${view.selection.businessName} · bank source rows`} className="mt-4">
          <div className="min-w-0 p-4 sm:p-5">
            {totals.length ? (
              <LineChart labels={labels} height={300}
                series={[
                  { label: "Receipts", color: "#0e7c74", values: [...credits, ...(available ? [null] : [])] },
                  { label: "Payments", color: "#b45309", values: [...debits, ...(available ? [null] : [])] },
                  ...(available ? [{ label: "Receipts forecast", color: "#0e7c74", values: tail(credits, available.credits), dashed: true }, { label: "Payments forecast", color: "#b45309", values: tail(debits, available.debits), dashed: true }] : []),
                ]}
                ariaLabel={`Monthly bank receipts and payments for ${view.selection.businessName}${available ? ` with the ${monthLabel(available.period, true)} six-month-mean forecast` : ""}`} />
            ) : <EmptyState title="No monthly history" description="This business has no rows that can be aggregated into one currency." />}
          </div>
          {totals.length ? (
            <div className="overflow-x-auto border-t border-[var(--border)]">
              <table className="w-full min-w-[560px] border-collapse">
                <caption className="sr-only">Monthly totals from source rows</caption>
                <thead className="bg-[var(--surface-subtle)]"><tr><th className={th} scope="col">Month</th><th className={th} scope="col">Rows</th><th className={th} scope="col">Receipts</th><th className={th} scope="col">Payments</th><th className={th} scope="col">Net movement</th></tr></thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {totals.map(m => <tr key={m.period}><th scope="row" className="px-3 py-2 text-left text-sm font-medium">{monthLabel(m.period, true)}</th><td className={td}>{m.rows}</td><td className={td}>{money(currency, m.credits)}</td><td className={td}>{money(currency, m.debits)}</td><td className={`${td} ${m.net.startsWith("-") ? "text-[var(--red)]" : ""}`}>{money(currency, m.net)}</td></tr>)}
                </tbody>
              </table>
            </div>
          ) : null}
        </Panel>

        {available ? (<>
          <Panel title="Rolling-origin backtest" eyebrow={`${view.selection.businessId} · ${available.tests} months forecast only from earlier months`} className="mt-4">
            <ScoreTable title="Backtest scores for this business" rows={(["credits", "debits", "net"] as Metric[]).map(m => available.backtest[m])} currency={currency} />
            <div className="overflow-x-auto border-t border-[var(--border)]">
              <table className="w-full min-w-[640px] border-collapse">
                <caption className="px-3 pt-3 text-left text-xs font-semibold text-[var(--muted-strong)]">Six-month-mean forecast against the observed month</caption>
                <thead className="bg-[var(--surface-subtle)]"><tr><th className={th} scope="col">Month</th>{(["credits", "debits", "net"] as Metric[]).map(m => <th key={m} className={th} scope="col">{metricLabels[m]}<span className="block font-normal normal-case tracking-normal">observed · forecast</span></th>)}</tr></thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {available.backtest.credits.points.map((p, i) => (
                    <tr key={p.period}><th scope="row" className="px-3 py-2 text-left text-sm font-medium">{monthLabel(p.period, true)}</th>
                      {(["credits", "debits", "net"] as Metric[]).map(m => { const point = available.backtest[m].points[i]; return <td key={m} className={td}>{groupDigits(point.actual)}<span className="block text-xs text-[var(--muted)]">{groupDigits(point.forecasts.MEAN_6)}</span></td>; })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          {pooled ? (
            <Panel title="All businesses in this source" eyebrow={`Pooled · ${view.portfolio.included.length} business${view.portfolio.included.length === 1 ? "" : "es"} · ${pooled.credits.methods[0].tests} tests`} className="mt-4">
              <ScoreTable title="Pooled backtest scores" rows={(["credits", "debits", "net"] as Metric[]).map(m => pooled[m])} currency={currency} />
              <p className="border-t border-[var(--border)] p-4 text-xs leading-5 text-[var(--muted)]">Pooled WAPE sums errors across {view.portfolio.included.join(", ")}, so it is dominated by the largest business. Pooled MAE mixes very different business sizes.{view.portfolio.excluded.length ? ` Excluded: ${view.portfolio.excluded.map(e => `${e.businessId} (${(refusalTitles[e.code] ?? "other currency").toLowerCase()})`).join(", ")}.` : ""}</p>
            </Panel>
          ) : null}
        </>) : null}

        <Panel title="Method and limitations" className="mt-4">
          <div className="grid gap-4 p-4 text-sm leading-6 sm:p-5 lg:grid-cols-2">
            <div className="space-y-2">
              <p className="flex items-start gap-2"><CalendarRange aria-hidden="true" size={16} className="mt-1 shrink-0 text-[var(--teal)]" />{view.method.description}</p>
              <p className="text-[var(--muted-strong)]">{view.method.wape}</p>
              <p className="text-[var(--muted-strong)]">{view.method.mae}</p>
              <p className="text-xs text-[var(--muted)]">Needs at least {view.method.minimumMonths} consecutive months. Version {view.forecastVersion}.</p>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-[var(--muted-strong)]">{view.limitations.map(l => <li key={l}>{l}</li>)}</ul>
          </div>
        </Panel>
      </>) : null}
    </>
  );
}
