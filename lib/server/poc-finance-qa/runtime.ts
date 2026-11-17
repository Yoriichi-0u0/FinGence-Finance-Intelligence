import 'server-only';
import { pocLocalEnabled } from '../poc-reconciliation/runtime';
import { pocRuntime } from '../poc-anomalies/runtime';
import { createPocFinanceQa } from './service';
import { createFinanceGroqChat } from './groq-chat';

const instances = new WeakMap<object, { questions: ReturnType<typeof createPocFinanceQa>; chat: ReturnType<typeof createFinanceGroqChat> }>();

export async function financeQaRuntime() {
    if (!pocLocalEnabled()) throw Error('LOCAL_ONLY');
    const base = await pocRuntime();
    let instance = instances.get(base.database);
    if (!instance) {
        const questions = createPocFinanceQa(base.database);
        instance = { questions, chat: createFinanceGroqChat({ resolveFacts: questions.factsForChat }) };
        instances.set(base.database, instance);
    }
    return { ...base, ...instance };
}

