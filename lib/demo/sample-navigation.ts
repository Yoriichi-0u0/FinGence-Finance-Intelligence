import type { ProcessingContext } from './pipeline';

/** Use the existing provenance contract, never names, amounts or business identifiers. */
export function isBuiltInSample(context: ProcessingContext | null) {
    return !!context && context.status !== 'QUARANTINED' && context.documents.length > 0 && context.documents.every(document => document.provenance === 'PUBLIC_SYNTHETIC_SAMPLE');
}
export function sampleWelcomeHref(processingId: string) {
    return `/?sample-view=welcome&sample-context=${encodeURIComponent(processingId)}`;
}
/** A navigation preference applies only to the active verified sample, never a replacement source. */
export function sampleWelcomeSelected(search: Pick<URLSearchParams, 'get'>, processingId: string) {
    return search.get('sample-view') === 'welcome' && search.get('sample-context') === processingId;
}
