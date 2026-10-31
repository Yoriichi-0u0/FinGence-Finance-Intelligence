"use client";

import { useEffect, useRef, useState } from "react";

type Status = "Checking session" | "Not signed in" | "Session unavailable" | `Signed in · ${string}`;
const roles = ["Finance", "Admin", "Technical (Management)"];

/** Display-only observer: no identity storage, credentials or authorization decisions. */
export function observePocSession(display: (status: Status) => void) {
  let ended = false;
  let sequence = 0;
  let controller: AbortController | null = null;
  const clear = () => {
    sequence++;
    controller?.abort();
    controller = null;
    if (!ended) display("Checking session");
  };
  const check = async () => {
    if (ended || document.hidden || controller) return;
    const current = ++sequence;
    const request = new AbortController();
    controller = request;
    display("Checking session");
    const timeout = setTimeout(() => request.abort(), 8000);
    try {
      const response = await fetch("/api/ai-ingestion/m2?action=session", { cache: "no-store", signal: request.signal });
      if (!response.ok) throw new Error("UNAVAILABLE");
      const data = await response.json();
      let status: Status;
      if (data?.active === false) status = "Not signed in";
      else if (data?.active === true && roles.includes(data.role)) status = `Signed in · ${data.role}`;
      else throw new Error("INVALID_SESSION_RESPONSE");
      if (!ended && current === sequence) display(status);
    } catch {
      if (!ended && current === sequence) display("Session unavailable");
    } finally {
      clearTimeout(timeout);
      if (controller === request) controller = null;
    }
  };
  const refresh = () => { void check(); };
  const visibility = () => { if (document.hidden) clear(); else refresh(); };
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", refresh);
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", visibility);
  const timer = setInterval(refresh, 30000);
  refresh();
  return () => {
    ended = true;
    clear();
    clearInterval(timer);
    window.removeEventListener("focus", refresh);
    window.removeEventListener("pageshow", refresh);
    window.removeEventListener("blur", clear);
    document.removeEventListener("visibilitychange", visibility);
  };
}

export function SessionBadge({ status, onToggle, expanded = false, busy = false }: { status: Status; onToggle?: () => void; expanded?: boolean; busy?: boolean }) {
  const active = status.startsWith("Signed in · ");
  const style = "inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] px-2.5 py-1 text-[11px] leading-4 text-slate-300";
  const content = <><span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${active ? "bg-emerald-300" : "bg-slate-400"}`} /><span>{status}</span></>;
  return <span role="status" aria-live="polite" className="inline-flex max-w-full text-[11px] leading-4">{status === "Not signed in"
    ? <a href="/transactions" aria-label="Not signed in — sign in to FinGence" className={`${style} cursor-pointer transition-colors hover:border-teal-200/30 hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-200`}>{content}</a>
    : active && onToggle ? <button type="button" aria-expanded={expanded} aria-controls="poc-session-actions" disabled={busy} onClick={onToggle} className={`${style} cursor-pointer transition-colors hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-teal-200`}>{content}</button> : <span className={style}>{content}</span>}</span>;
}

/** Coalesces duplicate clicks and requires the endpoint's explicit inactive acknowledgement. */
export function createPocLogout() {
  let pending: Promise<void> | null = null;
  return () => pending ??= (async () => {
    const response = await fetch("/api/ai-ingestion/m2?action=logout", { method: "POST", cache: "no-store" });
    if (!response.ok || (await response.json())?.active !== false) throw new Error("LOGOUT_UNCONFIRMED");
  })().finally(() => { pending = null; });
}

export default function PocSessionStatus() {
  const [status, setStatus] = useState<Status>("Checking session");
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null), action = useRef<HTMLButtonElement>(null);
  const observer = useRef<(() => void) | null>(null), logout = useRef(createPocLogout()), submitting = useRef(false);
  useEffect(() => {
    observer.current = observePocSession(value => { setStatus(value); if (!value.startsWith("Signed in · ")) setOpen(false); });
    return () => observer.current?.();
  }, []);
  useEffect(() => {
    if (!open) return;
    action.current?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  async function signOut() {
    if (submitting.current) return;
    submitting.current = true; observer.current?.(); setBusy(true); setError("");
    // Hide mounted homepage financial data immediately, including after an uncertain logout.
    window.dispatchEvent(new Event("fingence:poc-session-cleared"));
    try {
      await logout.current();
      setStatus("Not signed in"); setOpen(false);
      observer.current = observePocSession(setStatus);
    } catch {
      setStatus("Session unavailable");
      setError("Sign-out could not be confirmed. Your server session may still be active. Try again.");
    } finally { submitting.current = false; setBusy(false); }
  }
  return <div ref={container} className="relative max-w-full" onKeyDown={event => { if (event.key === "Escape") { setOpen(false); container.current?.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus(); } }}>
    <SessionBadge status={status} onToggle={() => setOpen(value => !value)} expanded={open} busy={busy} />
    {open && <div id="poc-session-actions" className="absolute right-0 top-full z-40 mt-2 w-44 max-w-[80vw] rounded-xl border border-slate-100 bg-white p-1.5 text-slate-700 shadow-md">
      <button ref={action} type="button" disabled={busy} onClick={() => void signOut()} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-medium hover:bg-teal-50 focus-visible:outline-2 focus-visible:outline-teal-700 disabled:opacity-60">{busy ? "Signing out…" : "Sign out"}</button>
      {error && <p role="alert" className="px-3 pb-2 text-xs leading-relaxed text-red-800">{error}</p>}
    </div>}
    {!open && error && <p role="alert" className="mt-2 max-w-xs text-xs text-amber-100">{error}</p>}
  </div>;
}
