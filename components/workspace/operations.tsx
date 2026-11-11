'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CirclePause, CirclePlay, LoaderCircle, Power, PowerOff, RefreshCw } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui';
import { button, primaryButton, Table } from '@/components/demo/shared';
import { canManage, ROLE_LABEL, useWorkspace, type WorkspaceRole } from './context';

type Session = { memberId: string; email: string; role: WorkspaceRole; openedAt: string; lastSeenAt: string; expiresAt: string; current: boolean };
type AuditEntry = { at: string; action: string; actor: string | null; targetId: string | null; detail: Record<string, unknown> };
type Overview = { organization: string; role: WorkspaceRole; self: string; processing: { paused: boolean; reason: string | null; since: string | null; by: string | null };
    ai: { enabled: boolean; since: string | null; by: string | null }; sessions: Session[]; audit: AuditEntry[] | null };

const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }) : '—';
const ACTION: Record<string, string> = {
    'session.opened': 'signed in', 'session.signed_out': 'signed out', 'session.ended': 'ended sessions of a member', 'processing.paused': 'paused processing',
    'processing.resumed': 'resumed processing', 'ai.enabled': 'turned the AI on', 'ai.disabled': 'turned the AI off', 'invitation.issued': 'issued an invitation', 'invitation.revoked': 'withdrew an invitation', 'member.joined': 'joined', 'member.updated': 'changed a member',
};

async function post(path: string, body: unknown) {
    try {
        const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { ok: res.ok, code: (await res.json().catch(() => null) as { code?: string } | null)?.code };
    } catch { return { ok: false, code: 'WORKSPACE_UNAVAILABLE' }; }
}

