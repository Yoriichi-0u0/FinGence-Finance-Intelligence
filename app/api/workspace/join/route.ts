import { liveDeps, join } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
export const POST = (request: Request) => join(request, liveDeps());
