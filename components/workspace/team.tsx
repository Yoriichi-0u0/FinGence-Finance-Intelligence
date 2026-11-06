'use client';
import { useCallback, useEffect, useState } from 'react';
import { Copy, LoaderCircle, UserPlus } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui';
import { button, primaryButton, Table } from '@/components/demo/shared';
import { ROLE_LABEL, useWorkspace, type WorkspaceRole } from './context';

type Member = { id: string; email: string; role: WorkspaceRole; active: boolean; version: number; joinedAt: string; openSessions: number };
type Invitation = { id: string; email: string; role: WorkspaceRole; createdAt: string; expiresAt: string };
type Team = { organization: string; self: string; members: Member[]; invitations: Invitation[] };
const ROLES: WorkspaceRole[] = ['FINANCE', 'MANAGEMENT', 'ADMIN'];
const REFUSAL: Record<string, string> = {
    LAST_ADMIN: 'The organization needs at least one active Admin, so this change was not made.',
    STALE: 'Someone changed this member a moment ago. The list has been refreshed; try again.',
    ALREADY_MEMBER: 'That email already has an account.',
    FORBIDDEN: 'Only an Admin can do this.',
};
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
const select = 'min-h-9 rounded-lg border border-[var(--border-strong)] bg-white px-2 text-sm';

