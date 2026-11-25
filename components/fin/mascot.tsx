'use client';
import { createContext, useContext, useId } from 'react';
import { MessageSquareText } from 'lucide-react';

/**
 * The faces the mascot can show. Each is driven by a real signal (lib/fin/mood.ts): thinking while working, found when
 * something needs a look, unsure when a check failed, paused when the AI is off or at its limit, happy only when code
 * verified everything.
 */
export type FinMood = 'idle' | 'thinking' | 'happy' | 'found' | 'unsure' | 'paused';

/**
 * Fin, drawn: a small round sapphire friend with a dorsal fin on top (hence the name), big shiny eyes, rosy cheeks
 * and a little side fin that waves hello. It blinks now and then, bobs while thinking and hops once when pleased; all
 * of it stops when the person prefers reduced motion or turns motion off. Decorative: the caller labels the control it
 * sits in.
 */
export function FinMascot({ size = 40, mood = 'idle', className = '' }: { size?: number; mood?: FinMood; className?: string }) {
    const id = useId().replace(/:/g, ''), body = `fin-body-${id}`, belly = `fin-belly-${id}`, shine = `fin-shine-${id}`;
    const look = mood === 'thinking' ? 'translate(1.4 -1.6)' : mood === 'found' ? 'translate(1.6 -0.4)' : mood === 'unsure' ? 'translate(-1 1)' : undefined;
    const wide = mood === 'found';
    return <svg aria-hidden="true" focusable="false" viewBox="0 0 64 64" width={size} height={size} data-mood={mood} className={`fin-mascot fin-${mood} shrink-0 overflow-visible ${className}`}>
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
            {/* Brows: raised when it found something, one tilted when unsure. */}
            {wide ? <g fill="none" stroke="#0F172A" strokeWidth="1.8" strokeLinecap="round"><path d="M19.8 25.2c2.4-2.2 5.6-2.2 8 0" /><path d="M36.2 25.2c2.4-2.2 5.6-2.2 8 0" /></g>
                : mood === 'unsure' ? <g fill="none" stroke="#0F172A" strokeWidth="1.8" strokeLinecap="round"><path d="M20 27.2l7.4-1.8" /><path d="M36.6 25.9h7.4" /></g> : null}
            {/* Eyes: shiny, happy arcs when pleased, closed when paused. */}
            {mood === 'happy' ? <g fill="none" stroke="#0F172A" strokeWidth="2.6" strokeLinecap="round">
                <path d="M20.5 33.5c1.4-2.6 5-2.6 6.4 0" /><path d="M37.1 33.5c1.4-2.6 5-2.6 6.4 0" />
            </g> : mood === 'paused' ? <g fill="none" stroke="#0F172A" strokeWidth="2.4" strokeLinecap="round">
                <path d="M20.2 33.4c1.6 1.4 5 1.4 6.6 0" /><path d="M37 33.4c1.6 1.4 5 1.4 6.6 0" />
            </g> : <g className="fin-eyes">
                <g transform={look}>
                    <ellipse cx="23.7" cy="32.5" rx={wide ? 4.4 : 4} ry={wide ? 5.2 : 4.6} fill="#0F172A" />
                    <ellipse cx="40.3" cy="32.5" rx={wide ? 4.4 : 4} ry={wide ? 5.2 : 4.6} fill="#0F172A" />
                    <circle cx="25.2" cy="30.7" r="1.6" fill="#fff" /><circle cx="41.8" cy="30.7" r="1.6" fill="#fff" />
                    <circle cx="22.6" cy="34.4" r="0.7" fill="#fff" opacity="0.8" /><circle cx="39.2" cy="34.4" r="0.7" fill="#fff" opacity="0.8" />
                </g>
            </g>}
            {/* The mouth: a small smile, rounder when happy, a thoughtful or surprised "o", a wobble when unsure. */}
            {mood === 'thinking' || mood === 'found' ? <ellipse cx="32" cy="43.2" rx={mood === 'found' ? 1.8 : 2} ry={mood === 'found' ? 2.1 : 2.3} fill="#1E3A8A" />
                : mood === 'unsure' ? <path d="M27.4 42.6c1.5-1.4 3-1.4 4.4 0s3 1.4 4.6 0" fill="none" stroke="#1E3A8A" strokeWidth="2" strokeLinecap="round" />
                : mood === 'paused' ? <path d="M29.4 42.2h5.2" fill="none" stroke="#1E3A8A" strokeWidth="2" strokeLinecap="round" />
                : <path d={mood === 'happy' ? 'M27 41.2c2.6 4.4 7.4 4.4 10 0' : 'M28.4 41.6c2 2.6 5.2 2.6 7.2 0'} fill="none" stroke="#1E3A8A" strokeWidth="2.2" strokeLinecap="round" />}
        </g>
        {/* Above the head: a golden sparkle (it works with AI), an amber "!" when it found something, a "z" when paused. */}
        {mood === 'found' ? <g className="fin-alert"><circle cx="55.5" cy="10" r="6" fill="#F59E0B" /><path d="M55.5 6.6v4.2" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" /><circle cx="55.5" cy="13.6" r="1.2" fill="#fff" /></g>
            : mood === 'paused' ? <path d="M51.5 5.5h5l-5 5.5h5" fill="none" stroke="#94A3B8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            : mood === 'unsure' ? null
            : <path className="fin-sparkle" d="M55 7.5l1.2 3.1 3.1 1.2-3.1 1.2-1.2 3.1-1.2-3.1-3.1-1.2 3.1-1.2Z" fill="#FBBF24" />}
    </svg>;
}

/** Whether to draw the character at all: a person may choose a plain, text-only assistant. */
export const AssistantLook = createContext<{ character: boolean }>({ character: true });

/** The assistant as the person chose to see it: the mascot in its mood, or a plain chat icon. Decorative. */
export function AssistantFace({ size = 40, mood = 'idle', className = '' }: { size?: number; mood?: FinMood; className?: string }) {
    const { character } = useContext(AssistantLook);
    if (character) return <FinMascot size={size} mood={mood} className={className} />;
    return <span aria-hidden="true" data-mood={mood} className={`grid shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[var(--brand)] ${className}`} style={{ width: size, height: size }}>
        <MessageSquareText size={Math.round(size * 0.5)} strokeWidth={1.75} />
    </span>;
}
