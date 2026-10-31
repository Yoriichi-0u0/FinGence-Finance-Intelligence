import { notFound } from 'next/navigation';
import { syntheticDemoEnabled } from '@/lib/server/demo/mode';
import { DemoGate } from '@/components/demo/gate';
export const metadata = { title: 'Finance Q&A' };
/** Browser-only rule-based Q&A over the synthetic demo context. Local stacks use /finance-questions instead. */
export default function Page() { if (!syntheticDemoEnabled()) notFound(); return <DemoGate view="ask" />; }
