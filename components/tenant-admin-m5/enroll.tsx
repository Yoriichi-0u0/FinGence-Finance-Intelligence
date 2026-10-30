"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CircleCheck, Eye, EyeOff, KeyRound } from "lucide-react";
import { PageHeader, Panel } from "@/components/ui";

const field = "mt-1 block min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-50";
const messages: Record<number, string> = {
  409: "This enrollment code cannot be used. It may have expired, been used, revoked or replaced, or it was issued for a different email address. Ask your Admin for a new code.",
  400: "Use a password of 12 to 128 characters.",
  429: "Please wait a moment before trying again.",
};

export default function EnrollmentForm() {
  const [code, setCode] = useState(""), [showCode, setShowCode] = useState(false);
  const [email, setEmail] = useState(""), [password, setPassword] = useState(""), [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [result, setResult] = useState<{ membershipActive: boolean } | null>(null);
  useEffect(() => {
    // The code arrives in the fragment (never sent to a server or Referer) and is removed from the address bar at once.
    const fragment = new URLSearchParams(window.location.hash.slice(1)).get("code");
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser-only state after hydration
    if (fragment) setCode(fragment);
  }, []);
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = code.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && password.length >= 12 && password.length <= 128 && password === confirm;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/ai-ingestion/m2/admin?action=enroll", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: code.trim(), email, password }) });
      if (!r.ok) { setError(messages[r.status] ?? "Enrollment is unavailable here. Check that you opened the link on the same local FinGence workspace."); return; }
      const data = await r.json();
      setCode(""); setPassword(""); setConfirm("");
      setResult({ membershipActive: data.membershipActive === true });
    } catch {
      setError("Enrollment was not confirmed. Do not reuse the link elsewhere; ask your Admin whether the account was created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto min-w-0 max-w-xl space-y-5">
      <PageHeader title="Create your account" description="Redeem a single-use enrollment code from your organization" />
      {result ? (
        <Panel title="Account created">
          <div className="space-y-4 p-5 text-sm">
            <p className="flex items-start gap-2"><CircleCheck aria-hidden="true" size={20} className="mt-0.5 shrink-0 text-[var(--green)]" />
              {result.membershipActive ? "Your Admin membership is active. You can now sign in to Administration." : "Your account exists, but your membership is pending. An Admin of your organization must activate it before you can sign in."}</p>
            <p className="text-[var(--muted)]">The enrollment code has been used and no longer works. No session was started; sign in explicitly when ready.</p>
            <Link className={primary} href="/admin">Go to sign-in</Link>
          </div>
        </Panel>
      ) : (
        <Panel title="Enrollment details" eyebrow="Local workspace" action={<KeyRound aria-hidden="true" size={18} className="text-[var(--muted)]" />}>
          <form className="grid gap-4 p-5" onSubmit={submit}>
            <label className="text-sm font-medium">Enrollment code
              <span className="mt-1 flex gap-2">
                <input className={field.replace("mt-1 ", "")} type={showCode ? "text" : "password"} autoComplete="off" spellCheck={false} value={code} onChange={e => setCode(e.target.value)} aria-describedby="code-help" />
                <button type="button" className="grid min-h-11 min-w-11 place-items-center rounded-lg border border-[var(--border-strong)] bg-white" onClick={() => setShowCode(v => !v)} aria-label={showCode ? "Hide enrollment code" : "Show enrollment code"}>{showCode ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}</button>
              </span>
            </label>
            <p id="code-help" className="-mt-2 text-xs text-[var(--muted)]">{code ? "Code loaded from your link and removed from the address bar." : "Open the link your Admin sent, or paste the code."}</p>
            <label className="text-sm font-medium">Email address (as invited)<input className={field} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label className="text-sm font-medium">Password<input className={field} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} aria-describedby="password-help" /></label>
            <p id="password-help" className="-mt-2 text-xs text-[var(--muted)]">12 to 128 characters.</p>
            <label className="text-sm font-medium">Confirm password<input className={field} type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} aria-invalid={mismatch} /></label>
            {mismatch && <p className="-mt-2 text-xs text-[var(--red)]">Passwords do not match.</p>}
            <button className={primary} type="submit" disabled={busy || !ready}>{busy ? "Creating account…" : "Create account"}</button>
            {error && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
            <p className="text-xs text-[var(--muted)]">Your organization, role and email come from the code itself; nothing here can change them. Codes work once and expire after 24 hours.</p>
          </form>
        </Panel>
      )}
    </div>
  );
}
