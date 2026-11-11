'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';

/** SAIC only, three stacked roles: each includes everything the one below it may do. */
export type WorkspaceRole = 'FINANCE' | 'ADMIN' | 'SUPERADMIN';
export type WorkspaceSession = { email: string; role: WorkspaceRole; organization: { name: string }; processing: { paused: boolean; reason: string | null; since: string | null }; ai: { enabled: boolean } };
export const ROLE_LABEL: Record<WorkspaceRole, string> = { FINANCE: 'Finance user', ADMIN: 'Admin', SUPERADMIN: 'Superadmin' };
const RANK: Record<WorkspaceRole, number> = { FINANCE: 1, ADMIN: 2, SUPERADMIN: 3 };
export const atLeast = (role: WorkspaceRole | undefined, minimum: WorkspaceRole) => !!role && RANK[role] >= RANK[minimum];
/** The roles a person may give: only those below their own. */
export const grantable = (role: WorkspaceRole): WorkspaceRole[] => (['FINANCE', 'ADMIN'] as WorkspaceRole[]).filter(r => RANK[r] < RANK[role]);
export const canManage = (actor: WorkspaceRole, target: WorkspaceRole) => RANK[target] < RANK[actor];
/** The roles a person may preview the app as: their own and every role below it. */
export const viewable = (role: WorkspaceRole): WorkspaceRole[] => (['SUPERADMIN', 'ADMIN', 'FINANCE'] as WorkspaceRole[]).filter(r => RANK[r] <= RANK[role]);
const VIEW_KEY = 'fingence-view-as';

type Value = {
    /** The hosted workspace is on (sign-in exists); false on deployments without it. */
    enabled: boolean;
    /** True until the first session check answers. */
    loading: boolean;
    session: WorkspaceSession | null;
    /**
     * The role the app is shown as: the signed-in role, or a lower one an Admin or Superadmin chose with "Switch view"
     * to see what that role sees. It only ever hides things; every request is still checked against the real role.
     */
    viewRole: WorkspaceRole | null;
    /** Preview the app as a lower role (null returns to the real role). Kept for this tab only. */
    setViewAs: (role: WorkspaceRole | null) => void;
    /** The last check found a session that had been ended (by an Admin, expiry or an access change). */
    ended: boolean;
    refresh: () => Promise<WorkspaceSession | null>;
    signOut: () => Promise<void>;
};
/** Exported for tests, which render pages as a given signed-in role. */
export const WorkspaceContext = createContext<Value>({ enabled: false, loading: false, session: null, viewRole: null, setViewAs: () => undefined, ended: false, refresh: async () => null, signOut: async () => undefined });

