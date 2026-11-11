import { liveDeps, operations, operationsChange } from '@/lib/server/workspace/handlers';

export const dynamic = 'force-dynamic';
export const GET = (request: Request) => operations(request, liveDeps());
export const POST = (request: Request) => operationsChange(request, liveDeps());