/** Admin and Superadmin: the controls (pause, the AI switch), who is signed in and, for a Superadmin, the audit trail. Runs are on the Technical log. */
export function OperationsConsole() {
    const workspace = useWorkspace();
    const [data, setData] = useState<Overview | null>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
    const [reason, setReason] = useState(''), [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        const res = await fetch('/api/workspace/operations', { cache: 'no-store' }).catch(() => null);
        const body = await res?.json().catch(() => null) as Overview & { code?: string } | null;
        if (!res?.ok || !body) { setError(body?.code === 'FORBIDDEN' ? 'Operations is for Admins and Superadmins.' : body?.code === 'SIGN_IN_REQUIRED' ? 'Please sign in.' : `Operations could not be loaded (${body?.code ?? res?.status ?? 'unreachable'}).`); return; }
        setData(body); setError(null);
    }, []);
    useEffect(() => {
        if (workspace.loading) return;
        queueMicrotask(() => void load());
        const timer = setInterval(() => void load(), 30_000);
        return () => clearInterval(timer);
    }, [workspace.loading, load]);
    async function act(body: Record<string, unknown>, done: string, path = '/api/workspace/operations') {
        setBusy(true); setNotice(null);
        const result = await post(path, body);
        setBusy(false); setNotice(result.ok ? done : `Not done: ${result.code ?? 'error'}.`);
        if (result.ok) setReason('');
        await Promise.all([load(), workspace.refresh()]);
    }

    if (error) return <><PageHeader title="Operations" description="Backend processing, sessions and controls." /><Panel><p className="p-4 text-sm sm:p-5">{error}</p></Panel></>;
    if (!data) return <><PageHeader title="Operations" description="Backend processing, sessions and controls." /><p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle aria-hidden="true" className="animate-spin" size={16} />Loading…</p></>;
    // The AI switch and audit trail follow the role being viewed ("Switch view"); the server still checks the real role.
    const viewRole = workspace.viewRole ?? data.role, superadmin = viewRole === 'SUPERADMIN', p = data.processing, ai = data.ai;
    return <>
        <PageHeader title="Operations" description={`The controls for ${data.organization}: pause processing, switch the AI, see who is signed in. Processing runs on its own; step in only when something is wrong.`}
            actions={<button type="button" className={button} onClick={() => void load()}><RefreshCw aria-hidden="true" size={16} />Refresh</button>} />
        {notice ? <p role="status" className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] p-3 text-sm">{notice}</p> : null}
        <div className="grid gap-5">
            <Panel title="Processing" eyebrow={p.paused ? 'Paused' : 'Running'}>
                <div className="space-y-3 p-4 text-sm sm:p-5">
                    {p.paused
                        ? <p><strong className="text-[var(--bad-ink)]">Paused</strong> since {when(p.since)}{p.by ? ` by ${p.by}` : ''}. Reason shown to everyone: “{p.reason}”. Processing, the AI and run recording refuse new requests until it is resumed.</p>
                        : <p><strong className="text-[var(--good-ink)]">Running.</strong> Documents are processed and recorded automatically, with no approval step.</p>}
                    {p.paused
                        ? <button type="button" className={primaryButton} disabled={busy} onClick={() => void act({ action: 'resume' }, 'Processing resumed.')}><CirclePlay aria-hidden="true" size={16} />Resume processing</button>
                        : <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void act({ action: 'pause', reason }, 'Processing paused.'); }}>
                            <label className="text-sm font-medium">Reason (everyone will see it)<input className="mt-1 block min-h-11 w-96 max-w-full rounded-lg border border-[var(--border-strong)] px-3 text-sm" required maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Investigating wrong figures in scanned statements" /></label>
                            <button type="submit" className={button} disabled={busy || !reason.trim()}><CirclePause aria-hidden="true" size={16} />Pause processing</button>
                        </form>}
                </div>
            </Panel>

            <Panel title="AI" eyebrow={ai.enabled ? 'On' : 'Off'}>
                <div className="space-y-3 p-4 text-sm sm:p-5">
                    {ai.enabled
                        ? <p><strong className="text-[var(--good-ink)]">On.</strong> The language model may read a document&apos;s layout and answer questions; every figure it touches is still checked by code.</p>
                        : <p><strong className="text-[var(--bad-ink)]">Off</strong>{ai.since ? ` since ${when(ai.since)}` : ''}{ai.by ? ` by ${ai.by}` : ''}. Nothing is sent to the language model: documents FinGence already knows are processed by its rules, unfamiliar ones are set aside, and Finance Q&amp;A is unavailable.</p>}
                    {superadmin
                        ? <button type="button" className={ai.enabled ? button : primaryButton} disabled={busy} onClick={() => void act({ action: 'ai', enabled: !ai.enabled }, ai.enabled ? 'The AI is off.' : 'The AI is on.')}>{ai.enabled ? <PowerOff aria-hidden="true" size={16} /> : <Power aria-hidden="true" size={16} />}{ai.enabled ? 'Turn the AI off' : 'Turn the AI on'}</button>
                        : <p className="text-[var(--muted)]">Only a Superadmin can turn the AI on or off.</p>}
                </div>
            </Panel>

            <Panel title="Runs and AI calls" eyebrow="Moved">
                <p className="p-4 text-sm sm:p-5">Every run, document and AI call, with each check, model, key, tokens and cost, is on the <Link href="/log" className="font-semibold text-[var(--brand-ink)] underline decoration-[var(--brand-line)] underline-offset-2">Technical log</Link>.</p>
            </Panel>

            <Panel title="Signed in now" eyebrow={`${data.sessions.length} open sessions`}>
                <Table caption="Open sessions" columns={['Email', 'Role', 'Signed in', 'Last active', 'Expires', '']} rows={data.sessions.map(s => [<span key="e">{s.email}{s.current ? <span className="ml-1 text-xs text-[var(--muted)]">(this session)</span> : null}</span>, ROLE_LABEL[s.role], when(s.openedAt), when(s.lastSeenAt), when(s.expiresAt),
                    !canManage(viewRole, s.role) ? '' : <button key="x" type="button" className={`${button} min-h-9 px-3 py-1 text-xs`} disabled={busy}
                        onClick={() => void act({ action: 'end-sessions', memberId: s.memberId }, `${s.email} has been signed out; their processing stops at once.`)}>End session</button>])} />
            </Panel>

            {superadmin && data.audit ? <Panel title="Audit trail" eyebrow="Last 200 events · Superadmin only">
                <Table caption="Audit trail" columns={['When', 'Who', 'What', 'Detail']} rows={data.audit.map(a => [when(a.at), a.actor ?? 'owner', ACTION[a.action] ?? a.action,
                    <span key="d" className="text-xs text-[var(--muted)]">{Object.keys(a.detail ?? {}).length ? JSON.stringify(a.detail) : ''}</span>])} />
            </Panel> : null}
        </div>
    </>;
}
