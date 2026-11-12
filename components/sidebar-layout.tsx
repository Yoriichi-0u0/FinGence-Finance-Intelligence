"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * The desktop sidebar's width and whether it is collapsed to an icon rail. Kept in this browser's localStorage only
 * (a convenience, like the colour theme): a private window or blocked storage simply starts from the default.
 */
export const SIDEBAR_DEFAULT = 248;
export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 320;
export const SIDEBAR_RAIL = 72;
const KEY = "fingence-sidebar";
const EVENT = "fingence-sidebar";

export const clampWidth = (w: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
type Layout = { width: number; collapsed: boolean };
const DEFAULT = `${SIDEBAR_DEFAULT}:0`;

function read(): string {
  try {
    const saved = localStorage.getItem(KEY);
    return saved && /^\d{3}:[01]$/.test(saved) ? saved : DEFAULT;
  } catch {
    return DEFAULT;
  }
}
const parse = (s: string): Layout => { const [w, c] = s.split(":"); return { width: clampWidth(Number(w)), collapsed: c === "1" }; };
function write(layout: Layout) {
  try { localStorage.setItem(KEY, `${clampWidth(layout.width)}:${layout.collapsed ? 1 : 0}`); } catch { /* storage unavailable: lasts for this page only */ }
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onChange); };
}

export function useSidebarLayout() {
  const layout = parse(useSyncExternalStore(subscribe, read, () => DEFAULT));
  const setWidth = useCallback((width: number) => write({ ...parse(read()), width }), []);
  const toggle = useCallback(() => { const now = parse(read()); write({ ...now, collapsed: !now.collapsed }); }, []);
  // "[" collapses or expands the sidebar, unless the person is typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (!window.matchMedia("(min-width: 1024px)").matches) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  return { ...layout, shown: layout.collapsed ? SIDEBAR_RAIL : layout.width, setWidth, toggle };
}

/** The drag handle on the sidebar's edge: a pointer drag, or the arrow keys (Home and End for the limits); double-click resets. */
export function ResizeHandle({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      className="group absolute inset-y-0 -right-1.5 z-20 hidden w-3 cursor-col-resize touch-none outline-none lg:block"
      onPointerDown={e => {
        const el = e.currentTarget, left = el.parentElement!.getBoundingClientRect().left;
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => onWidth(clampWidth(ev.clientX - left));
        const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up); };
        el.addEventListener("pointermove", move); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
      }}
      onDoubleClick={() => onWidth(SIDEBAR_DEFAULT)}
      onKeyDown={e => {
        const step = e.shiftKey ? 32 : 16;
        const next = e.key === "ArrowLeft" ? width - step : e.key === "ArrowRight" ? width + step : e.key === "Home" ? SIDEBAR_MIN : e.key === "End" ? SIDEBAR_MAX : null;
        if (next === null) return;
        e.preventDefault();
        onWidth(clampWidth(next));
      }}
    >
      <span aria-hidden="true" className="mx-auto block h-full w-[2px] bg-transparent transition-colors group-hover:bg-[#3b82f6]/70 group-focus-visible:bg-[#3b82f6]" />
    </div>
  );
}
