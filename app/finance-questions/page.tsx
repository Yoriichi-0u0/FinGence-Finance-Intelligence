import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { pocLocalEnabled, pocRequestAllowed } from '@/lib/server/poc-reconciliation/runtime';
import FinanceQuestionsWorkspace from '@/components/poc-finance-qa/workspace';
export const metadata = { title: 'Finance questions' };
/** Combined local PoC stack only; there is no hosted or illustrative version of this page. */
export default async function Page() {
    if (!pocLocalEnabled()) notFound();
    const h = await headers();
    let request: Request;
    try { request = new Request(`http://${h.get('host') ?? 'invalid'}/finance-questions`, { headers: h }); } catch { notFound(); }
    if (!pocRequestAllowed(request)) notFound();
    return <FinanceQuestionsWorkspace />;
}
