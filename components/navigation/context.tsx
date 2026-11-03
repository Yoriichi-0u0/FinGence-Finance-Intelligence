"use client";
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react';
import type { M2ClientPrincipal } from '@/lib/ai-ingestion/m2-client-state';
import { visibleNavigation, type NavigationMode, type NavigationItem } from './routes';
type Role = M2ClientPrincipal['role'] | null;
type NavigationValue = { items: NavigationItem[]; publish: (owner: string, role: Role) => void; release: (owner: string) => void };
const NavigationContext = createContext<NavigationValue>({ items: visibleNavigation({}), publish: () => {}, release: () => {} });
export const useNavigationItems = () => useContext(NavigationContext).items;
/** Reuse an active workspace's existing session state; this bridge performs no requests. */
export function useNavigationRole(role: Role) {
    const { publish, release } = useContext(NavigationContext), owner = useId();
    useEffect(() => { publish(owner, role); return () => release(owner); }, [owner, role, publish, release]);
}
/** UI discoverability only. Existing workspace session checks remain authoritative. */
export function NavigationProvider({ mode, children }: { mode: NavigationMode; children: React.ReactNode }) {
    const [session, setSession] = useState<{ owner: string; role: Role } | null>(null);
    const publish = useCallback((owner: string, role: Role) => setSession(current => current?.owner === owner && current.role === role ? current : { owner, role }), []);
    // A departing workspace cannot clear a newer workspace's observation.
    const release = useCallback((owner: string) => setSession(current => current?.owner === owner ? null : current), []);
    const items = useMemo(() => visibleNavigation({ ...mode, role: session?.role ?? null }), [mode, session?.role]);
    const value = useMemo(() => ({ items, publish, release }), [items, publish, release]);
    return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
