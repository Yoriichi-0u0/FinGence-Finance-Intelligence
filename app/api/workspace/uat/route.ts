import { liveDeps, uat, uatChange } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
/** Any signed-in member: their own Testing checklist answers. */
export const GET = (request: Request) => uat(request, liveDeps());
export const PUT = (request: Request) => uatChange(request, liveDeps());
