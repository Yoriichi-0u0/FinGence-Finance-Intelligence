import { liveDeps, signIn } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
export const POST = (request: Request) => signIn(request, liveDeps());
