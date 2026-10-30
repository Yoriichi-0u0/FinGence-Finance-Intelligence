import { headers } from 'next/headers';
import { pocLocalEnabled, pocRequestAllowed } from '@/lib/server/poc-reconciliation/runtime';
import ReconciliationWorkspace from '@/components/poc-reconciliation/workspace';
import IllustrativePage from './illustrative';
export default async function Page() {
    if (pocLocalEnabled()) {
        const h = await headers();
        let request: Request;
        try { request = new Request(`http://${h.get('host') ?? 'invalid'}/reconciliation`, { headers: h }); } catch { return <IllustrativePage />; }
        if (pocRequestAllowed(request)) return <ReconciliationWorkspace />;
    }
    return <IllustrativePage />;
}
