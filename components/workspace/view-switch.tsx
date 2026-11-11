'use client';
import Link from 'next/link';
import { Eye, Undo2 } from 'lucide-react';
import { atLeast, ROLE_LABEL, useWorkspace, viewable, type WorkspaceRole } from './context';

/**
 * "Switch view": an Admin or Superadmin previews FinGence as a lower role, to see exactly what those people see.
 * It only hides things in this tab; the server still answers every request for the real signed-in role.
 */
export function ViewSwitch() {
    const { session, viewRole, setViewAs } = useWorkspace();
    if (!session || !viewRole || !atLeast(session.role, 'ADMIN')) return null;
    return <label className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-xs text-[var(--rail-muted)] ring-1 ring-inset ring-white/[0.06]">
        <Eye aria-hidden="true" size={15} className="shrink-0 text-[#a5b4fc]" />
        <span className="shrink-0">View as</span>
        <select aria-label="Switch view" value={viewRole} onChange={e => setViewAs(e.target.value === session.role ? null : e.target.value as WorkspaceRole)}
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-white/10 bg-[#121a33] px-2 text-[13px] font-semibold text-white">
            {viewable(session.role).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
    </label>;
}

/** Shown at the top of every page while previewing a lower role. */
export function ViewingAs() {
    const { session, viewRole, setViewAs } = useWorkspace();
    if (!session || !viewRole || viewRole === session.role) return null;
    return <aside role="status" aria-label="Switch view notice" className="mb-5 flex flex-col gap-2 rounded-2xl border border-[var(--brand-line)] bg-[var(--brand-soft)] px-4 py-3 text-sm text-[var(--ink)] sm:flex-row sm:items-center">
        <Eye aria-hidden="true" size={18} className="hidden shrink-0 text-[var(--brand)] sm:block" />
        <span className="min-w-0 flex-1">You are viewing FinGence as <strong>{ROLE_LABEL[viewRole]}</strong>. Anything you do is still done as yourself ({ROLE_LABEL[session.role]}).</span>
        <button type="button" onClick={() => setViewAs(null)} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--surface)] px-3 font-semibold text-[var(--brand-ink)] ring-1 ring-inset ring-[var(--brand-line)] hover:bg-[var(--canvas)]">
            <Undo2 aria-hidden="true" size={15} />Back to {ROLE_LABEL[session.role]} view
        </button>
    </aside>;
}

/** Team and Operations are not part of a Finance user's view, so a preview shows what they would get instead. */
export function OutsideView({ page }: { page: string }) {
    const { session, setViewAs } = useWorkspace();
    return <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm">
        <h1 className="text-lg font-semibold">{page} is not part of this view</h1>
        <p className="mt-2 text-[var(--muted-strong)]">A Finance user does not see {page}. Their navigation shows only the finance pages.</p>
        <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/data" className="inline-flex min-h-10 items-center rounded-xl bg-[var(--brand)] px-3 font-semibold text-white">Open Data</Link>
            {session ? <button type="button" onClick={() => setViewAs(null)} className="inline-flex min-h-10 items-center rounded-xl px-3 font-semibold text-[var(--brand-ink)] ring-1 ring-inset ring-[var(--brand-line)]">Back to {ROLE_LABEL[session.role]} view</button> : null}
        </div>
    </section>;
}
