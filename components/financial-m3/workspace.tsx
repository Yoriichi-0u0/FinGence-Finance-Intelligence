'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader, Panel } from '@/components/ui';
import { M2ClientFence, principalScope, type M2ClientPrincipal } from '@/lib/ai-ingestion/m2-client-state';
import { readSelection, saveSelection, validSelection, type FinancialSelection } from '@/lib/financial-m3/selection';
import type { FinancialSnapshot, FinancialFacts } from '@/lib/server/financial-m3/consumers';
import type { createManagementService } from '@/lib/server/financial-m3/management';
import SourceChart from './source-chart';
type Overview = Awaited<ReturnType<ReturnType<typeof createManagementService>['overview']>>;
type Member = {
    userId: string;
    email: string;
    role: 'Finance' | 'Technical (Management)' | 'Admin';
    active: boolean;
    version: number;
};
const auth = '/api/ai-ingestion/m2', api = auth + '/consumers';
const scopeKey = (p: M2ClientPrincipal) => JSON.stringify([principalScope(p), p.role, p.membershipVersion]);
const titles = { transactions: 'Transactions', analytics: 'Financial analytics', reports: 'Financial reports' };
export default function FinancialWorkspace({ view }: {
    view: keyof typeof titles;
}) {
    const fence = useRef(new M2ClientFence()), request = useRef(0), authenticating = useRef(false), initialHint = useRef(true);
    const [principal, setPrincipal] = useState<M2ClientPrincipal | null>(null), [jobs, setJobs] = useState<{
        id: string;
        state: string;
    }[]>([]), [selected, setSelected] = useState<FinancialSelection | null>(null), [snapshot, setSnapshot] = useState<FinancialSnapshot | null>(null), [overview, setOverview] = useState<Overview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [question, setQuestion] = useState(''), [answer, setAnswer] = useState('');
    const clear = useCallback(() => { request.current++; setJobs([]); setSelected(null); setSnapshot(null); setOverview(null); setAnswer(''); setQuestion(''); setBusy(false); }, []);
    const invalidate = useCallback(() => { fence.current.invalidate(); clear(); setPrincipal(null); }, [clear]);
    const load = useCallback(async (selection: FinancialSelection) => {
        const p = fence.current.principal;
        if (!p || p.role !== 'Finance')
            return;
        const epoch = fence.current.epoch, sequence = ++request.current;
        setSelected(selection);
        setSnapshot(null);
        setAnswer('');
        setError('');
        setBusy(true);
        try {
            const response = await fetch(`${api}?batch=${selection.attemptId}&warnings=${selection.warningPolicy}`, { cache: 'no-store' });
            if (!response.ok)
                throw new Error('No authorized completed batch is available.');
            const data = await response.json() as FinancialSnapshot;
            if (epoch !== fence.current.epoch || sequence !== request.current)
                return;
            if (scopeKey(data.scope) !== scopeKey(p) || data.selection.attemptId !== selection.attemptId || data.selection.warningPolicy !== selection.warningPolicy)
                throw new Error('Account or selection changed. Refresh your session.');
            saveSelection(sessionStorage, p, selection);
            setSnapshot(data);
        }
        catch (e) {
            if (epoch === fence.current.epoch && sequence === request.current) {
                setSnapshot(null);
                setError(e instanceof Error ? e.message : 'Unable to retrieve results.');
            }
        }
        finally {
            if (epoch === fence.current.epoch && sequence === request.current)
                setBusy(false);
        }
    }, []);
    const refresh = useCallback(async () => {
        const p = fence.current.principal;
        if (!p)
            return;
        const epoch = fence.current.epoch;
        try {
            if (p.role === 'Finance') {
                const response = await fetch(api, { cache: 'no-store' });
                if (!response.ok)
                    throw new Error();
                const data = await response.json();
                if (epoch === fence.current.epoch)
                    setJobs(data.jobs.filter((j: {
                        state: string;
                    }) => j.state === 'COMPLETED'));
            }
            else {
                const response = await fetch(api + '?action=management', { cache: 'no-store' });
                if (!response.ok)
                    throw new Error();
                const data = await response.json() as Overview;
                if (epoch !== fence.current.epoch)
                    return;
                if (scopeKey(data.scope) !== scopeKey(p))
                    throw new Error();
                setOverview(data);
            }
        }
        catch {
            if (epoch === fence.current.epoch) {
                invalidate();
                setError('Access or its durable audit could not be confirmed. Sign in again or refresh.');
            }
        }
    }, [invalidate]);
    const adopt = useCallback((data: unknown) => {
        const changed = fence.current.observe(data), p = fence.current.principal!;
        setPrincipal(p);
        if (changed) {
            clear();
            setError('');
            setBusy(false);
            void refresh();
            if (p.role === 'Finance') {
                let selection: FinancialSelection | null = null;
                if (initialHint.current) {
                    initialHint.current = false;
                    const q = new URLSearchParams(location.search), hint = { attemptId: q.get('batch'), warningPolicy: q.get('warnings') ?? 'exclude' };
                    if (validSelection(hint))
                        selection = hint;
                }
                selection ??= readSelection(sessionStorage, p);
                if (selection)
                    void load(selection);
            }
        }
    }, [clear, refresh, load]);
    useEffect(() => {
        let ended = false;
        const check = async () => { if (authenticating.current)
            return; const epoch = fence.current.epoch; try {
            const r = await fetch(auth + '?action=session', { cache: 'no-store' });
            if (!r.ok)
                throw new Error();
            const data = await r.json();
            if (ended || epoch !== fence.current.epoch)
                return;
            if (data.active)
                adopt(data);
            else
                invalidate();
        }
        catch {
            if (!ended && epoch === fence.current.epoch)
                invalidate();
        } };
        void check();
        const timer = setInterval(() => { void check(); }, 1000);
        window.addEventListener('focus', check);
        return () => { ended = true; clearInterval(timer); window.removeEventListener('focus', check); };
    }, [adopt, invalidate]);
    async function signIn() { authenticating.current = true; invalidate(); const epoch = fence.current.epoch; setBusy(true); setError(''); try {
        const r = await fetch(auth + '?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        if (r.status === 429) {
            setError('Please wait before signing in again.');
            return;
        }
        if (!r.ok)
            throw new Error();
        const data = await r.json();
        if (epoch !== fence.current.epoch)
            return;
        setPassword('');
        adopt(data);
    }
    catch {
        setError('Local sign-in unavailable. Check the account and active membership.');
    }
    finally {
        authenticating.current = false;
        setBusy(false);
    } }
    async function signOut() { invalidate(); await fetch(auth + '?action=logout', { method: 'POST' }).catch(() => { setError('Display cleared; server sign-out was not confirmed.'); }); }
    async function download() {
        if (!selected || !snapshot)
            return;
        const epoch = fence.current.epoch, sequence = request.current;
        try {
            const r = await fetch(`${api}?action=export&batch=${selected.attemptId}&warnings=${selected.warningPolicy}`, { cache: 'no-store' });
            if (!r.ok)
                throw new Error();
            const facts = await r.json() as FinancialFacts;
            if (epoch !== fence.current.epoch || sequence !== request.current)
                return;
            if (facts.selection.hash !== snapshot.selection.hash)
                throw new Error();
            const url = URL.createObjectURL(new Blob([JSON.stringify(facts, null, 2)], { type: 'application/json' })), link = document.createElement('a');
            link.href = url;
            link.download = 'fingence-v2-financial-report.json';
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
        catch {
            if (epoch === fence.current.epoch) {
                setSnapshot(null);
                setAnswer('');
                setError('Export was not authorized or its source changed. Refresh before downloading.');
            }
        }
    }
    async function ask() {
        if (!selected || !snapshot)
            return;
        const epoch = fence.current.epoch, sequence = request.current;
        setAnswer('');
        try {
            const r = await fetch(`${api}?action=question&batch=${selected.attemptId}&warnings=${selected.warningPolicy}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) });
            if (!r.ok)
                throw new Error();
            const data = await r.json();
            if (epoch !== fence.current.epoch || sequence !== request.current)
                return;
            if (data.selectionHash !== snapshot.selection.hash)
                throw new Error();
            setAnswer(data.status === 'DETERMINISTIC_RECORD_COUNT' ? `${data.count} selected verified records; ${data.recordIds.length} cited source records.` : data.status === 'DETERMINISTIC_SOURCE_CLAIMS' ? data.claims.map((c: {
                value: string;
                currency: string;
                recordIds: string[];
            }) => `${c.value} ${c.currency} — ${c.recordIds.length} cited records. Source-signed amount sum.`).join('\n') : data.reason);
        }
        catch {
            if (epoch === fence.current.epoch) {
                setSnapshot(null);
                setError('Answer could not be authorized and verified. Refresh the selection.');
            }
        }
    }
    async function manage(action: 'membership' | 'revoke', body: Record<string, unknown>) { const epoch = fence.current.epoch; try {
        const r = await fetch(api + '?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok)
            throw new Error();
        if (epoch === fence.current.epoch) {
            setError('Membership updated; affected sessions were revoked.');
            await refresh();
        }
    }
    catch {
        if (epoch === fence.current.epoch)
            setError('Change not applied. Refresh membership versions; the last active Admin is protected.');
    } }
    const records = snapshot?.records ?? [];
    return <div className="min-w-0 space-y-5"><PageHeader title={titles[view]} description="One authorized V2 dataset, consistent across financial views and reports"/>
 <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"><strong>Local experimental V2 · SIMULATED interpretation.</strong> Real extraction, independent verification and persisted records. Financial publication and live models are disabled.</div>
 <nav aria-label="Connected financial views" className="flex flex-wrap gap-2 text-sm">{(['transactions', 'analytics', 'reports'] as const).map(v => <Link className={`rounded-lg border px-4 py-2 ${view === v ? 'bg-teal-800 text-white' : 'bg-white'}`} href={'/' + v} key={v}>{titles[v]}</Link>)}<Link className="rounded-lg border px-4 py-2" href="/ai-ingestion">Upload documents</Link></nav>
 {!principal ? <Panel title="Sign in to your local organization"><div className="space-y-3 p-5"><label className="block text-sm">Email<input className="mt-1 block w-full rounded border p-2" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)}/></label><label className="block text-sm">Password<input className="mt-1 block w-full rounded border p-2" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}/></label><button className="min-h-11 rounded bg-teal-800 px-4 text-white" onClick={signIn} disabled={busy || !email || !password}>Sign in</button><p className="text-sm text-slate-600">OS-local accounts only. Hosted authentication is not activated.</p></div></Panel> : <>
 <div className="flex flex-wrap items-center gap-3 text-sm"><span>Active role: {principal.role}</span><button className="min-h-11 underline" onClick={signOut}>Sign out</button><button className="min-h-11 underline" onClick={() => { void refresh(); if (selected && principal.role === 'Finance')
            void load(selected); }}>Refresh authorized data</button></div>
 {principal.role !== 'Finance' ? <Panel title="Organization management and technical visibility"><div className="space-y-4 p-5"><p className="text-sm">Financial tables, calculations and exports are unavailable to this role.</p><h3 className="font-semibold">Scoped processing status</h3><ul className="text-sm">{overview?.jobs.map(j => <li key={j.state}>{j.state}: {j.count} jobs</li>)}</ul>{principal.role === 'Admin' && <><h3 className="font-semibold">Memberships</h3><p className="text-sm text-slate-600">New identities are enrolled inactive through the OS-local CLI. Activation, role changes and revocation below are organization-scoped and audited.</p>{overview?.members?.map(row => <MemberEditor key={`${row.userId}:${row.version}`} member={row as Member} onSave={manage}/>)}</>}<p className="text-sm text-slate-600">Organization creation and lifecycle changes require the OS-local owner tool. No hosted infrastructure administration is enabled.</p></div></Panel> : <>
 <Panel title="Selected verified dataset"><div className="space-y-3 p-5"><label className="block text-sm">Persisted batch<select className="mt-1 block w-full min-w-0 rounded border p-2" aria-label="Selected persisted batch" value={selected?.attemptId ?? ''} onChange={e => { if (e.target.value)
                void load({ attemptId: e.target.value, warningPolicy: selected?.warningPolicy ?? 'exclude' });
            else {
                request.current++;
                setSelected(null);
                setSnapshot(null);
                setAnswer('');
            } }}><option value="">Select a persisted batch</option>{jobs.map(j => <option value={j.id} key={j.id}>Verified processing · {j.id.slice(0, 8)}</option>)}</select></label><label className="block text-sm">Warning policy<select className="ml-2 rounded border p-2" aria-label="Warning inclusion" value={selected?.warningPolicy ?? 'exclude'} disabled={!selected} onChange={e => { if (selected)
                void load({ ...selected, warningPolicy: e.target.value as 'include' | 'exclude' }); }}><option value="exclude">Exclude warnings</option><option value="include">Include warnings</option></select></label>{busy && <p role="status">Loading authorized persisted results…</p>}{snapshot && <><p className="break-all text-sm">Source: {snapshot.source.filename} · {snapshot.source.format}</p><p className="break-all font-mono text-xs text-slate-600">Selection proof: {snapshot.selection.hash}</p><p className="text-sm">{snapshot.counts.selected} selected · {snapshot.counts.accepted} verified · {snapshot.counts.rejected} rejected · {snapshot.counts.unresolved} unresolved · {snapshot.counts.excludedWarnings} warnings excluded</p><p className="text-sm">{snapshot.counts.sourceRows === null ? 'Source row count is not established.' : `${snapshot.counts.sourceRows} observed source rows.`} Quarantine is excluded from calculations.</p></>}</div></Panel>
 {!snapshot ? <Panel title="No financial dataset displayed"><p className="p-5 text-sm">Upload a registered synthetic document or select an authorized completed batch. Missing, uncertain and denied results never become zero-valued financial dashboards.</p></Panel> : <>
 <div className="grid min-w-0 gap-4 md:grid-cols-2">{snapshot.analytics.map((g, i) => <Panel title={`${g.currency ?? 'Currency unavailable'} · source amount summary`} key={i}><div className="space-y-2 p-5"><p className="break-all text-2xl font-semibold">{g.status === 'AVAILABLE' ? `${g.sourceSignedTotal} ${g.currency}` : 'Calculation unavailable'}</p><p className="text-sm">{g.recordCount} selected source records · {g.monetaryBasis ?? 'basis not established'}</p><p className="text-sm text-slate-600">Source-signed amount sum, never revenue, expense, profit or cash flow.</p>{g.signCounts && <p className="text-sm">Positive source signs: {g.signCounts.positive}; negative: {g.signCounts.negative}; zero: {g.signCounts.zero}.</p>}</div></Panel>)}</div>
 {view === 'transactions' && <Panel title="Independently verified transactions"><TransactionTable records={records}/></Panel>}
 {view === 'analytics' && <>{snapshot.analytics.map((g, i) => <Panel title={`Observed transaction-date series · ${g.currency ?? 'unavailable currency'}`} key={i}><div className="space-y-4 p-5"><SourceChart points={g.days} currency={g.currency ?? ''}/>{g.minimum !== null && <p className="break-all text-sm">Minimum source amount: {g.minimum}; maximum: {g.maximum} {g.currency}.</p>}<h3 className="font-semibold">Monthly source totals</h3>{g.months.map(p => <p className="break-all text-sm" key={p.period}>{p.period}: {p.total === null ? 'Amount unavailable' : `${p.total} ${g.currency}`} · {p.recordCount} records</p>)}</div></Panel>)}<CapabilityStates snapshot={snapshot}/></>}
 {view === 'reports' && <Panel title="Source-backed financial report"><div className="space-y-4 p-5"><p className="text-sm">This report contains this exact selected record subset, conventions, warning policy, evidence coordinates, date groups and source citations. No illustrative figures are included.</p><button className="min-h-11 rounded bg-teal-800 px-4 text-white" onClick={download}>Download financial JSON report</button><TransactionTable records={records}/><CapabilityStates snapshot={snapshot}/></div></Panel>}
 <Panel title="Grounded financial questions"><div className="space-y-3 p-5"><p className="text-sm">Deterministic source tools; genuine model responses are unavailable.</p><label className="block text-sm">Question<input className="mt-1 block w-full rounded border p-2" placeholder="What is the source-signed total?" value={question} onChange={e => { setQuestion(e.target.value); setAnswer(''); }}/></label><button className="min-h-11 rounded border px-4" disabled={!question} onClick={ask}>Ask verified source tool</button>{answer && <p role="status" className="whitespace-pre-wrap break-words text-sm">{answer}</p>}<p className="text-xs text-slate-600">Supported: source-signed totals and selected-record count. Answers use the same selection proof and citations as the table and report.</p></div></Panel>
 </>}
 </>}
 </>}{error && <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm" role="status">{error}</p>}</div>;
}
function TransactionTable({ records }: {
    records: FinancialSnapshot['records'];
}) { return <div className="min-w-0 overflow-x-auto p-4"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Source ID</th><th>Date</th><th>Amount / currency</th><th>Status and evidence</th></tr></thead><tbody>{records.map(r => <tr key={r.id} className="border-t"><td className="p-2">{r.financial.source_transaction_id ?? 'Not supplied'}</td><td className="whitespace-nowrap pr-2">{r.financial.transaction_date ?? 'Unavailable'}</td><td>{r.financial.source_amount ?? `Debit ${r.financial.debit ?? '—'} / Credit ${r.financial.credit ?? '—'}`} {r.financial.currency ?? ''}</td><td>{r.status}<details><summary>Source references</summary><p className="max-w-xs break-all text-xs">{r.id}</p>{r.evidence.map(e => e && <p className="max-w-xs break-all text-xs" key={e.id}>{e.text} · {e.address ?? ''} {e.sheet ?? ''} {e.page !== null ? `page ${e.page}` : ''} {e.box ? JSON.stringify(e.box) : ''}</p>)}</details></td></tr>)}</tbody></table>{!records.length && <p className="p-3">No included verified records. Rejected and unresolved outcomes remain quarantined.</p>}</div>; }
function CapabilityStates({ snapshot }: {
    snapshot: FinancialFacts;
}) { return <div className="grid gap-3 py-3 text-sm sm:grid-cols-2"><div className="rounded border p-3"><strong>Reconciliation unavailable</strong><p>{snapshot.capabilities.reconciliation.reason}</p></div><div className="rounded border p-3"><strong>Forecast unavailable</strong><p>{snapshot.capabilities.forecasting.reason}</p><p>{snapshot.capabilities.forecasting.observedPeriods} observed monthly periods.</p></div></div>; }
function MemberEditor({ member, onSave }: {
    member: Member;
    onSave: (action: 'membership' | 'revoke', body: Record<string, unknown>) => Promise<void>;
}) { const [role, setRole] = useState(member.role), [active, setActive] = useState(member.active); return <div className="space-y-2 rounded border p-3 text-sm"><p className="break-all">{member.email} · membership version {member.version}</p><div className="flex flex-wrap items-center gap-2"><select aria-label={`Role for ${member.email}`} className="max-w-full rounded border p-2" value={role} onChange={e => setRole(e.target.value as Member['role'])}>{(['Finance', 'Technical (Management)', 'Admin'] as const).map(r => <option key={r}>{r}</option>)}</select><label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}/>Active</label><button className="min-h-11 rounded border px-3" onClick={() => onSave('membership', { userId: member.userId, role, active, expectedVersion: member.version })}>Save membership</button><button className="min-h-11 rounded border px-3" onClick={() => onSave('revoke', { userId: member.userId })}>Revoke sessions</button></div></div>; }
