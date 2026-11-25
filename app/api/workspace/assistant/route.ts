import { assistantSettings, assistantSettingsChange, liveDeps } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
/** Any signed-in member: the name they gave their assistant. */
export const GET = (request: Request) => assistantSettings(request, liveDeps());
export const PUT = (request: Request) => assistantSettingsChange(request, liveDeps());
