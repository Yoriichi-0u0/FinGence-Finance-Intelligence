import { workspaceStore } from '@/lib/server/workspace/store';
import { savedDocument } from '@/lib/server/workspace/history';

export const dynamic = 'force-dynamic';
/** One document of a saved run: a 60-second signed link to the private bucket, or the bytes when developing locally. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
    const { id, index } = await params;
    return savedDocument(request, id, index, { store: workspaceStore(), transport: fetch });
}
