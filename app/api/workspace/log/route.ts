import { liveDeps, technicalLog } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
/** Admin and above: the Technical log. Run details come from /api/workspace/operations?run=<id>. */
export const GET = (request: Request) => technicalLog(request, liveDeps());
