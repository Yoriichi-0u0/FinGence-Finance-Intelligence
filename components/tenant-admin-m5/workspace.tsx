"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Ban, Copy, History, KeyRound, LogOut, RefreshCw, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { Modal } from "@/components/overlay";
import { EmptyState, PageHeader, Panel, StatusBadge } from "@/components/ui";
import { M2ClientFence, principalScope, type M2ClientPrincipal } from "@/lib/ai-ingestion/m2-client-state";
import type { AdministrationAuditEntry, AdministrationInvitation, AdministrationMember, AdministrationOverview } from "@/lib/server/tenant-admin-m5/service";

type Role = M2ClientPrincipal["role"];
type Notice = { tone: "success" | "error"; text: string } | null;
type Confirmation = { title: string; description: string; confirm: string; run: () => Promise<void> } | null;
type Issued = { email: string; role: Role; expiresAt: string; link: string } | null;

const auth = "/api/ai-ingestion/m2", api = auth + "/admin";
const roles: Role[] = ["Finance", "Technical (Management)", "Admin"];
const scopeKey = (p: M2ClientPrincipal) => JSON.stringify([principalScope(p), p.role, p.membershipVersion]);
const refusals: Record<string, string> = {
  STALE_MEMBERSHIP: "This membership changed since it was loaded. The list was refreshed; review it and try again.",
  LAST_ADMIN_PROTECTED: "Not applied: at least one active Admin who can sign in must remain in this organization.",
  ALREADY_MEMBER: "That address already belongs to a member of this organization.",
  STALE_ACCOUNT: "The account is already in that state. The list was refreshed.",
  STALE_INVITATION: "That enrollment code has already been used, revoked or replaced.",
};
const actionLabels: Record<string, string> = {
  "membership.invited": "Enrollment code issued",
  "membership.invitation_revoked": "Enrollment code revoked",
  "membership.enrolled": "Account enrolled",
  "membership.activated": "Membership activated",
  "membership.deactivated": "Membership deactivated",
  "authorization.role_changed": "Role changed",
  "account.deactivated": "Account suspended",
  "account.reactivated": "Account reactivated",
  "session.revoked": "Sessions revoked",
  "authorization.denied": "Access denied",
  "auth.sign_in": "Signed in",
  "auth.sign_in_failed": "Sign-in refused",
  "dashboard.read": "Administration viewed",
  "security_logs.read": "Audit log viewed",
  "admin.configuration_changed": "Local configuration changed",
};
const outcomeLabels: Record<string, string> = { success: "Success", denied: "Denied", failure: "Refused" };
const time = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const membershipStatus = (m: AdministrationMember) => m.active ? "Active" : m.version === 1 ? "Pending activation" : "Inactive";
const invitationStatus = (i: AdministrationInvitation) => i.state === "PENDING" ? (i.expired ? "Expired" : "Pending") : i.state === "ACCEPTED" ? "Accepted" : "Revoked";
const primary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-900 disabled:cursor-not-allowed disabled:opacity-50";
const secondary = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const field = "mt-1 block min-h-11 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm";

