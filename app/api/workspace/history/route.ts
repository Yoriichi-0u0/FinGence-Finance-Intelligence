import { workspaceStore } from '@/lib/server/workspace/store';
import { listHistory, saveBrowserRun } from '@/lib/server/workspace/history';

export const dynamic = 'force-dynamic';
const deps = () => ({ store: workspaceStore(), transport: fetch });
/** The signed-in person's saved runs (?scope=all: everyone's, Admin and above). */
export const GET = (request: Request) => listHistory(request, deps());
/** Save a run processed in this browser (server jobs save themselves). */
export const POST = (request: Request) => saveBrowserRun(request, deps());
