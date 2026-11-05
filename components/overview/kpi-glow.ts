'use client';
import { useEffect, useRef, type PointerEvent } from 'react';

/** One queued frame for the whole KPI group; no React renders or document-level listeners. */
export function useKpiGlow() {
    const frame = useRef<number | null>(null);
    const pending = useRef<{ element: HTMLElement; x: number; y: number } | null>(null);
    const media = useRef<MediaQueryList | null>(null);
    const cancel = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; pending.current = null; };
    useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
    const move = (event: PointerEvent<HTMLElement>) => {
        if (event.pointerType !== 'mouse') return;
        media.current ??= window.matchMedia('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)');
        if (!media.current.matches) return;
        pending.current = { element: event.currentTarget, x: event.clientX, y: event.clientY };
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
            frame.current = null;
            const point = pending.current;
            if (!point?.element.isConnected || !media.current?.matches) return;
            const rect = point.element.getBoundingClientRect();
            point.element.style.setProperty('--kpi-x', `${point.x - rect.left}px`);
            point.element.style.setProperty('--kpi-y', `${point.y - rect.top}px`);
        });
    };
    return { onPointerEnter: move, onPointerMove: move, onPointerLeave: cancel, onPointerCancel: cancel };
}
