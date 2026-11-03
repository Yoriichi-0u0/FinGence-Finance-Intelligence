"use client";
import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { THEME_STORAGE_KEY as key } from './theme-preference';
let tabPreference: 'light' | 'dark' | null = null;
function snapshot() {
    if (tabPreference) return tabPreference;
    try { const saved = localStorage.getItem(key); if (saved === 'light' || saved === 'dark') return saved; } catch {}
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function subscribe(update: () => void) {
    const media = matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', update); window.addEventListener('storage', update); window.addEventListener('fingence-theme', update);
    return () => { media.removeEventListener('change', update); window.removeEventListener('storage', update); window.removeEventListener('fingence-theme', update); };
}
export const useTheme = () => useSyncExternalStore(subscribe, snapshot, () => 'system');
export function OverviewTheme({ children }: { children: React.ReactNode }) {
    const theme = useTheme();
    return <div className="overview-theme" data-theme={theme}>{children}</div>;
}
export function ThemeToggle() {
    const theme = useTheme();
    return <button type="button" className="ov-button" aria-label="Toggle dark mode" aria-pressed={theme === 'dark'} onClick={() => {
        const next = snapshot() === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(key, next); tabPreference = null; } catch { tabPreference = next; }
        window.dispatchEvent(new Event('fingence-theme'));
    }}><Sun size={16} aria-hidden="true" className="ov-sun" /><Moon size={16} aria-hidden="true" className="ov-moon" /><span>Appearance</span></button>;
}
