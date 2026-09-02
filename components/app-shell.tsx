"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  ChartNoAxesCombined,
  ChevronDown,
  Database,
  FileBarChart,
  House,
  Menu,
  ReceiptText,
  RefreshCw,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";

const navigation = [
  { href: "/", label: "Overview", icon: House },
  { href: "/data", label: "Data", icon: Database },
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/reconciliation", label: "Reconciliation", icon: RefreshCw },
  { href: "/analytics", label: "Analytics", icon: ChartNoAxesCombined },
  { href: "/forecasting", label: "Forecasting", icon: TrendingUp },
  { href: "/anomalies", label: "Anomalies", icon: AlertTriangle },
  { href: "/reports", label: "Reports", icon: FileBarChart },
] as const;

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-3 rounded-lg text-white focus-visible:outline-white"
      aria-label="FinSight overview"
    >
      <span className="grid size-9 place-items-center rounded-lg bg-teal-400/12 text-teal-300">
        <BarChart3 aria-hidden="true" size={23} strokeWidth={2.2} />
      </span>
      <span className="min-w-0">
        <span className="block text-[21px] font-semibold tracking-[-0.03em]">FinSight</span>
        <span className="block truncate text-[11px] text-slate-300">
          AI-Driven Financial Intelligence
        </span>
      </span>
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--navy)] px-3 py-5 text-white">
      <div className="px-2 pb-7">
        <Brand />
      </div>

      <nav aria-label="Primary navigation" className="space-y-1">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`group flex min-h-11 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors ${
                active
                  ? "bg-teal-500/25 text-white ring-1 ring-inset ring-teal-300/20"
                  : "text-slate-200 hover:bg-white/7 hover:text-white"
              }`}
            >
              <Icon
                aria-hidden="true"
                size={19}
                strokeWidth={active ? 2.2 : 1.8}
                className={active ? "text-teal-200" : "text-slate-300 group-hover:text-white"}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/14 px-2 pt-5">
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-lg p-1 text-left hover:bg-white/7"
          aria-label="Open company workspace menu"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full border border-teal-300/50 text-teal-200">
            <Building2 aria-hidden="true" size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">SAIC</span>
            <span className="block truncate text-xs text-slate-300">Finance Workspace</span>
            <span className="mt-0.5 block text-xs text-slate-400">August 2026</span>
          </span>
          <ChevronDown aria-hidden="true" size={16} className="text-slate-300" />
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-dvh bg-[var(--canvas)] lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh lg:block">
        <Sidebar />
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--border)] bg-white/96 px-4 backdrop-blur-sm lg:hidden">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="grid size-11 place-items-center rounded-lg text-[var(--ink)] hover:bg-slate-100"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
            >
              <Menu aria-hidden="true" size={23} />
            </button>
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-[-0.02em]">
              <Sparkles aria-hidden="true" size={20} className="text-[var(--teal)]" />
              FinSight
            </Link>
          </div>
          <span
            className="grid size-9 place-items-center rounded-full bg-[var(--teal-soft)] text-sm font-semibold text-[var(--teal-dark)]"
            aria-label="Signed in as A M"
          >
            AM
          </span>
        </header>

        <main className="mx-auto min-h-dvh w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-7">
          {children}
        </main>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          />
          <aside className="relative h-full w-[min(82vw,310px)] shadow-2xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 z-10 grid size-10 place-items-center rounded-lg text-slate-200 hover:bg-white/10 hover:text-white"
              aria-label="Close navigation"
            >
              <X aria-hidden="true" size={21} />
            </button>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}
    </div>
  );
}
