import { workspaceStore } from '@/lib/server/workspace/store';
import { deleteSaved, openSaved } from '@/lib/server/workspace/history';

export const dynamic = 'force-dynamic';
const deps = () => ({ store: workspaceStore(), transport: fetch });
type Context = { params: Promise<{ id: string }> };
/** One saved run, to reopen it (its owner, or an Admin and above). */
export async function GET(request: Request, { params }: Context) { return openSaved(request, (await params).id, deps()); }
/** Delete a saved run (its owner, or an Admin and above). */
export async function DELETE(request: Request, { params }: Context) { return deleteSaved(request, (await params).id, deps()); }
