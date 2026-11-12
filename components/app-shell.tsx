"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { DemoProcessingProvider } from "@/components/demo/context";
import { DemoBanner } from "@/components/demo/banner";
import { ThemeSwitch } from "@/components/theme-switch";
import { atLeast, useWorkspace, WorkspaceProvider } from "@/components/workspace/context";
import { OutsideView, ViewingAs } from "@/components/workspace/view-switch";
import { AccountMenu } from "@/components/workspace/account-menu";
import { ResizeHandle, useSidebarLayout } from "@/components/sidebar-layout";
import { AuthLayout } from "@/components/workspace/access";
import {
  Activity,
  AlertTriangle,
  LogIn,
  Users,
  ChartNoAxesCombined,
  Ellipsis,
  Database,
  FileBarChart,
  Gauge,
  House,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  MessageSquareText,
  ReceiptText,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: typeof House; short?: string };
const workspace: NavItem[] = [
  { href: "/", label: "Overview", icon: House },
  { href: "/data", label: "Data", icon: Database, short: "Data" },
];
const results: NavItem[] = [
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/reconciliation", label: "Reconciliation", icon: RefreshCw },
  { href: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { href: "/forecasting", label: "Forecasting", icon: TrendingUp },
  { href: "/anomalies", label: "Anomalies", icon: AlertTriangle },
  { href: "/reports", label: "Reports", icon: FileBarChart },
];
const navigation = [...workspace, ...results];
// Local M5 only; the page itself enforces role-scoped access on the server.
const administration = { href: "/admin", label: "Administration", icon: ShieldCheck };
// Local combined PoC only; the page and API are absent elsewhere.
const financeQuestions = { href: "/finance-questions", label: "Finance questions", icon: MessageSquareText };
// Browser-only synthetic demo: rule-based answers over the current processing context.
const demoQuestions = { href: "/ask", label: "Finance Q&A", icon: MessageSquareText };
// Management (Technical): server processing jobs, flagged items and the pause switch; absent unless the server enables it.
const management = { href: "/management", label: "Management", icon: Gauge };
// Hosted workspace (SAIC only): every role uses the finance pages; Admins and Superadmins also get Team and Operations.
const operationsItem: NavItem = { href: "/operations", label: "Operations", icon: Activity };
const teamItem: NavItem = { href: "/team", label: "Team", icon: Users };
const logItem: NavItem = { href: "/log", label: "Technical log", icon: ScrollText };

function Brand({ compact = false, rail = false }: { compact?: boolean; rail?: boolean }) {
  return (
    <Link
      href="/"
      className="flex min-w-0 items-center gap-3 rounded-xl text-white focus-visible:outline-white"
      aria-label="FinGence overview"
    >
      <Image src="/branding/FinGence_Logo_96.png" width={40} height={40} alt="" unoptimized className={`${compact ? "size-8" : "size-10"} shrink-0 rounded-xl ring-1 ring-white/10`} />
      {rail ? null : <span className="min-w-0">
        <span className={`block truncate font-semibold tracking-[-0.03em] ${compact ? "text-[17px]" : "text-[21px] leading-6"}`}>FinGence</span>
        {compact ? null : <span className="block truncate text-[11px] text-[var(--rail-muted)]">Finance + Intelligence</span>}
      </span>}
    </Link>
  );
}

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

function NavGroup({ label, items, pathname, onNavigate, rail = false }: { label: string; items: NavItem[]; pathname: string; onNavigate?: () => void; rail?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      {rail ? <p className="sr-only">{label}</p> : <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--rail-muted)]/80">{label}</p>}
      <ul className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                aria-label={rail ? item.label : undefined}
                title={rail ? item.label : undefined}
                className={`group relative flex min-h-10 items-center gap-3 rounded-xl text-[14px] font-medium transition-colors ${rail ? "justify-center px-0" : "px-3"} ${
                  active ? "bg-white/[0.09] text-white" : "text-[var(--rail-ink)]/80 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {active ? <span aria-hidden="true" className="brand-gradient absolute inset-y-2 left-0 w-[3px] rounded-full" /> : null}
                <Icon
                  aria-hidden="true"
                  size={18}
                  strokeWidth={active ? 2.2 : 1.8}
                  className={active ? "text-[#93bdff]" : "text-[var(--rail-muted)] group-hover:text-white"}
                />
                {rail ? null : item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type ShellFlags = { localFinancialConsumers?: boolean; localAdministration?: boolean; localReconciliation?: boolean; syntheticDemo?: boolean; managementConsole?: boolean; serverJobs?: boolean };

function Sidebar({ onNavigate, rail = false, onToggle, localFinancialConsumers = false, localAdministration = false, localReconciliation = false, syntheticDemo = false, managementConsole = false, serverJobs = false }: ShellFlags & { onNavigate?: () => void; rail?: boolean; onToggle?: () => void }) {
  const pathname = usePathname();
  // Navigation follows the role being viewed ("Switch view" may preview a lower one).
  const session = useWorkspace(), admin = atLeast(session.viewRole ?? undefined, "ADMIN");
  const ask = [...(localReconciliation ? [financeQuestions] : []), ...(syntheticDemo ? [demoQuestions] : [])];
  const technical = [...(localAdministration ? [administration] : []), ...(managementConsole ? [management] : [])];

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--rail)] text-white">
      {/* The glow is clipped on its own, so the account menu can open beside a collapsed rail. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 size-64 rounded-full bg-[#2563eb]/25 blur-3xl" />
        <div className="absolute -bottom-28 -right-20 size-64 rounded-full bg-[#22d3ee]/10 blur-3xl" />
      </div>
      <div className={`relative flex min-w-0 items-center gap-2 pb-6 pt-6 ${rail ? "flex-col px-2" : "justify-between pl-5 pr-3"}`}>
        <Brand rail={rail} />
        {onToggle ? (
          <button type="button" onClick={onToggle} aria-label={rail ? "Expand the sidebar" : "Collapse the sidebar"} title={`${rail ? "Expand" : "Collapse"} the sidebar ( [ )`}
            className="grid size-9 shrink-0 place-items-center rounded-lg text-[var(--rail-muted)] hover:bg-white/10 hover:text-white">
            {rail ? <PanelLeftOpen aria-hidden="true" size={18} /> : <PanelLeftClose aria-hidden="true" size={18} />}
          </button>
        ) : null}
      </div>

      <nav aria-label="Primary navigation" className={`thin-scrollbar relative min-h-0 flex-1 space-y-5 overflow-y-auto pb-4 ${rail ? "px-2" : "px-3"}`}>
        <NavGroup label="Workspace" items={workspace} pathname={pathname} onNavigate={onNavigate} rail={rail} />
        <NavGroup label="Results" items={results} pathname={pathname} onNavigate={onNavigate} rail={rail} />
        <NavGroup label="Ask" items={ask} pathname={pathname} onNavigate={onNavigate} rail={rail} />
        <NavGroup label="Technical team" items={technical} pathname={pathname} onNavigate={onNavigate} rail={rail} />
        {admin ? <NavGroup label="Administration" items={[teamItem, logItem, operationsItem]} pathname={pathname} onNavigate={onNavigate} rail={rail} /> : null}
      </nav>

      <div className={`relative space-y-3 border-t border-[var(--rail-line)] pb-5 pt-4 ${rail ? "px-2" : "px-4"}`}>
        <AccountMenu compact={rail} />
        {rail ? null : session.enabled && session.session ? null : session.enabled && !session.loading ? (
          <Link href="/sign-in" onClick={onNavigate} className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/[0.06] hover:bg-white/[0.07]">
            <LogIn aria-hidden="true" size={18} className="shrink-0 text-[#93bdff]" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">Sign in</span>
              <span className="block truncate text-xs text-[var(--rail-muted)]">SAIC users only</span>
            </span>
          </Link>
        ) : (
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/[0.06]">
            <span aria-hidden="true" className="mt-1 size-2 shrink-0 rounded-full bg-[#34d399] shadow-[0_0_0_3px_rgb(52_211_153/0.18)]" />
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold">{localFinancialConsumers ? "Synthetic organization" : syntheticDemo ? "Synthetic demo" : "SAIC"}</span>
              <span className="block text-xs text-[var(--rail-muted)]">{localFinancialConsumers ? "Local experimental workspace" : syntheticDemo ? serverJobs ? "No sign-in · server processing" : "No sign-in · browser only" : "Finance Workspace"}</span>
              <span className="mt-0.5 block text-xs text-[var(--rail-muted)]/80">{localFinancialConsumers ? "Hosted access disabled" : syntheticDemo ? "Use fictional data only" : "August 2026"}</span>
            </span>
          </div>
        )}
        {rail || (session.enabled && session.session) ? null : <ThemeSwitch />}
      </div>
    </div>
  );
}

/** Phone navigation: the four most used pages in a bottom bar, and everything else behind "More". */
function BottomBar({ onMore, syntheticDemo }: { onMore: () => void; syntheticDemo: boolean }) {
  const pathname = usePathname();
  const items: NavItem[] = [
    { href: "/", label: "Overview", icon: House },
    { href: "/data", label: "Data", icon: Database },
    { href: "/reconciliation", label: "Reconcile", icon: RefreshCw },
    syntheticDemo ? { href: "/ask", label: "Ask", icon: MessageSquareText } : { href: "/reports", label: "Reports", icon: FileBarChart },
  ];
  const elsewhere = !items.some((item) => isActive(pathname, item.href));
  return (
    <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)]/92 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden print:hidden">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon;
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              <Link href={item.href} aria-current={active ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${active ? "text-[var(--brand)]" : "text-[var(--muted)]"}`}>
                <Icon aria-hidden="true" size={20} strokeWidth={active ? 2.3 : 1.8} />
                {item.label}
              </Link>
            </li>
          );
        })}
        <li>
          <button type="button" onClick={onMore} className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${elsewhere ? "text-[var(--brand)]" : "text-[var(--muted)]"}`} aria-label="More pages">
            <Ellipsis aria-hidden="true" size={20} />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** While previewing a Finance user, the Admin pages show what that person would get instead. */
function ShellPage({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const { session, viewRole } = useWorkspace();
  const page = pathname === "/team" ? "Team" : pathname === "/operations" ? "Operations" : pathname === "/log" ? "The Technical log" : null;
  if (page && session && viewRole && !atLeast(viewRole, "ADMIN")) return <OutsideView page={page} />;
  return <>{children}</>;
}

export function AppShell({ children, localFinancialConsumers = false, localAdministration = false, localReconciliation = false, syntheticDemo = false, aiGateway = false, serverJobs = false, management: managementConsole = false, workspace: workspaceEnabled = false }: { children: React.ReactNode; localFinancialConsumers?: boolean; localAdministration?: boolean; localReconciliation?: boolean; syntheticDemo?: boolean; aiGateway?: boolean; serverJobs?: boolean; management?: boolean; workspace?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const sidebar = useSidebarLayout();
  const flags = { localFinancialConsumers, localAdministration, localReconciliation, syntheticDemo, managementConsole, serverJobs };
  const current = [...navigation, financeQuestions, demoQuestions, administration, management, operationsItem, teamItem, logItem].find((item) => isActive(pathname, item.href));

  // Signing in and joining stand on their own page, without the navigation a visitor cannot use yet.
  if (workspaceEnabled && (pathname === "/sign-in" || pathname === "/join")) return <WorkspaceProvider enabled><AuthLayout>{children}</AuthLayout></WorkspaceProvider>;

  return (
    <WorkspaceProvider enabled={workspaceEnabled}>
    <DemoProcessingProvider enabled={syntheticDemo} aiGateway={aiGateway} serverJobs={serverJobs}>
    <div className="min-h-dvh bg-[var(--canvas)] lg:grid lg:grid-cols-[var(--sidebar)_minmax(0,1fr)] print:block" style={{ "--sidebar": `${sidebar.shown}px` } as React.CSSProperties}>
      <aside className="sticky top-0 z-30 hidden h-dvh lg:block print:hidden">
        <Sidebar {...flags} rail={sidebar.collapsed} onToggle={sidebar.toggle} />
        {sidebar.collapsed ? null : <ResizeHandle width={sidebar.width} onWidth={sidebar.setWidth} />}
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-white/5 bg-[var(--rail)] px-3 text-white lg:hidden print:hidden">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="grid size-10 place-items-center rounded-xl text-white/90 hover:bg-white/10"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
            >
              <Menu aria-hidden="true" size={22} />
            </button>
            <Brand compact />
          </div>
          {current ? <span className="truncate rounded-full bg-white/[0.08] px-3 py-1 text-xs font-medium text-white/90">{current.label}</span> : null}
        </header>

        <main className="mx-auto min-h-dvh w-full max-w-[1480px] px-4 pb-28 pt-5 sm:px-6 sm:pt-6 lg:pb-10 xl:px-10 xl:pt-8">
          {["/sign-in", "/join", "/team", "/operations", "/log"].includes(pathname) ? null : syntheticDemo ? <DemoBanner /> : !(localReconciliation && ["/reconciliation", "/forecasting", "/finance-questions"].includes(pathname)) && !(localFinancialConsumers && ["/transactions", "/analytics", "/reports"].includes(pathname)) && !(localAdministration && ["/admin", "/enroll", "/anomalies"].includes(pathname)) && !pathname.startsWith("/data") && pathname !== "/ai-ingestion" && pathname !== "/management" && pathname !== "/ai-ingestion/live" && pathname !== "/ai-ingestion/v2-i1" && pathname !== "/ai-ingestion/synthetic-financial" && <aside className="mb-5 rounded-xl border border-[var(--warn-line)] bg-[var(--warn-soft)] p-4 text-sm text-[var(--warn-ink)]" aria-label="Illustrative page notice">
            <strong>Illustrative prototype page.</strong> Values and interactions here use example data, not your uploaded financial records. <Link href="/data" className="font-semibold underline">Open Data for the live ingestion → C1 → analytics workflow.</Link>
          </aside>}
          <ViewingAs />
          <ShellPage pathname={pathname}>{children}</ShellPage>
        </main>
      </div>

      <BottomBar onMore={() => setMobileOpen(true)} syntheticDemo={syntheticDemo} />

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button
            type="button"
            className="absolute inset-0 bg-[#050816]/60 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <aside className="rise-in relative h-full w-[min(86vw,320px)] shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-5 z-10 grid size-10 place-items-center rounded-xl text-white/80 hover:bg-white/10 hover:text-white"
              aria-label="Close navigation"
            >
              <X aria-hidden="true" size={21} />
            </button>
            <Sidebar {...flags} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}
    </div>
    </DemoProcessingProvider>
    </WorkspaceProvider>
  );
}
