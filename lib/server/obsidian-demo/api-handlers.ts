import { z } from 'zod';
import { sendConsentedChat, ConsentChatError, explainChatError, type ChatResponse } from './consent-chat';
import { createChatPreview, DEMO_SESSION_COOKIE, demoSessionId, explainChatError as explainPreviewError, newDemoSessionId, type PreviewResponse } from './consent-chat';
import { boundedJson, noStoreJson } from '../ai/request';

const previewBodySchema = z.object({ question: z.string().min(1).max(300) }).strict();
const sendBodySchema = z.object({ previewId: z.string().uuid(), payloadHash: z.string().regex(/^[a-f0-9]{64}$/), consent: z.literal(true) }).strict();

export function createPreviewHandler(preview = createChatPreview) {
    return async function POST(request: Request) {
        const read = await boundedJson(request, 2048);
        if ('refusal' in read) return read.refusal;
        const parsed = previewBodySchema.safeParse(read.body);
        if (!parsed.success) return noStoreJson({ status: 'ERROR', groqUsed: false, model: null, citedSections: [], explanation: 'Enter a question of 300 characters or fewer.' }, 400);
        const sessionId = demoSessionId(request) ?? newDemoSessionId();
        try {
            const previewResult: PreviewResponse = await preview(request, parsed.data.question, sessionId);
            const response = noStoreJson(previewResult);
            response.headers.set('Set-Cookie', `${DEMO_SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=600`);
            return response;
        } catch (error) {
            const code = error instanceof Error ? error.message : 'CHAT_PREVIEW_FAILED';
            const status = code === 'OBSIDIAN_DEMO_DISABLED' || code === 'OBSIDIAN_DEMO_LOOPBACK_REQUIRED' ? 404
                : code.startsWith('QUESTION_REFUSED_') || code === 'SOURCE_EVIDENCE_UNAVAILABLE' ? 422 : code === 'QUESTION_INVALID' ? 400 : 503;
            return noStoreJson({ status: 'ERROR', groqUsed: false, model: null, citedSections: [], code, explanation: explainPreviewError(code) }, status);
        }
    };
}

export function createSendHandler(send = sendConsentedChat) {
    return async function POST(request: Request) {
        const read = await boundedJson(request, 2048);
        if ('refusal' in read) return read.refusal;
        const parsed = sendBodySchema.safeParse(read.body);
        if (!parsed.success) return noStoreJson({ status: 'ERROR', groqUsed: false, model: null, citedSections: [], explanation: 'A valid preview ID, preview hash, and explicit consent are required.' }, 400);
        try {
            const result: ChatResponse = await send(request, parsed.data);
            return noStoreJson(result);
        } catch (error) {
            const code = error instanceof ConsentChatError ? error.code : error instanceof Error ? error.message : 'CHAT_SEND_FAILED';
            const groqUsed = error instanceof ConsentChatError && error.groqUsed;
            const model = error instanceof ConsentChatError ? error.model : null;
            const status = code === 'OBSIDIAN_DEMO_DISABLED' || code === 'OBSIDIAN_DEMO_LOOPBACK_REQUIRED' ? 404
                : code === 'CONSENT_REQUIRED' || code === 'PREVIEW_REQUIRED' ? 400
                    : code === 'GROQ_NOT_CONFIGURED' || code === 'BUDGET_UNAVAILABLE' ? 503
                        : code.includes('EXPIRED') || code.includes('UNAVAILABLE') || code.includes('SESSION') ? 410
                            : code.includes('MISMATCH') ? 409
                                : code.includes('RATE_LIMITED') || code.includes('LIMIT') ? 429
                                    : code.startsWith('QUESTION_REFUSED_') ? 422 : 502;
            return noStoreJson({ status: 'ERROR', groqUsed, model, citedSections: [], code, explanation: explainChatError(code) }, status);
        }
    };
}
