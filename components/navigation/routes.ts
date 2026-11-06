import { Bot, Gauge, AlertTriangle, ChartNoAxesCombined, Database, FileBarChart, House, ReceiptText, RefreshCw, ShieldCheck, TrendingUp, type LucideIcon } from 'lucide-react';
import type { M2ClientPrincipal } from '@/lib/ai-ingestion/m2-client-state';
export type NavigationMode = { syntheticDemo?: boolean; management?: boolean; localFinancialConsumers?: boolean; localReconciliation?: boolean; localAdministration?: boolean; role?: M2ClientPrincipal['role'] | null };
export type NavigationItem = { href: string; label: string; description: string; keywords: string; icon: LucideIcon };
const modules: NavigationItem[] = [
    { href: '/', label: 'Dashboard', description: 'Your financial workspace at a glance', keywords: 'dashboard home summary', icon: House },
    { href: '/data', label: 'Data', description: 'Upload and process financial documents', keywords: 'upload import files bank ledger processing', icon: Database },
    { href: '/transactions', label: 'Transactions', description: 'Explore source-backed bank and ledger records', keywords: 'payments receipts records entries', icon: ReceiptText },
    { href: '/reconciliation', label: 'Reconciliation', description: 'Inspect matching outcomes and source evidence', keywords: 'matching reconcile exceptions bank ledger review', icon: RefreshCw },
    { href: '/analytics', label: 'Analytics', description: 'Explore observed financial trends', keywords: 'analysis charts history monthly trends', icon: ChartNoAxesCombined },
    { href: '/forecasting', label: 'Forecasting', description: 'Review the available cash baseline', keywords: 'forecast future projection baseline', icon: TrendingUp },
    { href: '/anomalies', label: 'Anomalies', description: 'Review rule-based anomaly candidates', keywords: 'unusual outlier attention review', icon: AlertTriangle },
    { href: '/reports', label: 'Reports', description: 'Open financial summaries and reporting tools', keywords: 'report export pdf summary', icon: FileBarChart },
];
/** UI discoverability only. Existing pages and APIs remain the access authority. */
export function visibleNavigation(mode: NavigationMode): NavigationItem[] {
    const finance = mode.role === 'Finance';
    const items = modules.map(item => ({ ...item })).filter(item => {
        if (mode.localFinancialConsumers && ['/transactions', '/analytics', '/reports'].includes(item.href)) return finance;
        if (mode.localReconciliation && ['/reconciliation', '/forecasting'].includes(item.href)) return finance;
        if (mode.localAdministration && item.href === '/anomalies') return finance;
        return true;
    });
    if (mode.syntheticDemo) {
        const overview = items.find(item => item.href === '/');
        if (overview) overview.href = '/overview';
    }
    if (mode.localReconciliation && finance) items.push({ href: '/finance-questions', label: 'Finance Questions', description: 'Ask about the selected authorized source', keywords: 'question ask answer finance qa', icon: Bot });
    else if (mode.syntheticDemo) items.push({ href: '/ask', label: 'Finance Q&A', description: 'Ask questions about the current verified processing', keywords: 'question ask answer finance qa', icon: Bot });
    // Existing M5 permits Technical members an operational view and Admins its admin view.
    if (mode.localAdministration && (mode.role === 'Admin' || mode.role === 'Technical (Management)')) items.push({ href: '/admin', label: 'Administration', description: mode.role === 'Admin' ? 'Manage the local organization and memberships' : 'View local operational administration', keywords: 'admin organization members operational', icon: ShieldCheck });
    if (mode.management) items.push({ href:'/management', label:'Management', description:'Server processing jobs, flagged items and pause state', keywords:'management server processing jobs flagged pause', icon:Gauge });
    return items;
}
export function searchNavigation(items: NavigationItem[], query: string): NavigationItem[] {
    const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    return items.filter(item => terms.every(term => `${item.label} ${item.description} ${item.keywords}`.toLowerCase().includes(term)));
}
export function moveNavigationIndex(current: number, key: 'ArrowDown' | 'ArrowUp', count: number) {
    if (!count) return -1;
    return key === 'ArrowDown' ? (current + 1) % count : (current <= 0 ? count - 1 : current - 1);
}

/** Presentation only; this never grants route access or changes runtime permissions. */
export function usesFinancialWorkspaceBackground(pathname: string) {
  return ['/overview', '/data', '/transactions', '/reconciliation', '/analytics', '/forecasting', '/anomalies', '/reports', '/ask', '/finance-questions'].includes(pathname);
}
