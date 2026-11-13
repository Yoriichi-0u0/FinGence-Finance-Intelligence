import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { DemoGate } from '@/components/demo/gate';
import FinanceQuestionsWorkspace from '@/components/poc-finance-qa/workspace';
import { syntheticDemoEnabled } from '@/lib/server/demo/mode';
import { pocLocalEnabled, pocRequestAllowed } from '@/lib/server/poc-reconciliation/runtime';
import { assertObsidianDemoAccess, obsidianDemoModeEnabled } from '@/lib/server/obsidian-demo/vault';
import ObsidianDemoChat from '@/components/obsidian-demo/chat';
import { selectChatbotRuntime } from '@/lib/server/obsidian-demo/chatbot-mode';

export const metadata = { title: 'Finance chatbot' };

/** One entry point; the opt-in local mode selects Groq over verified uploaded data. */
export default async function Page() {
    const runtime = selectChatbotRuntime({
        poc: pocLocalEnabled(),
        pocGroq: process.env.FINGENCE_POC_GROQ === '1',
        obsidian: obsidianDemoModeEnabled(),
        synthetic: syntheticDemoEnabled(),
    });
    if (runtime === 'poc' || runtime === 'poc-groq') {
        const h = await headers();
        let request: Request;
        try { request = new Request('http://' + (h.get('host') ?? 'invalid') + '/chatbot', { headers: h }); } catch { notFound(); }
        if (!pocRequestAllowed(request)) notFound();
        return <FinanceQuestionsWorkspace groqChat={runtime === 'poc-groq'} />;
    }
    if (runtime === 'obsidian-demo') {
        const h = await headers();
        let request: Request;
        try { request = new Request('http://' + (h.get('host') ?? 'invalid') + '/chatbot', { headers: h }); } catch { notFound(); }
        try { assertObsidianDemoAccess(request); } catch { notFound(); }
        return <ObsidianDemoChat />;
    }
    if (runtime === 'synthetic-demo') return <DemoGate view="ask" />;
    notFound();
}

