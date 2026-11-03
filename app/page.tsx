import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { DemoGate } from '@/components/demo/gate';
import { OverviewTheme } from '@/components/overview/theme';
import LocalOverview from '@/components/overview/local';
import { pocLocalEnabled, pocRequestAllowed } from '@/lib/server/poc-reconciliation/runtime';

export default async function OverviewPage() {
    if (pocLocalEnabled()) {
        const h = await headers();
        let request: Request;
        try { request = new Request(`http://${h.get('host') ?? 'invalid'}/`, { headers: h }); } catch { notFound(); }
        if (!pocRequestAllowed(request)) notFound();
        return <OverviewTheme><LocalOverview /></OverviewTheme>;
    }
    return <OverviewTheme><DemoGate view="overview" /></OverviewTheme>;
}
