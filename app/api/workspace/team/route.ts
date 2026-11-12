import { liveDeps, team, teamChange } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => team(request, liveDeps());
export const POST = (request: Request) => teamChange(request, liveDeps());
