export type ChatbotRuntime = 'poc-groq' | 'poc' | 'obsidian-demo' | 'synthetic-demo' | 'not-found';

/** The consent-based uploaded-data chat is a separate opt-in local runtime; poc:dev keeps its original behavior. */
export function selectChatbotRuntime(flags: { poc: boolean; pocGroq?: boolean; obsidian: boolean; synthetic: boolean }): ChatbotRuntime {
    if (flags.poc && flags.pocGroq) return 'poc-groq';
    if (flags.poc) return 'poc';
    if (flags.obsidian) return 'obsidian-demo';
    if (flags.synthetic) return 'synthetic-demo';
    return 'not-found';
}

