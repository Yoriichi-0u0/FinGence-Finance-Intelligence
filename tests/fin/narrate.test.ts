import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { processDocuments, type DocumentInput, type Stage } from '../../lib/demo/pipeline';
import { closingLine, narrateStage, STAGE_ORDER, traceOf } from '../../lib/fin/narrate';

const doc = (dir: string, name: string): DocumentInput => ({ name, bytes: readFileSync(join('public/demo', dir, name)), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const SAMPLES: Record<string, DocumentInput[]> = {
    march: ['demo-bank-statement-2026-03.csv', 'demo-general-ledger-2026-03.csv', 'demo-bank-history-2025-04-to-2026-03.csv'].map(n => doc('', n)),
    quarter: ['demo-bank-statement-2026-q1-sgd.csv', 'demo-general-ledger-2026-q1-sgd.csv', 'demo-bank-history-2025-04-to-2026-03-sgd.csv'].map(n => doc('quarter', n)),
    'full year': ['demo-bank-statement-2025-fy-myr.csv', 'demo-general-ledger-2025-fy-myr.csv', 'demo-bank-history-2024-01-to-2025-12-myr.csv'].map(n => doc('full-year', n)),
};

/** The narration says only what the pipeline reported: checked against all three samples, stage by stage as they arrive. */
describe('the assistant narrates a run from the pipeline itself', () => {
    for (const [label, inputs] of Object.entries(SAMPLES)) it(`${label}: every line matches its stage, and the closing counts match the checks`, async () => {
        const seen: Stage[] = [], traces: ReturnType<typeof traceOf>[] = [];
        const c = await processDocuments(inputs, undefined, stage => { seen.push(stage); traces.push(traceOf([...seen], true)); });
        expect(seen.map(s => s.id)).toEqual(STAGE_ORDER);
        // While running, the trace has every finished stage plus the one now running, never anything ahead of the pipeline.
        traces.forEach((t, i) => {
            expect(t.filter(l => l.state !== 'doing').map(l => l.id)).toEqual(STAGE_ORDER.slice(0, i + 1));
            expect(t.filter(l => l.state === 'doing').map(l => l.id)).toEqual(i + 1 < STAGE_ORDER.length ? [STAGE_ORDER[i + 1]] : []);
        });
        const final = traceOf(c.stages, false);
        for (const [i, line] of final.entries()) {
            const stage = c.stages[i];
            expect(line.checks).toEqual({ passed: stage.checks.filter(k => k.passed).length, total: stage.checks.length });
            expect(line.state).toBe(stage.decision === 'AUTO_ACCEPTED' ? 'done' : stage.decision === 'QUARANTINED' ? 'set-aside' : 'not-run');
            expect(line.detail).toBe(stage.summary);
        }
        const passed = c.stages.flatMap(s => s.checks).filter(k => k.passed).length, total = c.stages.flatMap(s => s.checks).length;
        expect(closingLine(c.stages)).toContain(`${passed} of ${total} checks passed`);
        if (c.stages.every(s => s.decision === 'AUTO_ACCEPTED')) expect(closingLine(c.stages)).toBe(`Done: all 8 stages passed and ${passed} of ${total} checks passed.`);
    }, 120_000);
});

describe('narration wording', () => {
    const stage = (decision: Stage['decision'], passed = [true, true]): Stage => ({ id: 'FORECAST', title: 'Supported forecast', decision, method: 'm', summary: 'Needs 7 consecutive months of history.', checks: passed.map((p, i) => ({ id: `c${i}`, label: 'l', passed: p, detail: 'd' })) });
    it('says plainly when a stage passed, was set aside or could not run, with the stage\'s own reason', () => {
        expect(narrateStage(stage('AUTO_ACCEPTED'))).toMatchObject({ state: 'done', text: 'Planned the coming months', checks: { passed: 2, total: 2 } });
        expect(narrateStage(stage('QUARANTINED', [true, false]))).toMatchObject({ state: 'set-aside', text: 'Set aside at "Supported forecast"', detail: 'Needs 7 consecutive months of history.', checks: { passed: 1, total: 2 } });
        expect(narrateStage(stage('UNAVAILABLE'))).toMatchObject({ state: 'not-run', text: 'Couldn\'t plan the coming months' });
    });
    it('closes with what did not run, or where it stopped', () => {
        const ok = (id: Stage['id']): Stage => ({ ...stage('AUTO_ACCEPTED'), id, title: id });
        const stages = STAGE_ORDER.map(id => id === 'FORECAST' ? stage('UNAVAILABLE') : ok(id));
        expect(closingLine(stages)).toBe('Done: 7 of 8 stages passed and 16 of 16 checks passed. "Supported forecast" could not run, as it says above.');
        expect(closingLine([ok('IDENTIFY'), { ...stage('QUARANTINED', [false]), id: 'EXTRACT' }])).toMatch(/^Stopped at "Extract and normalize records": the documents were set aside/);
    });
    it('never says "Done" for a run that failed or stopped before every stage reported', () => {
        const ok = (id: Stage['id']): Stage => ({ ...stage('AUTO_ACCEPTED'), id, title: id });
        const partial = STAGE_ORDER.slice(0, 3).map(ok);
        expect(closingLine(partial, true)).toBe('Processing stopped before "Independent verification" and did not finish, so no results were kept. 6 of 6 checks passed up to then.');
        expect(closingLine(partial)).toMatch(/^Processing stopped before "Independent verification"/);
        // Every stage reported, but the run itself failed afterwards (for example, the server job timed out): still not done.
        expect(closingLine(STAGE_ORDER.map(ok), true)).toBe('Processing stopped and did not finish, so no results were kept. 16 of 16 checks passed up to then.');
        expect(closingLine(STAGE_ORDER.map(ok))).toBe('Done: all 8 stages passed and 16 of 16 checks passed.');
    });
    it('never writes an exclamation mark, and never a figure the stages did not give it', () => {
        for (const id of STAGE_ORDER) for (const d of ['AUTO_ACCEPTED', 'QUARANTINED', 'UNAVAILABLE'] as const) expect(narrateStage({ ...stage(d, []), id }).text).not.toMatch(/!|\d/);
    });
});
