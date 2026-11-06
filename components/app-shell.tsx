"use client";

import Image from "next/image";
import workspaceStyles from "./demo/workspace-final.module.css";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NavigationProvider, useNavigationItems } from "@/components/navigation/context";
import { usesFinancialWorkspaceBackground } from "@/components/navigation/routes";
import { useTheme } from "@/components/overview/theme";
import { DemoProcessingProvider } from "@/components/demo/context";
import { Building2, Menu, Pin, PinOff, X } from "lucide-react";

function Sidebar({ onNavigate, desktop = false, pinned = false, onPin, localFinancialConsumers = false, syntheticDemo = false, serverJobs = false }: {
  onNavigate?: () => void; desktop?: boolean; pinned?: boolean; onPin?: () => void;
  localFinancialConsumers?: boolean; syntheticDemo?: boolean; serverJobs?: boolean;
}) {
  const pathname = usePathname(), items = useNavigationItems();
  const workspace = localFinancialConsumers ? 'Synthetic organization' : syntheticDemo ? 'Synthetic demo' : 'SAIC';
  return <div className={`shell-sidebar${desktop ? ' shell-sidebar-desktop' : ''}`}>
    <div className="shell-brand-row">
      <Link href="/" className="shell-brand" aria-label="FinGence home" onClick={onNavigate}>
        <Image src="/branding/FinGence_Logo_96.png" width={34} height={34} alt="" unoptimized />
        <span className="shell-sidebar-label"><strong>FinGence</strong><small>Financial Intelligence</small></span>
      </Link>
    </div>
    {desktop && <div className="shell-pin-row"><button type="button" onClick={onPin} className="shell-pin" aria-label={pinned ? 'Unpin sidebar' : 'Pin sidebar expanded'} aria-pressed={pinned} title={pinned ? 'Unpin sidebar' : 'Pin sidebar expanded'}>{pinned ? <PinOff size={16} aria-hidden="true" /> : <Pin size={16} aria-hidden="true" />}<span className="shell-sidebar-label">{pinned ? 'Unpin navigation' : 'Pin navigation'}</span></button></div>}
    <nav aria-label="Primary navigation" className="shell-navigation" tabIndex={0}>
      {items.map(item => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return <Link key={item.href} href={item.href} onClick={onNavigate} aria-label={item.label} title={item.label} aria-current={active ? 'page' : undefined} className="shell-nav-link">
          <item.icon size={20} strokeWidth={active ? 2.1 : 1.7} aria-hidden="true" />
          <span className="shell-sidebar-label">{item.label}</span>
        </Link>;
      })}
    </nav>
    <div className="shell-workspace" aria-label={`${workspace} workspace`} title={workspace}>
      <span className="shell-workspace-icon"><Building2 size={19} aria-hidden="true" /></span>
      <span className="shell-sidebar-label"><strong>{workspace}</strong><small>{localFinancialConsumers ? 'Local experimental workspace' : syntheticDemo ? serverJobs ? 'No sign-in · server processing' : 'No sign-in · browser only' : 'Finance workspace'}</small><small>{localFinancialConsumers ? 'Hosted access disabled' : syntheticDemo ? 'Use fictional data only' : 'Illustrative prototype'}</small></span>
    </div>
  </div>;
}

export function AppShell({ children, localFinancialConsumers = false, localAdministration = false, localReconciliation = false, syntheticDemo = false, aiGateway = false, serverJobs = false, management = false }: { children: React.ReactNode; localFinancialConsumers?: boolean; localAdministration?: boolean; localReconciliation?: boolean; syntheticDemo?: boolean; aiGateway?: boolean; serverJobs?: boolean; management?: boolean }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const theme = useTheme();
  const pathname = usePathname();

  if (pathname === "/sign-in" || pathname === "/sign-up") return <div data-shell-theme={theme}>{children}</div>;

  return (
    <DemoProcessingProvider enabled={syntheticDemo} aiGateway={aiGateway} serverJobs={serverJobs}>
    <NavigationProvider mode={{ syntheticDemo, localFinancialConsumers, localAdministration, localReconciliation, management }}>
    <div data-shell-theme={theme} data-sidebar-pinned={pinned} className={`${(pathname === "/" || pathname === "/overview") ? "overview-shell " : ""}${usesFinancialWorkspaceBackground(pathname) ? "financial-workspace " : ""}app-layout min-h-dvh bg-[var(--canvas)] print:block ${usesFinancialWorkspaceBackground(pathname) ? workspaceStyles.theme : ""}`}>
      <aside className="desktop-sidebar-slot hidden lg:block print:hidden" aria-label="Desktop navigation">
        <Sidebar desktop pinned={pinned} onPin={() => setPinned(value => !value)} localFinancialConsumers={localFinancialConsumers} syntheticDemo={syntheticDemo} serverJobs={serverJobs} />
      </aside>

      <div className="min-w-0">
        <header className="shell-mobile-header sticky top-0 z-30 flex h-16 print:hidden items-center justify-between border-b px-4 backdrop-blur-sm lg:hidden">
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
            <Link href="/" aria-label="FinGence home" className="flex items-center gap-2 font-semibold tracking-[-0.02em]">
              <Image src="/branding/FinGence_Logo_96.png" width={28} height={28} alt="" unoptimized className="size-7 shrink-0 rounded-md" />
              FinGence
            </Link>
          </div>
          <span
            className="grid size-9 place-items-center rounded-full bg-[var(--teal-soft)] text-sm font-semibold text-[var(--teal-dark)]"
            aria-label={localFinancialConsumers ? "Local environment indicator, not account identity" : syntheticDemo ? "Synthetic demo, no sign-in" : "Demonstration avatar — authentication not implemented"}
          >
            {localFinancialConsumers ? "LC" : syntheticDemo ? "SD" : "AM"}
          </span>
        </header>

        <main className="shell-main mx-auto min-h-dvh w-full max-w-[1600px] px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-7">
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
              className="shell-close absolute right-3 top-4 z-10 grid size-10 place-items-center rounded-lg"
              aria-label="Close navigation"
            >
              <X aria-hidden="true" size={21} />
            </button>
            <Sidebar localFinancialConsumers={localFinancialConsumers} syntheticDemo={syntheticDemo} serverJobs={serverJobs} onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}
    </div>
    </NavigationProvider>
    </DemoProcessingProvider>
  );
}
