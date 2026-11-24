import { useId } from 'react';

export type FinMood = 'idle' | 'thinking' | 'happy';

/**
 * Fin, drawn: a small round sapphire friend with a dorsal fin on top (hence the name), big shiny eyes, rosy cheeks
 * and a little side fin that waves hello. It blinks now and then and bobs while thinking; both stop when the
 * person prefers reduced motion. Decorative: the caller labels the control it sits in.
 */
export function FinMascot({ size = 40, mood = 'idle', className = '' }: { size?: number; mood?: FinMood; className?: string }) {
    const id = useId().replace(/:/g, ''), body = `fin-body-${id}`, belly = `fin-belly-${id}`, shine = `fin-shine-${id}`;
    const look = mood === 'thinking' ? 'translate(1.4 -1.6)' : undefined;
    return <svg aria-hidden="true" focusable="false" viewBox="0 0 64 64" width={size} height={size} className={`fin-mascot fin-${mood} shrink-0 overflow-visible ${className}`}>
        <defs>
            <linearGradient id={body} x1="14" y1="10" x2="50" y2="60" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#60A5FA" /><stop offset="0.55" stopColor="#2563EB" /><stop offset="1" stopColor="#1D4ED8" /></linearGradient>
            <linearGradient id={belly} x1="32" y1="28" x2="32" y2="58" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#EFF6FF" /><stop offset="1" stopColor="#DBEAFE" /></linearGradient>
            <radialGradient id={shine} cx="0" cy="0" r="1" gradientTransform="translate(22 21) rotate(40) scale(13 8)" gradientUnits="userSpaceOnUse"><stop stopColor="#fff" stopOpacity="0.55" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
        </defs>
        <g className="fin-bob">
            {/* The dorsal fin that gives Fin its name. */}
            <path d="M29 13.5C30.5 6.5 36 2.5 42.5 2c-2.6 3.6-3.4 7.4-3 11.6Z" fill="#1E40AF" />
            <path d="M31.2 12.6c1.4-4.6 4.8-7.6 8.6-8.7-1.4 2.6-1.9 5.4-1.7 8.6Z" fill="#3B82F6" opacity="0.7" />
            {/* Little side fins; the right one waves. */}
            <path d="M9.5 38c-4.6.3-7.4 3.4-7.6 6.8 3.2-.2 6.4-1.6 8.6-4Z" fill="#1E40AF" />
            <path className="fin-wave" d="M54.5 38c4.6.3 7.4 3.4 7.6 6.8-3.2-.2-6.4-1.6-8.6-4Z" fill="#1E40AF" />
            {/* Body, belly and a soft highlight. */}
            <path d="M32 11.5c13.2 0 23 9.6 23 23.2C55 49 45.3 59 32 59S9 49 9 34.7C9 21.1 18.8 11.5 32 11.5Z" fill={`url(#${body})`} />
            <path d="M32 30c9.4 0 15.8 6 15.8 13.6S41.2 57 32 57s-15.8-5.8-15.8-13.4S22.6 30 32 30Z" fill={`url(#${belly})`} />
            <ellipse cx="22" cy="21" rx="13" ry="8" fill={`url(#${shine})`} />
            {/* Rosy cheeks. */}
            <ellipse cx="18.6" cy="40.6" rx="3.6" ry="2.3" fill="#F9A8D4" opacity="0.75" />
            <ellipse cx="45.4" cy="40.6" rx="3.6" ry="2.3" fill="#F9A8D4" opacity="0.75" />
            {/* Eyes: shiny when idle or thinking, happy arcs when pleased. */}
            {mood === 'happy' ? <g fill="none" stroke="#0F172A" strokeWidth="2.6" strokeLinecap="round">
                <path d="M20.5 33.5c1.4-2.6 5-2.6 6.4 0" /><path d="M37.1 33.5c1.4-2.6 5-2.6 6.4 0" />
            </g> : <g className="fin-eyes">
                <g transform={look}>
                    <ellipse cx="23.7" cy="32.5" rx="4" ry="4.6" fill="#0F172A" />
                    <ellipse cx="40.3" cy="32.5" rx="4" ry="4.6" fill="#0F172A" />
                    <circle cx="25.2" cy="30.7" r="1.6" fill="#fff" /><circle cx="41.8" cy="30.7" r="1.6" fill="#fff" />
                    <circle cx="22.6" cy="34.4" r="0.7" fill="#fff" opacity="0.8" /><circle cx="39.2" cy="34.4" r="0.7" fill="#fff" opacity="0.8" />
                </g>
            </g>}
            {/* A small smile, rounder when happy, a thoughtful "o" when thinking. */}
            {mood === 'thinking' ? <ellipse cx="32" cy="43.2" rx="2" ry="2.3" fill="#1E3A8A" />
                : <path d={mood === 'happy' ? 'M27 41.2c2.6 4.4 7.4 4.4 10 0' : 'M28.4 41.6c2 2.6 5.2 2.6 7.2 0'} fill="none" stroke="#1E3A8A" strokeWidth="2.2" strokeLinecap="round" />}
        </g>
        {/* A golden sparkle: Fin works with AI. */}
        <path className="fin-sparkle" d="M55 7.5l1.2 3.1 3.1 1.2-3.1 1.2-1.2 3.1-1.2-3.1-3.1-1.2 3.1-1.2Z" fill="#FBBF24" />
    </svg>;
}
