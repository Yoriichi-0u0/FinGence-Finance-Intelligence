import { liveDeps, preferences, preferencesChange } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
/** Any signed-in member: their own Overview layout. */
export const GET = (request: Request) => preferences(request, liveDeps());
export const PUT = (request: Request) => preferencesChange(request, liveDeps());
