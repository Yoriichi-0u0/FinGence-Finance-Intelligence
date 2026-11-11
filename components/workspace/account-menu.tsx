'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ChevronsUpDown, LogOut } from 'lucide-react';
import { ThemeSwitch } from '@/components/theme-switch';
import { ROLE_LABEL, useWorkspace } from './context';
import { ViewSwitch } from './view-switch';

const initials = (email: string) => email.split('@')[0].split(/[._-]+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';

/**
 * One account button at the foot of the navigation. It opens a small menu with who is signed in, "View as"
 * (Admins and Superadmins), the colour theme and Sign out, so the footer stays one line instead of three cards.
 */
export function AccountMenu() {
    const { session, viewRole, signOut } = useWorkspace();
    const pathname = usePathname(), [open, setOpen] = useState(false), [openedOn, setOpenedOn] = useState(pathname);
    const root = useRef<HTMLDivElement>(null), id = useId();
    // Moving to another page closes the menu.
    if (openedOn !== pathname) { setOpenedOn(pathname); setOpen(false); }
    useEffect(() => {
        if (!open) return;
        const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
        const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus(); } };
        document.addEventListener('pointerdown', away); document.addEventListener('keydown', escape);
        return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', escape); };
    }, [open]);
    if (!session) return null;
    const previewing = viewRole && viewRole !== session.role;
    return <div ref={root} className="relative">
        {open ? <div id={id} role="region" aria-label="Account" className="rise-in absolute inset-x-0 bottom-full z-20 mb-2 space-y-3 rounded-2xl bg-[var(--rail-raise)] p-3 shadow-2xl ring-1 ring-inset ring-white/10">
            <div className="px-1">
                <p className="truncate text-[13px] font-semibold text-white">{session.organization.name}</p>
                <p className="truncate text-xs text-[var(--rail-muted)]">{session.email}</p>
                <p className="mt-1 inline-flex rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] font-semibold text-[#93bdff]">{ROLE_LABEL[session.role]}</p>
            </div>
            <ViewSwitch />
            <div>
                <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--rail-muted)]/80">Theme</p>
                <ThemeSwitch />
            </div>
            <button type="button" onClick={() => void signOut()} className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 text-[13px] font-semibold text-white/90 hover:bg-white/10 hover:text-white">
                <LogOut aria-hidden="true" size={17} />Sign out
            </button>
        </div> : null}
        <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}
            className="flex min-h-14 w-full items-center gap-3 rounded-xl bg-white/[0.04] p-2.5 text-left ring-1 ring-inset ring-white/[0.06] hover:bg-white/[0.07]">
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-[#2563eb] text-[13px] font-semibold text-white">{initials(session.email)}</span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-white">{session.email}</span>
                <span className="block truncate text-xs text-[var(--rail-muted)]">{previewing ? `Viewing as ${ROLE_LABEL[viewRole]}` : `${ROLE_LABEL[session.role]} · ${session.organization.name}`}</span>
            </span>
            <ChevronsUpDown aria-hidden="true" size={16} className="shrink-0 text-[var(--rail-muted)]" />
            <span className="sr-only">Account menu</span>
        </button>
    </div>;
}