async function call(body: unknown) {
    try {
        const res = await fetch('/api/workspace/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { ok: res.ok, body: await res.json().catch(() => null) as Record<string, unknown> | null };
    } catch { return { ok: false, body: null }; }
}

/** Admin: who can sign in, with which role. An invitation is the only approval a new member needs. */
export function TeamConsole() {
    const workspace = useWorkspace();
    const [team, setTeam] = useState<Team | null>(null), [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
    const [draft, setDraft] = useState<Record<string, { role: WorkspaceRole; active: boolean }>>({});
    const [invite, setInvite] = useState<{ email: string; role: WorkspaceRole }>({ email: '', role: 'FINANCE' });
    const [issued, setIssued] = useState<{ email: string; code: string; expiresAt: string } | null>(null);
    const [busy, setBusy] = useState(false);
    const load = useCallback(async () => {
        const res = await fetch('/api/workspace/team', { cache: 'no-store' }).catch(() => null);
        const body = await res?.json().catch(() => null) as Team & { code?: string } | null;
        if (!res?.ok || !body) { setError(body?.code === 'FORBIDDEN' ? 'Team is for Admins.' : body?.code === 'SIGN_IN_REQUIRED' ? 'Please sign in as an Admin.' : 'The team could not be loaded.'); return; }
        setTeam(body); setDraft({}); setError(null);
    }, []);
    useEffect(() => { if (!workspace.loading) queueMicrotask(() => void load()); }, [workspace.loading, load]);

    async function act(body: Record<string, unknown>, done: string) {
        setBusy(true); setNotice(null);
        const result = await call(body);
        setBusy(false);
        setNotice(result.ok ? done : REFUSAL[String(result.body?.code)] ?? 'The change could not be made. Try again.');
        await load();
        return result;
    }
    async function sendInvite(event: React.FormEvent) {
        event.preventDefault(); setIssued(null);
        const result = await act({ action: 'invite', ...invite }, `Invitation created for ${invite.email}.`);
        if (result.ok && typeof result.body?.code === 'string') { setIssued({ email: invite.email, code: result.body.code, expiresAt: String(result.body.expiresAt) }); setInvite({ email: '', role: invite.role }); }
    }

    if (error) return <><PageHeader title="Team" description="Members, roles and invitations." /><Panel><p className="p-4 text-sm sm:p-5">{error}</p></Panel></>;
    if (!team) return <><PageHeader title="Team" description="Members, roles and invitations." /><p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle aria-hidden="true" className="animate-spin" size={16} />Loading the team…</p></>;
    return <>
        <PageHeader title="Team" description={`Who can sign in to ${team.organization}, and with which role. Finance processes documents; Management (Technical) watches the processing and can pause it; Admin manages this list.`} />
        {notice ? <p role="status" className="mb-4 rounded-lg border border-[var(--border)] bg-white p-3 text-sm">{notice}</p> : null}
        <div className="grid gap-5">
            <Panel title="Members">
                <Table caption="Members" columns={['Email', 'Role', 'Access', 'Signed in', 'Joined', '']} rows={team.members.map(m => {
                    const d = draft[m.id] ?? { role: m.role, active: m.active }, changed = d.role !== m.role || d.active !== m.active;
                    return [
                        <span key="e">{m.email}{m.id === team.self ? <span className="ml-1 text-xs text-[var(--muted)]">(you)</span> : null}</span>,
                        <select key="r" aria-label={`Role of ${m.email}`} className={select} value={d.role} onChange={e => setDraft({ ...draft, [m.id]: { ...d, role: e.target.value as WorkspaceRole } })}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>,
                        <label key="a" className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={d.active} onChange={e => setDraft({ ...draft, [m.id]: { ...d, active: e.target.checked } })} />{d.active ? 'On' : 'Off'}</label>,
                        m.openSessions ? `${m.openSessions} session${m.openSessions > 1 ? 's' : ''}` : '—',
                        when(m.joinedAt),
                        <span key="x" className="flex flex-wrap gap-2">
                            <button type="button" className={`${primaryButton} min-h-9 px-3 py-1 text-xs`} disabled={busy || !changed} onClick={() => void act({ action: 'update-member', memberId: m.id, role: d.role, active: d.active, version: m.version }, `${m.email} updated; any open sessions were ended.`)}>Save</button>
                            <button type="button" className={`${button} min-h-9 px-3 py-1 text-xs`} disabled={busy || !m.openSessions} onClick={() => void act({ action: 'end-sessions', memberId: m.id }, `${m.email} has been signed out.`)}>Sign out</button>
                        </span>,
                    ];
                })} />
                <p className="px-4 pb-4 text-xs text-[var(--muted)] sm:px-5">Changing a role or turning access off signs that person out at once.</p>
            </Panel>
            <Panel title="Invite someone">
                <form className="flex flex-wrap items-end gap-3 p-4 sm:p-5" onSubmit={e => void sendInvite(e)}>
                    <label className="text-sm font-medium">Email<input className="mt-1 block min-h-11 w-72 max-w-full rounded-lg border border-[var(--border-strong)] px-3 text-sm" type="email" required value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} /></label>
                    <label className="text-sm font-medium">Role<select className={`${select} mt-1 block min-h-11`} value={invite.role} onChange={e => setInvite({ ...invite, role: e.target.value as WorkspaceRole })}>{ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
                    <button type="submit" className={primaryButton} disabled={busy}><UserPlus aria-hidden="true" size={16} />Create invitation</button>
                </form>
                {issued ? <div role="status" className="mx-4 mb-4 rounded-lg border border-teal-200 bg-[var(--teal-soft)] p-4 text-sm sm:mx-5">
                    <p>Send this one-time code to <strong>{issued.email}</strong> privately. They open <strong>{typeof window === 'undefined' ? '' : window.location.origin}/join</strong>, enter it and choose a password. It works once, until {when(issued.expiresAt)}. It is shown only now.</p>
                    <p className="mt-2 flex flex-wrap items-center gap-2"><code className="break-all rounded bg-white px-2 py-1 font-mono text-xs">{issued.code}</code><button type="button" className={`${button} min-h-9 px-3 py-1 text-xs`} onClick={() => void navigator.clipboard?.writeText(issued.code)}><Copy aria-hidden="true" size={14} />Copy</button></p>
                </div> : null}
                {team.invitations.length ? <Table caption="Pending invitations" columns={['Email', 'Role', 'Created', 'Expires', '']} rows={team.invitations.map(i => [i.email, ROLE_LABEL[i.role], when(i.createdAt), when(i.expiresAt),
                    <button key="v" type="button" className={`${button} min-h-9 px-3 py-1 text-xs`} disabled={busy} onClick={() => void act({ action: 'revoke-invitation', invitationId: i.id }, `Invitation for ${i.email} withdrawn.`)}>Withdraw</button>])} /> : null}
            </Panel>
        </div>
    </>;
}
