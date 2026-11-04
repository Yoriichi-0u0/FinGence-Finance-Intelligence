'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { KeyRound, LoaderCircle, LogIn } from 'lucide-react';
import { PageHeader, Panel } from '@/components/ui';
import { button, primaryButton } from '@/components/demo/shared';
import { plainMessage, ROLE_LABEL, useWorkspace, type WorkspaceRole } from './context';

const field = 'mt-1 block min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm';
const home = (role: WorkspaceRole) => role === 'FINANCE' ? '/data' : role === 'MANAGEMENT' ? '/operations' : '/team';

async function post(path: string, body: unknown) {
    try {
        const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { ok: res.ok, body: await res.json().catch(() => null) as { code?: string; role?: WorkspaceRole; signedIn?: boolean } | null };
    } catch { return { ok: false, body: { code: 'WORKSPACE_UNAVAILABLE' } }; }
}

export function SignIn() {
    const workspace = useWorkspace(), router = useRouter();
    const [email, setEmail] = useState(''), [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
    async function submit(event: React.FormEvent) {
        event.preventDefault(); setBusy(true); setError(null);
        const result = await post('/api/workspace/sign-in', { email, password });
        setPassword('');
        if (result.ok && result.body?.role) { await workspace.refresh(); router.push(home(result.body.role)); return; }
        setError(plainMessage(result.body?.code)); setBusy(false);
    }
    if (workspace.session) return <>
        <PageHeader title="Sign in" description="You are already signed in." />
        <Panel><div className="p-4 text-sm sm:p-5">
            <p>Signed in as <strong>{workspace.session.email}</strong> ({ROLE_LABEL[workspace.session.role]}) at {workspace.session.organization.name}.</p>
            <div className="mt-4 flex flex-wrap gap-2"><Link href={home(workspace.session.role)} className={primaryButton}>Continue</Link><button type="button" className={button} onClick={() => void workspace.signOut()}>Sign out</button></div>
        </div></Panel>
    </>;
    return <>
        <PageHeader title="Sign in" description="Sign in to your organization's FinGence workspace." />
        <div className="grid max-w-3xl gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]">
            <Panel title="Your account">
                <form className="space-y-4 p-4 sm:p-5" onSubmit={e => void submit(e)}>
                    {workspace.ended ? <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Your session has ended. Please sign in again.</p> : null}
                    <label className="block text-sm font-medium">Email<input className={field} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
                    <label className="block text-sm font-medium">Password<input className={field} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
                    {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
                    <button type="submit" className={primaryButton} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <LogIn aria-hidden="true" size={16} />}Sign in</button>
                </form>
            </Panel>
            <Panel title="New here?">
                <div className="space-y-3 p-4 text-sm sm:p-5">
                    <p>Your administrator gives you a one-time invitation code. Use it once to choose your password.</p>
                    <Link href="/join" className={button}><KeyRound aria-hidden="true" size={16} />I have an invitation code</Link>
                    <p className="text-[var(--muted)]">Just looking? The <Link href="/data" className="font-semibold underline">public demo</Link> works without an account, with fictional documents only.</p>
                </div>
            </Panel>
        </div>
    </>;
}

export function Join() {
    const workspace = useWorkspace(), router = useRouter();
    const [code, setCode] = useState(''), [password, setPassword] = useState(''), [again, setAgain] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
    async function submit(event: React.FormEvent) {
        event.preventDefault(); setError(null);
        if (password !== again) { setError('The two passwords are different.'); return; }
        if ([...password].length < 12 || [...password].length > 128) { setError(plainMessage('PASSWORD_RULE')); return; }
        setBusy(true);
        const result = await post('/api/workspace/join', { code: code.trim(), password });
        setPassword(''); setAgain('');
        if (result.ok && result.body?.role) { await workspace.refresh(); router.push(home(result.body.role)); return; }
        if (result.ok) { router.push('/sign-in'); return; }
        setError(plainMessage(result.body?.code)); setBusy(false);
    }
    return <>
        <PageHeader title="Join your organization" description="Use the one-time invitation code from your administrator and choose a password." />
        <Panel className="max-w-xl">
            <form className="space-y-4 p-4 sm:p-5" onSubmit={e => void submit(e)}>
                <label className="block text-sm font-medium">Invitation code<input className={`${field} font-mono`} autoComplete="off" spellCheck={false} required value={code} onChange={e => setCode(e.target.value)} /></label>
                <label className="block text-sm font-medium">New password <span className="font-normal text-[var(--muted)]">(12 to 128 characters)</span><input className={field} type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
                <label className="block text-sm font-medium">Repeat the password<input className={field} type="password" autoComplete="new-password" required value={again} onChange={e => setAgain(e.target.value)} /></label>
                {error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
                <button type="submit" className={primaryButton} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <KeyRound aria-hidden="true" size={16} />}Join and sign in</button>
            </form>
        </Panel>
    </>;
}