export default function AdministrationWorkspace() {
  const fence = useRef(new M2ClientFence()), authenticating = useRef(false);
  const [principal, setPrincipal] = useState<M2ClientPrincipal | null>(null);
  const [overview, setOverview] = useState<AdministrationOverview | null>(null);
  const [events, setEvents] = useState<AdministrationAuditEntry[] | null>(null);
  const [loading, setLoading] = useState(false), [checked, setChecked] = useState(false), [generation, setGeneration] = useState(0);
  const [notice, setNotice] = useState<Notice>(null), [busy, setBusy] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null), [issued, setIssued] = useState<Issued>(null);
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");

  const clear = useCallback(() => { setOverview(null); setEvents(null); setIssued(null); setConfirmation(null); setBusy(null); }, []);
  const invalidate = useCallback(() => { fence.current.invalidate(); clear(); setPrincipal(null); }, [clear]);
  const refresh = useCallback(async () => {
    const p = fence.current.principal;
    if (!p || p.role === "Finance") return;
    const epoch = fence.current.epoch;
    setLoading(true);
    try {
      const [view, log] = await Promise.all([
        fetch(api + "?action=overview", { cache: "no-store" }),
        p.role === "Admin" ? fetch(api + "?action=audit", { cache: "no-store" }) : Promise.resolve(null),
      ]);
      if (!view.ok || (log && !log.ok)) throw new Error();
      const data = await view.json() as AdministrationOverview, audit = log ? (await log.json()).events as AdministrationAuditEntry[] : null;
      if (epoch !== fence.current.epoch) return;
      // A response for another user, organization, role or membership version is discarded.
      if (scopeKey({ ...data.scope }) !== scopeKey(p)) throw new Error();
      setOverview(data);
      setEvents(audit);
      // Remount member rows so an unsaved or refused edit never outlives an authorized refresh.
      setGeneration(g => g + 1);
    } catch {
      if (epoch === fence.current.epoch) setNotice({ tone: "error", text: "Administration data could not be authorized or audited. Sign in again or refresh." });
    } finally {
      if (epoch === fence.current.epoch) setLoading(false);
    }
  }, []);
  const adopt = useCallback((data: unknown) => {
    const changed = fence.current.observe(data);
    setPrincipal(fence.current.principal);
    if (changed) {
      clear();
      void refresh();
    }
  }, [clear, refresh]);
  useEffect(() => {
    let ended = false;
    const check = async () => {
      if (authenticating.current) return;
      const epoch = fence.current.epoch;
      try {
        const r = await fetch(auth + "?action=session", { cache: "no-store" });
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (ended || epoch !== fence.current.epoch) return;
        if (data.active) adopt(data);
        else invalidate();
      } catch {
        if (!ended && epoch === fence.current.epoch) invalidate();
      } finally {
        if (!ended) setChecked(true);
      }
    };
    void check();
    const timer = setInterval(() => { void check(); }, 1000);
    window.addEventListener("focus", check);
    return () => { ended = true; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [adopt, invalidate]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    authenticating.current = true;
    invalidate();
    const epoch = fence.current.epoch;
    setBusy("sign-in");
    setNotice(null);
    try {
      const r = await fetch(auth + "?action=login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (r.status === 429) { setNotice({ tone: "error", text: "Please wait a moment before signing in again." }); return; }
      if (!r.ok) throw new Error();
      const data = await r.json();
      if (epoch !== fence.current.epoch) return;
      setPassword("");
      adopt(data);
    } catch {
      setNotice({ tone: "error", text: "Sign-in refused. Check the address and password; the account and membership must both be active." });
    } finally {
      authenticating.current = false;
      setBusy(null);
    }
  }
  async function signOut() {
    invalidate();
    setNotice(null);
    await fetch(auth + "?action=logout", { method: "POST" }).catch(() => setNotice({ tone: "error", text: "Display cleared; server sign-out was not confirmed." }));
  }
  /** Every mutation is server-authorized; the browser only sends the target and intended state. */
  async function mutate(key: string, action: string, body: Record<string, unknown>, success: string) {
    const epoch = fence.current.epoch;
    setBusy(key);
    setNotice(null);
    try {
      const r = await fetch(api + "?action=" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (epoch !== fence.current.epoch) return null;
      if (r.status === 409) {
        const { refused } = await r.json();
        setNotice({ tone: "error", text: refusals[refused] ?? "Not applied." });
        void refresh();
        return null;
      }
      if (!r.ok) throw new Error();
      const data = await r.json();
      setNotice({ tone: "success", text: success });
      void refresh();
      return data;
    } catch {
      if (epoch === fence.current.epoch) setNotice({ tone: "error", text: "Not applied. Your access may have changed; the page is re-checking your session." });
      return null;
    } finally {
      if (epoch === fence.current.epoch) setBusy(null);
    }
  }
  const self = (m: AdministrationMember) => m.userId === principal?.userId;
  const ask = (title: string, description: string, confirm: string, run: () => Promise<void>) => setConfirmation({ title, description, confirm, run });

  const members = overview?.members ?? [], invitations = overview?.invitations ?? [];
  const pendingInvitations = invitations.filter(i => i.state === "PENDING" && !i.expired);
  const count = (predicate: (m: AdministrationMember) => boolean) => members.filter(predicate).length;
  const actions = {
    role(m: AdministrationMember, role: Role) {
      const run = async () => { await mutate(m.userId + ":role", "membership", { userId: m.userId, role, active: m.active, expectedVersion: m.version }, `${m.email} is now ${role}. Their sessions were revoked; they must sign in again.`); };
      if (self(m) || (m.role === "Admin" && role !== "Admin")) ask("Change this Admin's role?", self(m) ? "You will lose Admin access and be signed out immediately." : `${m.email} will lose Admin access and be signed out.`, "Change role", run);
      else void run();
    },
    membership(m: AdministrationMember, active: boolean) {
      const run = async () => { await mutate(m.userId + ":membership", "membership", { userId: m.userId, role: m.role, active, expectedVersion: m.version }, active ? `${m.email} can now sign in as ${m.role}.` : `${m.email}'s membership is inactive and their sessions were revoked.`); };
      if (!active) ask("Deactivate membership?", `${m.email} loses access to this organization and is signed out. The account itself stays enabled.`, "Deactivate membership", run);
      else if (m.role === "Admin") ask("Activate an Admin membership?", `${m.email} will be able to manage members, roles and enrollment for this organization.`, "Activate Admin", run);
      else void run();
    },
    sessions(m: AdministrationMember) {
      ask("Revoke sessions?", self(m) ? "You will be signed out of every session, including this one." : `${m.email} will be signed out everywhere. Their role and membership are unchanged.`, "Revoke sessions",
        async () => { await mutate(m.userId + ":sessions", "sessions-revoke", { userId: m.userId }, `${m.email}'s sessions were revoked.`); });
    },
    account(m: AdministrationMember, active: boolean) {
      const run = async () => { await mutate(m.userId + ":account", "account", { userId: m.userId, active }, active ? `${m.email}'s account can sign in again. Earlier sessions stay revoked.` : `${m.email}'s account is suspended and every session was revoked.`); };
      if (active) void run();
      else ask("Suspend account?", `${m.email} cannot sign in anywhere until the account is reactivated. Their membership and role are kept unchanged.`, "Suspend account", run);
    },
    revokeInvitation(i: AdministrationInvitation) {
      ask("Revoke enrollment code?", `The code issued to ${i.email} will stop working immediately.`, "Revoke code",
        async () => { await mutate(i.id + ":invitation", "invitation-revoke", { invitationId: i.id }, `The enrollment code for ${i.email} was revoked.`); });
    },
  };

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader title="Administration" description="Organization access, roles, enrollment and security audit for this local workspace" />
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Local experimental administration.</strong> OS-local accounts only. Hosted identity, Production users and browser organization creation are not available; organizations are created and recovered with the OS-owner command.
      </div>

      {notice && <p role="status" className={`rounded-lg border p-4 text-sm ${notice.tone === "success" ? "border-green-200 bg-[var(--green-soft)] text-[var(--green)]" : "border-amber-300 bg-amber-50 text-amber-950"}`}>{notice.text}</p>}

      {!checked ? (
        <Panel><p className="p-5 text-sm text-[var(--muted)]" role="status">Checking your local session…</p></Panel>
      ) : !principal ? (
        <Panel title="Sign in to administer your organization" eyebrow="Local session">
          <form className="grid gap-4 p-5 sm:max-w-md" onSubmit={signIn}>
            <label className="text-sm font-medium">Email<input className={field} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label className="text-sm font-medium">Password<input className={field} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
            <button className={primary} type="submit" disabled={busy === "sign-in" || !email || !password}>{busy === "sign-in" ? "Signing in…" : "Sign in"}</button>
            <p className="text-sm text-[var(--muted)]">Received an enrollment link? Open it to <Link className="font-semibold text-[var(--teal-dark)] underline" href="/enroll">create your account</Link>. An Admin activates new memberships before first sign-in.</p>
          </form>
        </Panel>
      ) : (
        <>
          <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--teal-soft)] text-[var(--teal-dark)]"><ShieldCheck aria-hidden="true" size={20} /></span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{overview?.organization.name ?? "Your organization"}</p>
                <p className="text-xs text-[var(--muted)]">Signed in as <StatusBadge status={principal.role} /> · membership version {principal.membershipVersion}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {principal.role !== "Finance" && <button className={secondary} onClick={() => void refresh()} disabled={loading}><RefreshCw aria-hidden="true" size={16} />{loading ? "Refreshing…" : "Refresh"}</button>}
              <button className={secondary} onClick={signOut}><LogOut aria-hidden="true" size={16} />Sign out</button>
            </div>
          </div>

          {principal.role === "Finance" ? (
            <Panel title="Administration requires the Admin role">
              <div className="flex flex-col items-start gap-4 p-5 text-sm">
                <p className="flex items-start gap-2"><Ban aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-[var(--red)]" />Your Finance membership does not include member, role, enrollment or audit administration. The server refuses these requests and records the attempt.</p>
                <p className="text-[var(--muted)]">Your verified financial views are unchanged.</p>
                <Link className={primary} href="/transactions">Open Transactions</Link>
              </div>
            </Panel>
          ) : !overview ? (
            <Panel><p className="p-5 text-sm text-[var(--muted)]" role="status">{loading ? "Loading authorized administration data…" : "Administration data is unavailable. Refresh to retry."}</p></Panel>
          ) : (
            <>
              {overview.view === "OPERATIONAL" && (
                <Panel title="Operational status" eyebrow="Technical (Management)">
                  <div className="space-y-4 p-5">
                    <p className="text-sm text-[var(--muted)]">Processing counts for your organization only. Member identities, enrollment, audit records and financial values are restricted to their roles.</p>
                    <JobCounts jobs={overview.jobs} />
                  </div>
                </Panel>
              )}

              {overview.view === "ADMIN" && (
                <>
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <Tile label="Members" value={members.length} />
                    <Tile label="Active memberships" value={count(m => m.active)} />
                    <Tile label="Pending activation" value={count(m => !m.active && m.version === 1)} tone={count(m => !m.active && m.version === 1) ? "amber" : undefined} />
                    <Tile label="Suspended accounts" value={count(m => !m.accountActive)} tone={count(m => !m.accountActive) ? "red" : undefined} />
                  </div>

                  <Panel title="Members" eyebrow="Roles, memberships and sessions" action={<UsersRound aria-hidden="true" size={18} className="text-[var(--muted)]" />}>
                    {members.length === 0 ? <EmptyState title="No members yet" description="Issue an enrollment code below to add the first member." /> : (
                      <>
                        <div className="thin-scrollbar hidden overflow-x-auto md:block">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-[var(--surface-subtle)] text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                              <tr><th scope="col" className="px-4 py-3 font-semibold">Member</th><th scope="col" className="px-4 py-3 font-semibold">Role</th><th scope="col" className="px-4 py-3 font-semibold">Membership</th><th scope="col" className="px-4 py-3 font-semibold">Account</th><th scope="col" className="px-4 py-3 font-semibold">Sessions</th><th scope="col" className="px-4 py-3 font-semibold">Actions</th></tr>
                            </thead>
                            <tbody className="divide-y divide-[var(--border)]">
                              {members.map(m => <MemberRow key={`${m.userId}:${generation}`} member={m} self={self(m)} busy={busy} actions={actions} layout="row" />)}
                            </tbody>
                          </table>
                        </div>
                        <ul className="divide-y divide-[var(--border)] md:hidden">
                          {members.map(m => <MemberRow key={`${m.userId}:${generation}`} member={m} self={self(m)} busy={busy} actions={actions} layout="card" />)}
                        </ul>
                      </>
                    )}
                  </Panel>

                  <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                    <Panel title="Invite a member" eyebrow="Single-use enrollment" action={<UserPlus aria-hidden="true" size={18} className="text-[var(--muted)]" />}>
                      <InviteForm busy={busy === "invite"} issued={issued} onDismiss={() => setIssued(null)} onInvite={async (address, role) => {
                        const result = await mutate("invite", "invite", { email: address, role }, `Enrollment code issued for ${address}. Share the link privately; it works once and expires in 24 hours.`);
                        // The code is held only in memory and never rendered as text.
                        if (result?.code) setIssued({ email: result.invitation.email, role: result.invitation.role, expiresAt: result.invitation.expiresAt, link: `${location.origin}/enroll#code=${result.code}` });
                        return Boolean(result);
                      }} />
                    </Panel>
                    <Panel title="Enrollment codes" eyebrow={`${pendingInvitations.length} pending`} action={<KeyRound aria-hidden="true" size={18} className="text-[var(--muted)]" />}>
                      {invitations.length === 0 ? <EmptyState title="No enrollment codes" description="Codes you issue appear here with their status. Codes are never shown again after issue." /> : (
                        <ul className="divide-y divide-[var(--border)]">
                          {invitations.map(i => (
                            <li key={i.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-5">
                              <div className="min-w-0">
                                <p className="truncate font-medium">{i.email}</p>
                                <p className="text-xs text-[var(--muted)]">{i.role} · {i.issuer === "ADMIN" ? "Admin-issued, activation required" : "OS-owner Admin code"} · expires {time(i.expiresAt)}</p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <StatusBadge status={invitationStatus(i)} />
                                {i.state === "PENDING" && !i.expired && <button className={secondary} disabled={busy !== null} onClick={() => actions.revokeInvitation(i)}>Revoke</button>}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Panel>
                  </div>

                  <Panel title="Processing status" eyebrow="Operational" action={<Activity aria-hidden="true" size={18} className="text-[var(--muted)]" />}>
                    <div className="p-5"><JobCounts jobs={overview.jobs} /></div>
                  </Panel>

                  <Panel title="Security audit" eyebrow="This organization · latest 100" action={<History aria-hidden="true" size={18} className="text-[var(--muted)]" />}>
                    {!events?.length ? <EmptyState title="No audit events yet" description="Administration, sign-in and access-denial events for this organization appear here." /> : (
                      <div className="thin-scrollbar max-h-[28rem] overflow-auto">
                        <table className="w-full min-w-[640px] text-left text-sm">
                          <thead className="sticky top-0 bg-[var(--surface-subtle)] text-[10px] uppercase tracking-[0.08em] text-[var(--muted)]">
                            <tr><th scope="col" className="px-4 py-3 font-semibold">Time</th><th scope="col" className="px-4 py-3 font-semibold">Event</th><th scope="col" className="px-4 py-3 font-semibold">Outcome</th><th scope="col" className="px-4 py-3 font-semibold">Actor</th><th scope="col" className="px-4 py-3 font-semibold">Target</th></tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--border)]">
                            {events.map((e, index) => (
                              <tr key={index} className="hover:bg-slate-50/80">
                                <td className="whitespace-nowrap px-4 py-2.5 text-[var(--muted)]">{time(e.occurredAt)}</td>
                                <td className="px-4 py-2.5">{actionLabels[e.action] ?? e.action}</td>
                                <td className="px-4 py-2.5"><StatusBadge status={outcomeLabels[e.outcome] ?? e.outcome} /></td>
                                <td className="max-w-[14rem] truncate px-4 py-2.5">{e.actorEmail ?? (e.action.startsWith("membership.") || e.action === "admin.configuration_changed" ? "OS owner / system" : "—")}</td>
                                <td className="max-w-[16rem] truncate px-4 py-2.5 text-[var(--muted)]">{e.targetEmail ?? (e.targetType === "organization_user" ? "Not in this organization" : e.targetId ?? "—")}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Panel>
                </>
              )}
            </>
          )}
        </>
      )}

      {confirmation && (
        <Modal title={confirmation.title} description={confirmation.description} onClose={() => setConfirmation(null)}>
          <div className="flex flex-col-reverse gap-2 p-5 sm:flex-row sm:justify-end">
            <button className={secondary} onClick={() => setConfirmation(null)}>Cancel</button>
            <button className={primary} onClick={() => { const run = confirmation.run; setConfirmation(null); void run(); }}>{confirmation.confirm}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "amber" | "red" }) {
  return (
    <div className="panel-shadow rounded-xl border border-[var(--border)] bg-white p-4">
      <p className="text-xs font-medium text-[var(--muted)]">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-[-0.02em] ${tone === "amber" ? "text-[var(--amber)]" : tone === "red" ? "text-[var(--red)]" : "text-[var(--ink)]"}`}>{value}</p>
    </div>
  );
}

function JobCounts({ jobs }: { jobs: { state: string; count: number }[] }) {
  if (!jobs.length) return <p className="text-sm text-[var(--muted)]">No processing operations recorded for this organization yet.</p>;
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {jobs.map(j => <div key={j.state} className="rounded-lg border border-[var(--border)] p-3"><dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--muted)]">{j.state}</dt><dd className="mt-1 text-xl font-semibold">{j.count}</dd></div>)}
    </dl>
  );
}

type Actions = {
  role: (m: AdministrationMember, role: Role) => void;
  membership: (m: AdministrationMember, active: boolean) => void;
  sessions: (m: AdministrationMember) => void;
  account: (m: AdministrationMember, active: boolean) => void;
};
function MemberRow({ member: m, self, busy, actions, layout }: { member: AdministrationMember; self: boolean; busy: string | null; actions: Actions; layout: "row" | "card" }) {
  const [role, setRole] = useState<Role>(m.role);
  const disabled = busy !== null;
  const identity = <><p className="flex min-w-0 items-center gap-2 font-medium"><span className="truncate" title={m.email}>{m.email}</span>{self && <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">You</span>}</p><p className="text-xs text-[var(--muted)]">Membership version {m.version}</p></>;
  const roleControl = (
    <div className="flex items-center gap-2">
      <select aria-label={`Role for ${m.email}`} className="min-h-11 rounded-lg border border-[var(--border-strong)] bg-white px-2 text-sm" value={role} disabled={disabled} onChange={e => setRole(e.target.value as Role)}>
        {roles.map(r => <option key={r}>{r}</option>)}
      </select>
      {role !== m.role && <button className={primary} disabled={disabled} onClick={() => actions.role(m, role)}>Save</button>}
    </div>
  );
  const buttons = (
    <div className="flex flex-wrap gap-2">
      <button className={secondary} disabled={disabled} onClick={() => actions.membership(m, !m.active)}>{busy === m.userId + ":membership" ? "Saving…" : m.active ? "Deactivate" : "Activate"}</button>
      <button className={secondary} disabled={disabled || m.activeSessions === 0} onClick={() => actions.sessions(m)}>{busy === m.userId + ":sessions" ? "Revoking…" : "Revoke sessions"}</button>
      <button className={secondary} disabled={disabled} onClick={() => actions.account(m, !m.accountActive)}>{busy === m.userId + ":account" ? "Saving…" : m.accountActive ? "Suspend account" : "Reactivate account"}</button>
    </div>
  );
  const sessions = <span className="text-sm">{m.activeSessions === 0 ? "None" : `${m.activeSessions} active`}</span>;
  if (layout === "card") return (
    <li className="space-y-3 px-4 py-4">
      <div className="min-w-0">{identity}</div>
      <div className="flex flex-wrap items-center gap-2"><StatusBadge status={membershipStatus(m)} /><StatusBadge status={m.accountActive ? "Enabled" : "Suspended"} /><span className="text-xs text-[var(--muted)]">Sessions: {sessions}</span></div>
      {roleControl}
      {buttons}
    </li>
  );
  return (
    <tr className="align-middle hover:bg-slate-50/80">
      <td className="max-w-[16rem] px-4 py-3">{identity}</td>
      <td className="px-4 py-3">{roleControl}</td>
      <td className="px-4 py-3"><StatusBadge status={membershipStatus(m)} /></td>
      <td className="px-4 py-3"><StatusBadge status={m.accountActive ? "Enabled" : "Suspended"} /></td>
      <td className="whitespace-nowrap px-4 py-3">{sessions}</td>
      <td className="px-4 py-3">{buttons}</td>
    </tr>
  );
}

function InviteForm({ busy, issued, onInvite, onDismiss }: { busy: boolean; issued: Issued; onInvite: (email: string, role: Role) => Promise<boolean>; onDismiss: () => void }) {
  const [address, setAddress] = useState(""), [role, setRole] = useState<Role>("Finance"), [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.trim()) && address.trim().length <= 200;
  if (issued) return (
    <div className="space-y-4 p-5 text-sm">
      <p className="flex items-start gap-2"><KeyRound aria-hidden="true" size={18} className="mt-0.5 shrink-0 text-[var(--teal)]" /><span>One-time enrollment link for <strong className="break-all">{issued.email}</strong> as {issued.role}. It expires {time(issued.expiresAt)}.</span></p>
      <div className="rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface-subtle)] p-3 font-mono text-xs text-[var(--muted)]" aria-label="Enrollment link hidden">/enroll#code=•••••••••••••••••••••••••</div>
      <p className="text-[var(--muted)]">The code is not displayed and cannot be shown again. Copy it and send it privately to the invitee only; they also need to confirm their email address. Their membership stays pending until you activate it.</p>
      <div className="flex flex-wrap gap-2">
        <button className={primary} onClick={async () => { try { await navigator.clipboard.writeText(issued.link); setCopied("copied"); } catch { setCopied("failed"); } }}><Copy aria-hidden="true" size={16} />{copied === "copied" ? "Link copied" : "Copy enrollment link"}</button>
        <button className={secondary} onClick={() => { setCopied("idle"); onDismiss(); }}>Done</button>
      </div>
      {copied === "failed" && <p role="status" className="text-amber-900">Clipboard access was refused. Revoke this code and issue a new one from a browser that allows copying.</p>}
    </div>
  );
  return (
    <form className="grid gap-4 p-5" onSubmit={async e => { e.preventDefault(); if (await onInvite(address.trim(), role)) setAddress(""); }}>
      <label className="text-sm font-medium">Email address<input className={field} type="email" autoComplete="off" value={address} onChange={e => setAddress(e.target.value)} placeholder="name@example.org" /></label>
      <label className="text-sm font-medium">Role<select className={field} value={role} onChange={e => setRole(e.target.value as Role)}>{roles.map(r => <option key={r}>{r}</option>)}</select></label>
      <button className={primary} type="submit" disabled={busy || !valid}><UserPlus aria-hidden="true" size={16} />{busy ? "Issuing…" : "Issue enrollment code"}</button>
      <p className="text-xs text-[var(--muted)]">Exactly three roles exist. Invited members enroll with their own password and stay inactive until an Admin activates them. Admin invitations grant nothing until activated.</p>
    </form>
  );
}
