import { liveDeps, signOut } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
export const POST = (request: Request) => signOut(request, liveDeps());
