import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { assistantMood, issueOf, MASCOT_FACE, type MoodInput } from '../../lib/fin/mood';
import { FinMascot, type FinMood } from '../../components/fin/mascot';

const calm: MoodInput = { processing: false, busy: false, ai: true, issue: null, attention: { reconciliation: 0, anomalies: 0, documents: 0 }, confidence: 'HIGH', period: 'March 2026' };

/** The assistant's mood comes only from FinGence's own signals, in a fixed order of importance. */
describe('assistant mood', () => {
    it('is pleased only when code verified everything: nothing needs a person and confidence is high', () => {
        expect(assistantMood(calm)).toEqual({ mood: 'pleased', count: 0, line: 'March 2026 reconciles: every check passed and nothing needs you.', link: '/' });
        expect(assistantMood({ ...calm, confidence: 'CHECK' }).mood).toBe('resting');
        expect(assistantMood({ ...calm, attention: null, confidence: null }).mood).toBe('resting');
    });
    it('found something: counts and wording come from code, most important first', () => {
        expect(assistantMood({ ...calm, attention: { reconciliation: 2, anomalies: 3, documents: 0 } })).toEqual({ mood: 'found', count: 5, line: '2 bank differences aren\'t explained yet.', link: '/reconciliation' });
        expect(assistantMood({ ...calm, attention: { reconciliation: 0, anomalies: 1, documents: 0 } })).toMatchObject({ count: 1, line: '1 payment is worth a second look.', link: '/anomalies' });
        expect(assistantMood({ ...calm, attention: { reconciliation: 0, anomalies: 0, documents: 1 } })).toMatchObject({ line: '1 document was set aside.', link: '/data' });
    });
    it('is unsure when a reply failed the checks or confidence is low, and never cheerful then', () => {
        expect(assistantMood({ ...calm, issue: 'WITHHELD' }).mood).toBe('unsure');
        expect(assistantMood({ ...calm, confidence: 'LOW' })).toMatchObject({ mood: 'unsure', link: '/' });
        expect(assistantMood({ ...calm, confidence: 'INCOMPLETE' })).toMatchObject({ mood: 'unsure', link: '/data' });
        // Low confidence outranks things to look at: the figures themselves are in doubt.
        expect(assistantMood({ ...calm, confidence: 'LOW', attention: { reconciliation: 4, anomalies: 0, documents: 0 } }).mood).toBe('unsure');
    });
    it('is paused when its AI is off or at its limit, and says FinGence\'s own checks still work', () => {
        expect(assistantMood({ ...calm, ai: false })).toMatchObject({ mood: 'paused' });
        expect(assistantMood({ ...calm, issue: 'OFF' }).mood).toBe('paused');
        expect(assistantMood({ ...calm, issue: 'LIMITED' }).line).toContain('own checks still work');
        expect(assistantMood({ ...calm, issue: 'UNREACHABLE' })).toMatchObject({ mood: 'paused', line: expect.stringContaining('can\'t reach') });
    });
    it('reads every budget-gate refusal as "at its limit", the AI switch as off, anything else as unreachable', () => {
        for (const code of ['RATE_LIMITED', 'CLIENT_RATE_LIMITED', 'CLIENT_DAILY_LIMIT', 'DAILY_LIMIT', 'DAILY_BUDGET_EXHAUSTED', 'BUDGET_EXHAUSTED']) expect(issueOf(code), code).toBe('LIMITED');
        expect(issueOf('AI_OFF')).toBe('OFF');
        for (const code of ['BUDGET_UNAVAILABLE', 'UNREACHABLE', 'HTTP_502']) expect(issueOf(code), code).toBe('UNREACHABLE');
    });
    it('is working above everything while processing or replying', () => {
        expect(assistantMood({ ...calm, processing: true, issue: 'WITHHELD' })).toMatchObject({ mood: 'working', link: '/data' });
        expect(assistantMood({ ...calm, busy: true, confidence: 'LOW' })).toEqual({ mood: 'working', count: 0, line: null, link: null });
    });
    it('never uses guilt, exclamation marks or money in its lines', () => {
        const inputs: MoodInput[] = [calm, { ...calm, issue: 'WITHHELD' }, { ...calm, issue: 'LIMITED' }, { ...calm, ai: false }, { ...calm, confidence: 'LOW' }, { ...calm, confidence: 'INCOMPLETE' }, { ...calm, processing: true },
            { ...calm, attention: { reconciliation: 1, anomalies: 0, documents: 0 } }, { ...calm, attention: { reconciliation: 0, anomalies: 2, documents: 0 } }];
        for (const i of inputs) {
            const line = assistantMood(i).line ?? '';
            expect(line, line).not.toMatch(/!|miss(ed)? you|MYR|RM\b|\$|%/);
        }
    });
    it('draws a distinct face for every mood, hiding the AI sparkle when unsure or paused', () => {
        const faces = Object.values(MASCOT_FACE) as FinMood[];
        const drawn = faces.map(mood => renderToStaticMarkup(createElement(FinMascot, { mood })));
        expect(new Set(drawn.map(svg => svg.replace(/fin-[a-z]+-[^"]+/g, ''))).size).toBe(faces.length);
        for (const [i, mood] of faces.entries()) expect(drawn[i]).toContain(`data-mood="${mood}"`);
        expect(drawn[faces.indexOf('unsure')]).not.toContain('fin-sparkle');
        expect(drawn[faces.indexOf('paused')]).not.toContain('fin-sparkle');
        expect(drawn[faces.indexOf('found')]).toContain('fin-alert');
    });
});
