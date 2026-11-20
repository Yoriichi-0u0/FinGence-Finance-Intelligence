import { liveDeps, uatResults } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
/** Admin and above: every tester's Testing checklist answers in their organization. */
export const GET = (request: Request) => uatResults(request, liveDeps());
