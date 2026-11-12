import { changePassword, liveDeps } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
export const POST = (request: Request) => changePassword(request, liveDeps());
