import { createSendHandler } from '@/lib/server/obsidian-demo/api-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = createSendHandler();
