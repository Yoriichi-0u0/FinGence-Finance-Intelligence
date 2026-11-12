'use client';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowLeft, Calculator, KeyRound, LoaderCircle, LogIn, Sparkles, UserCheck } from 'lucide-react';
import { button, primaryButton } from '@/components/demo/shared';
import { plainMessage, ROLE_LABEL, useWorkspace, type WorkspaceRole } from './context';

const field = 'mt-1.5 block min-h-11 w-full rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--ink)] focus-visible:border-[var(--brand)]';
const card = 'rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-panel)] sm:p-6';
const errorText = 'rounded-xl bg-[var(--bad-soft)] px-3 py-2 text-sm text-[var(--bad-ink)] ring-1 ring-inset ring-[var(--bad-line)]';

const POINTS = [
    { Icon: Calculator, text: 'Every figure is computed by fixed rules and checked against your books.' },
    { Icon: Sparkles, text: 'AI only suggests how a document is laid out. It never supplies an amount.' },
    { Icon: UserCheck, text: 'Each person sees what their role allows: Finance user, Admin or Superadmin.' },
];

/** Sign-in and joining stand on their own: the brand on one side, the form on the other (stacked on a phone). */
export function AuthLayout({ children }: { children: React.ReactNode }) {
    return <div className="min-h-dvh bg-[var(--canvas)] lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <section className="relative overflow-hidden bg-[var(--rail)] px-5 py-6 text-white sm:px-8 lg:flex lg:min-h-dvh lg:flex-col lg:justify-between lg:px-12 lg:py-12">
            <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-[#2563eb]/30 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -right-24 size-80 rounded-full bg-[#38bdf8]/10 blur-3xl" />
            <div className="relative flex items-center gap-3">
                <Image src="/branding/FinGence_Logo_96.png" width={44} height={44} alt="" unoptimized className="size-10 rounded-xl ring-1 ring-white/10 lg:size-11" />
                <span><span className="block text-[21px] font-semibold leading-6 tracking-[-0.03em]">FinGence</span><span className="block text-[11px] text-[var(--rail-muted)]">Finance + Intelligence</span></span>
            </div>
            <div className="relative mt-10 hidden max-w-md lg:block">
                <h2 className="text-[34px] font-semibold leading-[1.12] tracking-[-0.035em]">Bank statements and ledgers, reconciled and explained.</h2>
                <ul className="mt-8 space-y-4">{POINTS.map(({ Icon, text }) => <li key={text} className="flex gap-3 text-[15px] leading-relaxed text-[var(--rail-ink)]/90"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.07] ring-1 ring-inset ring-white/10"><Icon aria-hidden="true" size={17} className="text-[#93bdff]" /></span><span className="pt-1.5">{text}</span></li>)}</ul>
            </div>
            <p className="relative mt-10 hidden text-xs text-[var(--rail-muted)] lg:block">For SAIC users · by invitation only</p>
        </section>
        <main className="flex justify-center px-4 py-8 sm:px-6 sm:py-12 lg:items-center">
            <div className="w-full max-w-md">{children}</div>
        </main>
    </div>;
}

function Heading({ title, children }: { title: string; children: React.ReactNode }) {
    return <header className="mb-6"><h1 className="text-[28px] font-semibold leading-tight tracking-[-0.035em]">{title}</h1><p className="mt-2 text-sm leading-relaxed text-[var(--muted-strong)]">{children}</p></header>;
}
// Every role processes documents, so everyone starts on Data.
const HOME = '/data';

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
        if (result.ok && result.body?.role) { await workspace.refresh(); router.push(HOME); return; }
        setError(plainMessage(result.body?.code)); setBusy(false);
    }
    if (workspace.session) return <>
        <Heading title="You are signed in">As <strong className="text-[var(--ink)]">{workspace.session.email}</strong> ({ROLE_LABEL[workspace.session.role]}) at {workspace.session.organization.name}.</Heading>
        <div className="flex flex-wrap gap-2"><Link href={HOME} className={primaryButton}>Continue</Link><button type="button" className={button} onClick={() => void workspace.signOut()}>Sign out</button></div>
    </>;
    return <>
        <Heading title="Sign in">FinGence is for SAIC users. Use the account your administrator set up for you.</Heading>
        <form className={`${card} space-y-4`} onSubmit={e => void submit(e)}>
            {workspace.ended ? <p role="status" className="rounded-xl bg-[var(--warn-soft)] px-3 py-2 text-sm text-[var(--warn-ink)] ring-1 ring-inset ring-[var(--warn-line)]">Your session has ended. Please sign in again.</p> : null}
            <label className="block text-sm font-medium">Email<input className={field} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label className="block text-sm font-medium">Password<input className={field} type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
            {error ? <p role="alert" className={errorText}>{error}</p> : null}
            <button type="submit" className={`${primaryButton} w-full justify-center`} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <LogIn aria-hidden="true" size={16} />}Sign in</button>
        </form>
        <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-dashed border-[var(--border-strong)] px-5 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[var(--muted-strong)]">New here? Use the one-time code your administrator gave you.</span>
            <Link href="/join" className={`${button} shrink-0`}><KeyRound aria-hidden="true" size={16} />I have a code</Link>
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
        if (result.ok && result.body?.role) { await workspace.refresh(); router.push(HOME); return; }
        if (result.ok) { router.push('/sign-in'); return; }
        setError(plainMessage(result.body?.code)); setBusy(false);
    }
    return <>
        <Heading title="Join FinGence">Enter the one-time invitation code from your administrator, then choose your password.</Heading>
        <form className={`${card} space-y-4`} onSubmit={e => void submit(e)}>
            <label className="block text-sm font-medium">Invitation code<input className={`${field} font-mono`} autoComplete="off" spellCheck={false} required value={code} onChange={e => setCode(e.target.value)} /></label>
            <label className="block text-sm font-medium">New password <span className="font-normal text-[var(--muted)]">(12 to 128 characters)</span><input className={field} type="password" autoComplete="new-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
            <label className="block text-sm font-medium">Repeat the password<input className={field} type="password" autoComplete="new-password" required value={again} onChange={e => setAgain(e.target.value)} /></label>
            {error ? <p role="alert" className={errorText}>{error}</p> : null}
            <button type="submit" className={`${primaryButton} w-full justify-center`} disabled={busy}>{busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <KeyRound aria-hidden="true" size={16} />}Join and sign in</button>
        </form>
        <Link href="/sign-in" className="mt-5 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--brand-ink)]"><ArrowLeft aria-hidden="true" size={16} />Back to sign in</Link>
    </>;
}
