import { budgetStore } from '@/lib/server/ai/budget';
import { qaModel } from '@/lib/server/ai/grounded-qa';
import { groqConfiguredFor } from '@/lib/server/ai/groq';
import { assertObsidianDemoAccess } from '@/lib/server/obsidian-demo/vault';
import { noStoreJson } from '@/lib/server/ai/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        assertObsidianDemoAccess(request);
        return noStoreJson({ groqAvailable: Boolean(groqConfiguredFor('finance-chat') && budgetStore()), modelConfigured: qaModel() });
    } catch { return noStoreJson({ code: 'UNAVAILABLE' }, 404); }
}
