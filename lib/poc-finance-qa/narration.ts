import type { QaAnswer } from './answer';

/**
 * Contract for a future, separately authorized natural-language layer that may only paraphrase an
 * answer that has already been computed. Nothing in the application implements or calls a model;
 * the only narrator here is the deterministic template. A proposal is accepted only when it cites
 * existing facts and contains no figure other than the cited facts' exact values.
 */
export const NARRATION_VERSION = 'poc-finance-narration-v1' as const;
export type NarrationRequest = {
    version: typeof NARRATION_VERSION; question: string; selection: QaAnswer['selection'];
    claims: QaAnswer['facts']; deterministicText: string; instructions: string;
};
export type NarrationProposal = { text: string; claimIds: string[] };
export interface FinanceNarrator {
    /** A model-backed narrator would report its provider here; it must never be labelled deterministic. */
    readonly origin: 'DETERMINISTIC_TEMPLATE' | 'LANGUAGE_MODEL';
    narrate(request: NarrationRequest): Promise<NarrationProposal>;
}
export type NarrationOutcome = { accepted: true; text: string; origin: FinanceNarrator['origin'] } | { accepted: false; reason: 'NOT_ANSWERED' | 'NO_CITATION' | 'UNKNOWN_CLAIM' | 'UNCITED_FIGURE' | 'TOO_LONG' };

/** Only answered questions can be narrated; refusals and unavailable answers keep their fixed wording. */
export function narrationRequest(answer: QaAnswer): NarrationRequest | null {
    if (answer.status !== 'ANSWERED') return null;
    return {
        version: NARRATION_VERSION, question: answer.question, selection: answer.selection, claims: answer.facts, deterministicText: `${answer.headline} ${answer.interpretation}`,
        instructions: 'Rephrase deterministicText in plain English. Cite claim ids. Use no number, date, identifier or financial interpretation that is not one of the cited claims. Do not explain causes, give advice or call anything fraud.',
    };
}

/** Whole numbers in the text that are not exactly a cited value. Identifiers and months are removed first. */
function uncited(text: string, answer: QaAnswer, cited: QaAnswer['facts']) {
    const s = answer.selection, hashes = [s.sha256, ...cited.filter(f => /^[0-9a-f]{64}$/.test(f.value)).map(f => f.value)];
    const literals = [...hashes, ...hashes.map(h => h.slice(0, 12)), s.sourceId, s.fileName, s.businessId, s.period, ...cited.filter(f => f.unit === 'PERIOD').map(f => f.value), 'SHA-256'].sort((a, b) => b.length - a.length);
    const values = new Set(cited.flatMap(f => [f.value, f.value.replace(/^-/, '')]));
    const rest = literals.reduce((t, literal) => t.split(literal).join(' '), text);
    return (rest.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? []).filter(token => !values.has(token.replace(/,/g, '')));
}
export function acceptNarration(answer: QaAnswer, proposal: NarrationProposal, origin: FinanceNarrator['origin']): NarrationOutcome {
    if (answer.status !== 'ANSWERED') return { accepted: false, reason: 'NOT_ANSWERED' };
    if (typeof proposal?.text !== 'string' || proposal.text.length > 1200) return { accepted: false, reason: 'TOO_LONG' };
    if (!Array.isArray(proposal.claimIds) || !proposal.claimIds.length) return { accepted: false, reason: 'NO_CITATION' };
    const cited = answer.facts.filter(f => proposal.claimIds.includes(f.id));
    if (cited.length !== new Set(proposal.claimIds).size) return { accepted: false, reason: 'UNKNOWN_CLAIM' };
    if (uncited(proposal.text, answer, cited).length) return { accepted: false, reason: 'UNCITED_FIGURE' };
    return { accepted: true, text: proposal.text, origin };
}

/** The only narrator in this PoC: returns the computed wording unchanged. */
export const templateNarrator: FinanceNarrator = {
    origin: 'DETERMINISTIC_TEMPLATE',
    narrate: async request => ({ text: request.deterministicText, claimIds: request.claims.map(c => c.id) }),
};
