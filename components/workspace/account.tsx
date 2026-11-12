'use client';
import { useState } from 'react';
import { CheckCircle2, KeyRound, LoaderCircle } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui';
import { primaryButton } from '@/components/demo/shared';
import { plainMessage, ROLE_LABEL, useWorkspace } from './context';

const field = 'mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus-visible:border-[var(--brand)]';

/**
 * Your account: who you are signed in as, and changing your own password. A password the team handed out can be replaced
 * here; every other sign-in of yours then ends, and this one stays open.
 */
export function AccountPage() {
    const { session } = useWorkspace();
    const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [again, setAgain] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [done, setDone] = useState<string | null>(null);

    async function submit(event: React.FormEvent) {
        event.preventDefault(); setError(null); setDone(null);
        if (next !== again) { setError('The two new passwords are different.'); return; }
        if ([...next].length < 12 || [...next].length > 128) { setError(plainMessage('PASSWORD_RULE')); return; }
        if (next === current) { setError(plainMessage('PASSWORD_UNCHANGED')); return; }
        setBusy(true);
        try {
            const res = await fetch('/api/workspace/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, next }) });
            const body = await res.json().catch(() => null) as { code?: string; otherSessionsEnded?: number } | null;
            if (!res.ok) { setError(plainMessage(body?.code)); if (body?.code === 'WRONG_PASSWORD') setCurrent(''); return; }
            setCurrent(''); setNext(''); setAgain('');
            const ended = body?.otherSessionsEnded ?? 0;
            setDone(`Password changed. You stay signed in here${ended ? `, and ${ended} other sign-in${ended === 1 ? ' was' : 's were'} ended` : ''}. Use the new password next time.`);
        } catch { setError(plainMessage('WORKSPACE_UNAVAILABLE')); }
        finally { setBusy(false); }
    }

    return <>
        <PageHeader eyebrow="Workspace" title="Your account" description="Who you are signed in as, and your password." />
        <div className="grid max-w-2xl gap-5">
            {session ? <Panel>
                <dl className="grid gap-3 p-4 text-sm sm:grid-cols-3 sm:p-5">
                    <div className="min-w-0"><dt className="text-xs text-[var(--muted)]">Email</dt><dd className="mt-0.5 truncate font-semibold">{session.email}</dd></div>
                    <div><dt className="text-xs text-[var(--muted)]">Role</dt><dd className="mt-0.5 font-semibold">{ROLE_LABEL[session.role]}</dd></div>
                    <div className="min-w-0"><dt className="text-xs text-[var(--muted)]">Organization</dt><dd className="mt-0.5 truncate font-semibold">{session.organization.name}</dd></div>
                </dl>
            </Panel> : null}
            <Panel>
                <form className="space-y-4 p-4 sm:p-5" onSubmit={e => void submit(e)}>
                    <div>
                        <h2 className="text-base font-semibold">Change password</h2>
                        <p className="mt-1 text-sm text-[var(--muted-strong)]">If someone gave you your password, replace it with one only you know. Any other sign-ins of yours end; this one stays open.</p>
                    </div>
                    <label className="block text-sm font-medium">Current password<input id="current-password" className={field} type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)} /></label>
                    <label className="block text-sm font-medium">New password <span className="font-normal text-[var(--muted)]">(12 to 128 characters)</span><input id="new-password" className={field} type="password" autoComplete="new-password" required value={next} onChange={e => setNext(e.target.value)} /></label>
                    <label className="block text-sm font-medium">Repeat the new password<input id="repeat-password" className={field} type="password" autoComplete="new-password" required value={again} onChange={e => setAgain(e.target.value)} /></label>
                    {error ? <p role="alert" className="rounded-xl bg-[var(--bad-soft)] px-3 py-2 text-sm text-[var(--bad-ink)] ring-1 ring-inset ring-[var(--bad-line)]">{error}</p> : null}
                    {done ? <p role="status" className="flex items-start gap-2 rounded-xl bg-[var(--good-soft)] px-3 py-2 text-sm text-[var(--good-ink)] ring-1 ring-inset ring-[var(--good-line)]"><CheckCircle2 aria-hidden="true" size={17} className="mt-0.5 shrink-0" />{done}</p> : null}
                    <button type="submit" className={primaryButton} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <KeyRound aria-hidden="true" size={16} />}Change password</button>
                </form>
            </Panel>
        </div>
    </>;
}