export function WorkspaceProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
    const [loading, setLoading] = useState(enabled);
    const [session, setSession] = useState<WorkspaceSession | null>(null);
    const [ended, setEnded] = useState(false);
    const [viewAs, setViewAsState] = useState<WorkspaceRole | null>(null);
    useEffect(() => {
        try { const stored = sessionStorage.getItem(VIEW_KEY); if (stored === 'ADMIN' || stored === 'FINANCE') queueMicrotask(() => setViewAsState(stored)); } catch { /* storage unavailable */ }
    }, []);
    const setViewAs = useCallback((role: WorkspaceRole | null) => {
        setViewAsState(role);
        try { if (role) sessionStorage.setItem(VIEW_KEY, role); else sessionStorage.removeItem(VIEW_KEY); } catch { /* storage unavailable */ }
    }, []);
    // Whether the server has answered that there is no session (not merely that it could not be reached).
    const [signedOut, setSignedOut] = useState(false);
    const refresh = useCallback(async () => {
        if (!enabled) return null;
        try {
            const body = await (await fetch('/api/workspace/session', { cache: 'no-store' })).json() as ({ signedIn: true } & WorkspaceSession) | { signedIn: false; ended?: boolean };
            // An unavailable database answers without signedIn: keep what is known rather than signing the person out.
            if (typeof body.signedIn !== 'boolean') return null;
            const next = body.signedIn ? { email: body.email, role: body.role, organization: body.organization, processing: body.processing, ai: body.ai ?? { enabled: true } } : null;
            setSession(next); setEnded(!body.signedIn && !!body.ended); setSignedOut(!body.signedIn);
            return next;
        } catch { return null; } finally { setLoading(false); }
    }, [enabled]);
    useEffect(() => {
        if (!enabled) return;
        queueMicrotask(() => void refresh());
        // A pause, the AI switch, or a session ended by an Admin reaches an open page within a minute (and on focus).
        const timer = setInterval(() => void refresh(), 60_000), focus = () => void refresh();
        window.addEventListener('focus', focus);
        return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
    }, [enabled, refresh]);
    // SAIC users only: once the check finds no session (expired, ended, or never signed in), every page sends the person to sign in.
    const pathname = usePathname();
    useEffect(() => {
        if (!enabled || !signedOut || pathname === '/sign-in' || pathname === '/join') return;
        try { sessionStorage.clear(); } catch { /* storage unavailable */ }
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/sign-in';
    }, [enabled, signedOut, pathname]);
    const signOut = useCallback(async () => {
        await fetch('/api/workspace/sign-out', { method: 'POST' }).catch(() => undefined);
        setSession(null); setEnded(false);
        // A full load, so no processing result of the signed-out person stays in this tab's memory or storage.
        try { sessionStorage.clear(); } catch { /* storage unavailable */ }
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/sign-in';
    }, []);
    // A chosen view counts only while it is below the real role (a role change or another account resets it).
    const viewRole = session ? (viewAs && RANK[viewAs] < RANK[session.role] ? viewAs : session.role) : null;
    const value = useMemo(() => ({ enabled, loading, session, viewRole, setViewAs, ended, refresh, signOut }), [enabled, loading, session, viewRole, setViewAs, ended, refresh, signOut]);
    return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export const useWorkspace = () => useContext(WorkspaceContext);
/**
 * Processing IDs, fingerprints and job numbers are for Admins and Superadmins (and for deployments without sign-in,
 * which are technical by nature). A Finance user, or someone viewing as one, sees the plain-language result only.
 */
export function useTechnicalDetail() {
    const { enabled, viewRole } = useWorkspace();
    return !enabled || atLeast(viewRole ?? undefined, 'ADMIN');
}

/** Plain-language messages for Finance users; the codes themselves are shown to Admins in Operations. */
export function plainMessage(code: string | undefined | null): string {
    switch (code) {
        case 'INVALID_CREDENTIALS': return 'The email or password is not right, or your access has been turned off. Check them, or ask your administrator.';
        case 'TOO_MANY_ATTEMPTS': return 'Too many attempts. Please wait a few minutes and try again.';
        case 'INVITATION_UNAVAILABLE': case 'INVALID_CODE': return 'This invitation code is not valid any more. Ask your administrator for a new one.';
        case 'ALREADY_MEMBER': return 'This email already has an account. Sign in instead.';
        case 'PASSWORD_RULE': return 'Choose a password of 12 to 128 characters.';
        case 'PROCESSING_PAUSED': return 'Processing is paused by your administrator. Nothing was processed; please try again later.';
        case 'AI_OFF': return 'The AI is switched off by your administrator, so FinGence used its rules only.';
        case 'ROLE_NOT_ALLOWED': case 'FORBIDDEN': return 'Your role cannot make this change.';
        case 'SESSION_ENDED': case 'SIGN_IN_REQUIRED': return 'You have been signed out. Please sign in again.';
        case 'WORKSPACE_UNAVAILABLE': return 'FinGence cannot reach its database right now. Please try again in a moment.';
        default: return 'Something went wrong. Please try again; if it keeps happening, tell your Admin.';
    }
}
