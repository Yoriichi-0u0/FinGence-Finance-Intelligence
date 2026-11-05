"use client";
import { useNavigationRole } from '@/components/navigation/context';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { M2ClientFence, principalScope, type M2ClientPrincipal } from '@/lib/ai-ingestion/m2-client-state';
import { readSelection, rememberSelection, forgetSelection, browserSelectionStorage, type PocSelection } from '@/lib/poc-insights/selection';
import type { PocInsights } from '@/lib/server/poc-insights/service';
import type { PocSource } from '@/lib/server/poc-anomalies/service';
import { OverviewDashboard, OverviewHeader, workspaceDescription } from './dashboard';
import { ProcessingDetails } from './processing-details';
const auth = '/api/ai-ingestion/m2', api = auth + '/insights';
const scopeKey = (p: M2ClientPrincipal) => JSON.stringify([principalScope(p), p.role, p.membershipVersion]);
const params = (q: PocSelection) => new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
export default function LocalOverview() {
 const fence = useRef(new M2ClientFence()), sequence = useRef(0);
 const [principal, setPrincipal] = useState<M2ClientPrincipal | null>(null), [checked, setChecked] = useState(false);
 const [data, setData] = useState<PocInsights | null>(null), [sources, setSources] = useState<PocSource[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false);
 useNavigationRole(principal?.role ?? null);
 const invalidate = useCallback(() => { forgetSelection(browserSelectionStorage, fence.current.principal); fence.current.invalidate(); sequence.current++; setData(null); setSources([]); setPrincipal(null); setLoading(false); }, []);
 const load = useCallback(async (next: PocSelection) => {
  const p = fence.current.principal; if (!p || p.role !== 'Finance') return;
  const epoch = fence.current.epoch, request = ++sequence.current;
  setData(null); setLoading(true); setError('');
  try {
   const response = await fetch(`${api}?${params(next)}`, { cache: 'no-store' }); if (!response.ok) throw Error();
   const value = await response.json() as PocInsights;
   if (epoch !== fence.current.epoch || request !== sequence.current) return;
   if (value.status !== 'OK' || value.version !== 'poc-financial-insights-v1' || value.publicationEligible !== false || scopeKey(value.scope) !== scopeKey(p) || value.source.id !== next.source || (next.business && value.selection.businessId !== next.business) || (next.period && value.selection.period !== next.period) || (next.currency && value.selection.currency !== next.currency)) throw Error();
   const selected = { source: value.source.id, business: value.selection.businessId, period: value.selection.period, currency: value.selection.currency };
   rememberSelection(browserSelectionStorage, p, selected); setData(value); history.replaceState(null, '', `/?${params(selected)}`);
  } catch { if (epoch === fence.current.epoch && request === sequence.current) setError('This source could not be authorized or read. Refresh or choose another source.'); }
  finally { if (epoch === fence.current.epoch && request === sequence.current) setLoading(false); }
 }, []);
 const refresh = useCallback(async () => {
  const p = fence.current.principal; if (!p || p.role !== 'Finance') return;
  const epoch = fence.current.epoch, request = ++sequence.current;
  setData(null); setSources([]); setLoading(true); setError('');
  try {
   const response = await fetch(api + '?action=sources', { cache: 'no-store' }); if (!response.ok) throw Error();
   const list = await response.json() as { scope: M2ClientPrincipal; sources: PocSource[] };
   if (epoch !== fence.current.epoch || request !== sequence.current) return;
   if (scopeKey(list.scope) !== scopeKey(p)) throw Error();
   setSources(list.sources);
   const chosen = readSelection(browserSelectionStorage, p, location.search) ?? (list.sources[0] ? { source: list.sources[0].id } : null);
   if (chosen && !list.sources.some(s => s.id === chosen.source)) throw Error();
   if (chosen) await load(chosen); else setLoading(false);
  } catch { if (epoch === fence.current.epoch && request === sequence.current) { setLoading(false); setError('Uploaded sources are unavailable for this session.'); } }
 }, [load]);
 useEffect(() => {
  let ended = false, checking = false;
  const access = fence.current, pending = sequence;
  const check = async () => {
   if (checking) return; checking = true; const epoch = access.epoch;
   try {
    const response = await fetch(auth + '?action=session', { cache: 'no-store' }); if (!response.ok) throw Error(); const value = await response.json();
    if (ended || epoch !== access.epoch) return;
    if (!value.active) { invalidate(); return; }
    const changed = access.observe(value); setPrincipal(access.principal);
    if (changed) { sequence.current++; setData(null); setSources([]); setError(''); if (access.principal?.role === 'Finance') void refresh(); }
   } catch { if (!ended && epoch === access.epoch) invalidate(); }
   finally { checking = false; if (!ended) setChecked(true); }
  };
  void check(); const timer = setInterval(() => void check(), 1000); window.addEventListener('focus', check);
  return () => { ended = true; access.invalidate(); pending.current++; clearInterval(timer); window.removeEventListener('focus', check); };
 }, [invalidate, refresh]);
 if (!checked || !principal || principal.role !== 'Finance') return <><OverviewHeader /><section className="ov-card ov-unavailable"><h2>{!checked ? 'Checking local access' : !principal ? 'Finance sign-in required' : 'Finance access required'}</h2><p>{!checked ? 'Financial results remain hidden until the session is verified.' : 'Use an active Finance membership to view uploaded financial results.'}</p>{checked && <Link className="ov-button" href="/reconciliation">Open existing Finance sign-in</Link>}</section></>;
 const s = data?.selection;
 const selected = data ? params({ source: data.source.id, business: data.selection.businessId, period: data.selection.period, currency: data.selection.currency }) : '';
 function select(change: Partial<PocSelection>) {
  const source = change.source ?? data?.source.id; if (!source) return;
  void load(change.source ? { source } : { source, business: s?.businessId, period: s?.period, currency: s?.currency, ...change });
 }
 const selectionControls = <section className="ov-card ov-selection" aria-label="Authorized source selection">
 <label>Source file<select disabled={loading || !sources.length} value={data?.source.id ?? ''} onChange={e => select({ source: e.target.value })}><option value="" disabled>Choose uploaded source</option>{sources.map(x => <option key={x.id} value={x.id}>{x.fileName}</option>)}</select></label>
 <label>Business<select disabled={loading || !data} value={s?.businessId ?? ''} onChange={e => select({ business: e.target.value, period: undefined, currency: undefined })}>{data?.options.map(x => <option key={x.businessId} value={x.businessId}>{x.businessName}</option>)}</select></label>
 <label>Month<select disabled={loading || !data} value={s?.period ?? ''} onChange={e => select({ period: e.target.value })}>{data?.periods.map(x => <option key={x}>{x}</option>)}</select></label>
 <label>Currency<select disabled={loading || !data} value={s?.currency ?? ''} onChange={e => select({ currency: e.target.value, period: undefined })}>{data?.options.find(x => x.businessId === s?.businessId)?.currencies.map(x => <option key={x}>{x}</option>)}</select></label><button className="ov-button" disabled={loading} onClick={() => void refresh()}>Refresh</button>
 </section>;
 return <>

 {error && <p role="alert" className="ov-card">{error}</p>}
 {data ? <OverviewDashboard local currency={data.selection.currency} description={workspaceDescription(data.selection.businessName, data.selection.period)} bank={data.totals.net} bankTotals={data.totals} reconciliation={data.reconciliation.status === 'AVAILABLE' && data.reconciliation.snapshot.cashMovement.bank === data.totals.net ? data.reconciliation.snapshot : null} months={data.series} anomalies={data.anomalies.candidates} selection={selected} processing={<>{selectionControls}<ProcessingDetails local business={data.selection.businessName} period={data.selection.period} currency={data.selection.currency} fingerprints={[{ label: 'Bank source', value: data.source.sha256 }, ...(data.reconciliation.status === 'AVAILABLE' && data.reconciliation.snapshot.cashMovement.bank === data.totals.net ? [{ label: 'Ledger source', value: data.reconciliation.snapshot.sources.ledger.sha256 }] : [])]}><p className="ov-provenance">{data.source.fileName} · uploaded {data.source.uploadedAt}</p></ProcessingDetails></>} /> : <><OverviewHeader />{selectionControls}<section className="ov-card ov-unavailable"><h2>{loading ? 'Loading authorized source…' : sources.length ? 'Select an uploaded source' : 'No documents processed yet'}</h2><p>No financial figures are shown until an uploaded source is available.</p><Link className="ov-button" href="/reconciliation">Open Reconciliation</Link><Link className="ov-button" href="/anomalies">Open bank source uploads</Link></section></>}
 </>;
}
