import { liveDeps, session } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => session(request, liveDeps());
