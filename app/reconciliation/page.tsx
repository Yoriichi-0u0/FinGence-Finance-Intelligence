import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { pocLocalEnabled, pocRequestAllowed } from '@/lib/server/poc-reconciliation/runtime';
import ReconciliationWorkspace from '@/components/poc-reconciliation/workspace';
import IllustrativePage from './illustrative';
import { DemoGate } from '@/components/demo/gate';
export default async function Page() {
    if (pocLocalEnabled()) {
        const h = await headers();
        let request: Request;
        try { request = new Request(`http://${h.get('host') ?? 'invalid'}/reconciliation`, { headers: h }); } catch { notFound(); }
        if (!pocRequestAllowed(request)) notFound();
        return <ReconciliationWorkspace />;
    }
    return <DemoGate view="reconciliation" illustrative={<IllustrativePage />} />;
}
