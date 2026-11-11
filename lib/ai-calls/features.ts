/**
 * Every feature that calls an AI model, by slug. The Technical log shows the label; the owner says whose it is.
 * Adding an AI feature? Add one line here (slug: lower-case words joined by hyphens) and pass the slug to withAiCall.
 * See docs/ai-integration/ai-calls.md.
 */
export const AI_FEATURES = {
    'layout-interpretation': { label: 'Document layout reading', owner: 'Yuen Kai' },
    'finance-qa': { label: 'Finance Q&A', owner: 'Yuen Kai' },
    'report-commentary': { label: 'Report commentary', owner: 'Yuen Kai' },
    'ai03-proposal': { label: 'Ingestion experiment (increment 03)', owner: 'Yuen Kai' },
    'ingestion-proposal': { label: 'Ingestion experiment (OpenAI)', owner: 'Yuen Kai' },
    'finance-chat': { label: 'Finance chatbot', owner: 'Jason' },
    'recon-suggest': { label: 'Reconciliation suggestions', owner: 'Celester' },
    'report-explain': { label: 'Report explanation', owner: 'Izzat' },
    'forecast-note': { label: 'Forecast notes', owner: 'Frederick' },
} as const satisfies Record<string, { label: string; owner: string }>;
export type AiFeature = keyof typeof AI_FEATURES;
export const featureLabel = (slug: string) => (AI_FEATURES as Record<string, { label: string } | undefined>)[slug]?.label ?? slug;
