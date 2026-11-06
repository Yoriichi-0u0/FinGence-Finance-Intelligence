import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { syntheticDemoEnabled } from '@/lib/server/demo/mode';
import { DemoGate } from '@/components/demo/gate';
import { OverviewTheme } from '@/components/overview/theme';
/** Public browser workspace only. Authenticated PoC keeps its original root and access checks. */
export default async function Page() {
    await connection();
    if (!syntheticDemoEnabled()) notFound();
    return <OverviewTheme><DemoGate view="overview" /></OverviewTheme>;
}
