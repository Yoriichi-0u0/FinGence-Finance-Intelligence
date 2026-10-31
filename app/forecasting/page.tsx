import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { pocLocalEnabled, pocRequestAllowed } from '@/lib/server/poc-reconciliation/runtime';
import ForecastWorkspace from '@/components/poc-forecast/workspace';
import IllustrativePage from './illustrative';
/** Combined local PoC stack: source-derived, backtested cash baseline. Everywhere else the illustrative page is unchanged. */
export default async function Page() {
    if (pocLocalEnabled()) {
        const h = await headers();
        let request: Request;
        try { request = new Request(`http://${h.get('host') ?? 'invalid'}/forecasting`, { headers: h }); } catch { notFound(); }
        if (!pocRequestAllowed(request)) notFound();
        return <ForecastWorkspace />;
    }
    return <IllustrativePage />;
}
