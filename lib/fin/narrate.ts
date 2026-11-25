/**
 * The assistant's narration of a processing run: one plain line per stage, written by code from what the stage itself
 * reported (its decision, its checks and its own summary). No model is involved, so the narration cannot claim more than
 * the pipeline did. The run is the month-end close in miniature: read, check, reconcile, analyse, plan, report.
 */
import { STAGE_TITLES, type Stage, type StageId } from '../demo/pipeline';

export const STAGE_ORDER = Object.keys(STAGE_TITLES) as StageId[];

/** What the assistant says while a stage is running. */
const DOING: Record<StageId, string> = {
    IDENTIFY: 'Working out which document is which', EXTRACT: 'Reading every record', INTERPRET: 'Checking each layout and its conventions',
    VERIFY: 'Checking every figure independently', RECONCILE: 'Matching the bank to the books', ANALYZE: 'Sorting the cash and looking for anything unusual',
    FORECAST: 'Planning the coming months', REPORT: 'Writing the summary',
};
/** What it says once a stage has passed. */
const DONE: Record<StageId, string> = {
    IDENTIFY: 'Identified the documents', EXTRACT: 'Read the records', INTERPRET: 'Understood the layouts', VERIFY: 'Verified the figures',
    RECONCILE: 'Matched the bank to the books', ANALYZE: 'Analysed the cash', FORECAST: 'Planned the coming months', REPORT: 'Wrote the summary',
};

/** What it says when a stage could not run (for example, too little history for a forecast). */
const NOT_RUN: Record<StageId, string> = {
    IDENTIFY: 'Couldn\'t identify the documents', EXTRACT: 'Couldn\'t read the records', INTERPRET: 'Couldn\'t work out the layouts',
    VERIFY: 'Couldn\'t verify the figures', RECONCILE: 'Couldn\'t match the bank to the books', ANALYZE: 'Couldn\'t analyse the cash',
    FORECAST: 'Couldn\'t plan the coming months', REPORT: 'Couldn\'t write the summary',
};

export type TraceState = 'done' | 'set-aside' | 'not-run' | 'doing' | 'waiting';
export type TraceLine = { id: StageId; state: TraceState; text: string; detail: string | null; checks: { passed: number; total: number } | null };

const checksOf = (stage: Stage) => ({ passed: stage.checks.filter(c => c.passed).length, total: stage.checks.length });

/** One stage as the assistant tells it: passed, set aside (with the stage's own reason) or not run (and why). */
export function narrateStage(stage: Stage): TraceLine {
    const checks = checksOf(stage);
    if (stage.decision === 'AUTO_ACCEPTED') return { id: stage.id, state: 'done', text: DONE[stage.id], detail: stage.summary, checks };
    if (stage.decision === 'QUARANTINED') return { id: stage.id, state: 'set-aside', text: `Set aside at "${STAGE_TITLES[stage.id]}"`, detail: stage.summary, checks };
    return { id: stage.id, state: 'not-run', text: NOT_RUN[stage.id], detail: stage.summary, checks };
}

/** The run so far: every finished stage, then the one running now while processing; nothing invented beyond that. */
export function traceOf(stages: Stage[], processing: boolean): TraceLine[] {
    const lines = STAGE_ORDER.map(id => stages.find(s => s.id === id)).filter((s): s is Stage => !!s).map(narrateStage);
    if (processing) {
        const next = STAGE_ORDER.find(id => !stages.some(s => s.id === id));
        if (next) lines.push({ id: next, state: 'doing', text: DOING[next], detail: null, checks: null });
    }
    return lines;
}

/** The closing line once the run has ended: how many stages ran and how many checks passed, all counted from the stages. */
export function closingLine(stages: Stage[]): string {
    const ran = stages.length, total = stages.flatMap(s => s.checks).length, passed = stages.flatMap(s => s.checks).filter(c => c.passed).length;
    const setAside = stages.find(s => s.decision === 'QUARANTINED');
    if (setAside) return `Stopped at "${STAGE_TITLES[setAside.id]}": the documents were set aside, so no figures are shown. ${passed} of ${total} checks passed before that.`;
    const notRun = stages.filter(s => s.decision !== 'AUTO_ACCEPTED');
    const allChecks = `${passed} of ${total} checks passed`;
    return notRun.length
        ? `Done: ${ran - notRun.length} of ${STAGE_ORDER.length} stages passed and ${allChecks}. ${notRun.map(s => `"${STAGE_TITLES[s.id]}"`).join(' and ')} could not run, as it says above.`
        : `Done: all ${STAGE_ORDER.length} stages passed and ${allChecks}.`;
}
