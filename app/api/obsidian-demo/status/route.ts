import { budgetStore } from '@/lib/server/ai/budget';
import { qaModel } from '@/lib/server/ai/grounded-qa';
import { groqKeys } from '@/lib/server/ai/groq';
import { assertObsidianDemoAccess } from '@/lib/server/obsidian-demo/vault';
import { noStoreJson } from '@/lib/server/ai/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        assertObsidianDemoAccess(request);
        return noStoreJson({ groqAvailable: Boolean(groqKeys().length && budgetStore()), modelConfigured: qaModel() });
    } catch { return noStoreJson({ code: 'UNAVAILABLE' }, 404); }
}
