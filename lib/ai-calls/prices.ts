/**
 * Published per-token prices, USD per million tokens [input, output], for the cost estimate on every logged call.
 * Groq prices as of 2 Nov 2026. A model missing here is logged with no estimate (never a guess): add it when you use it.
 */
export const MODEL_PRICES: Record<string, [number, number]> = {
    'openai/gpt-oss-120b': [0.15, 0.6],
    'openai/gpt-oss-20b': [0.075, 0.3],
    'qwen/qwen3.8-27b': [0.8, 4],
};

export function estimateUsd(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
    const price = MODEL_PRICES[model];
    if (!price || inputTokens === null || outputTokens === null) return null;
    return (inputTokens * price[0] + outputTokens * price[1]) / 1_000_000;
}
