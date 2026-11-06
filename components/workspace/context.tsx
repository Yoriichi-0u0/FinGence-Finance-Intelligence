'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type WorkspaceRole = 'FINANCE' | 'MANAGEMENT' | 'ADMIN';
export type WorkspaceSession = { email: string; role: WorkspaceRole; organization: { name: string }; processing: { paused: boolean; reason: string | null; since: string | null } };
export const ROLE_LABEL: Record<WorkspaceRole, string> = { FINANCE: 'Finance', MANAGEMENT: 'Management (Technical)', ADMIN: 'Admin' };

type Value = {
    /** The hosted workspace is on (sign-in exists); false on deployments without it. */
    enabled: boolean;
    /** True until the first session check answers. */
    loading: boolean;
    session: WorkspaceSession | null;
    /** The last check found a session that had been ended (by Management, Admin, expiry or an access change). */
    ended: boolean;
    refresh: () => Promise<WorkspaceSession | null>;
    signOut: () => Promise<void>;
};
const WorkspaceContext = createContext<Value>({ enabled: false, loading: false, session: null, ended: false, refresh: async () => null, signOut: async () => undefined });

export function WorkspaceProvider({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
    const [loading, setLoading] = useState(enabled);
    const [session, setSession] = useState<WorkspaceSession | null>(null);
    const [ended, setEnded] = useState(false);
    const refresh = useCallback(async () => {
        if (!enabled) return null;
        try {
            const body = await (await fetch('/api/workspace/session', { cache: 'no-store' })).json() as ({ signedIn: true } & WorkspaceSession) | { signedIn: false; ended?: boolean };
            const next = body.signedIn ? { email: body.email, role: body.role, organization: body.organization, processing: body.processing } : null;
            setSession(next); setEnded(!body.signedIn && !!body.ended);
            return next;
        } catch { return null; } finally { setLoading(false); }
    }, [enabled]);
    useEffect(() => {
        if (!enabled) return;
        queueMicrotask(() => void refresh());
        // A pause, or a session ended by Management, reaches an open page within a minute (and on focus).
        const timer = setInterval(() => void refresh(), 60_000), focus = () => void refresh();
        window.addEventListener('focus', focus);
        return () => { clearInterval(timer); window.removeEventListener('focus', focus); };
    }, [enabled, refresh]);
    const signOut = useCallback(async () => {
        await fetch('/api/workspace/sign-out', { method: 'POST' }).catch(() => undefined);
        setSession(null); setEnded(false);
        // A full load, so no processing result of the signed-out person stays in this tab's memory or storage.
        try { sessionStorage.clear(); } catch { /* storage unavailable */ }
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.href = '/sign-in';
    }, []);
    const value = useMemo(() => ({ enabled, loading, session, ended, refresh, signOut }), [enabled, loading, session, ended, refresh, signOut]);
    return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export const useWorkspace = () => useContext(WorkspaceContext);

/** Plain-language messages for Finance users; the codes themselves are for Management. */
export function plainMessage(code: string | undefined | null): string {
    switch (code) {
        case 'INVALID_CREDENTIALS': return 'The email or password is not right, or your access has been turned off. Check them, or ask your administrator.';
        case 'TOO_MANY_ATTEMPTS': return 'Too many attempts. Please wait a few minutes and try again.';
        case 'INVITATION_UNAVAILABLE': case 'INVALID_CODE': return 'This invitation code is not valid any more. Ask your administrator for a new one.';
        case 'ALREADY_MEMBER': return 'This email already has an account. Sign in instead.';
        case 'PASSWORD_RULE': return 'Choose a password of 12 to 128 characters.';
        case 'PROCESSING_PAUSED': return 'Processing is paused by your technical team. Nothing was processed; please try again later.';
        case 'SESSION_ENDED': case 'SIGN_IN_REQUIRED': return 'You have been signed out. Please sign in again.';
        case 'WORKSPACE_UNAVAILABLE': return 'FinGence cannot reach its database right now. Please try again in a moment.';
        default: return 'Something went wrong. Please try again; if it keeps happening, tell your technical team.';
    }
}
