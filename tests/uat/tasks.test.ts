import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { answersSchema, describeDevice, EMPTY_ANSWERS, issues, progress, resultsCsv, setTask, signOff, tasksFor, UAT_TASKS, type Tester, type UatAnswers } from '../../lib/uat/tasks';
import { FIN_PAGES } from '../../lib/fin/contracts';

const tester = (email: string, role: Tester['role'], answers: UatAnswers, updatedAt = '2026-11-20T03:00:00Z'): Tester =>
    ({ email, role, active: true, mine: false, answers, appVersion: 'abc1234', submittedAt: null, updatedAt });
const allPass = (ids: number[]) => ids.reduce((a, id) => setTask(a, id, { result: 'PASS' }), EMPTY_ANSWERS);

describe('the UAT tasks', () => {
    it('are the guide\'s 11 tasks, numbered 1 to 11, with task 11 for Admins only', () => {
        expect(UAT_TASKS.map(t => t.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        expect(UAT_TASKS.filter(t => t.adminOnly).map(t => t.id)).toEqual([11]);
        expect(tasksFor(false)).toHaveLength(10);
        expect(tasksFor(true)).toHaveLength(11);
        for (const t of UAT_TASKS) expect(t.steps.length && t.expected && t.question).toBeTruthy();
    });
    it('link only to pages that exist', () => {
        for (const link of UAT_TASKS.flatMap(t => t.links)) {
            const path = link.href === '/' ? 'app/page.tsx' : `app${link.href}/page.tsx`;
            expect(() => readFileSync(path), link.href).not.toThrow();
        }
    });
    it('the database accepts exactly the task IDs the app uses', () => {
        const sql = readFileSync('supabase/sql/workspace-v8-uat.sql', 'utf8');
        expect(sql).toContain("k !~ '^([1-9]|1[01])$'");
        expect(answersSchema.safeParse({ ...EMPTY_ANSWERS, tasks: { 11: { result: 'PASS' } } }).success).toBe(true);
        expect(answersSchema.safeParse({ ...EMPTY_ANSWERS, tasks: { 12: { result: 'PASS' } } }).success).toBe(false);
        expect(answersSchema.safeParse({ ...EMPTY_ANSWERS, tasks: { 0: { result: 'PASS' } } }).success).toBe(false);
    });
    it('Fin knows the Testing checklist page', () => {
        expect(FIN_PAGES['/uat'].label).toBe('Testing checklist');
    });
});

describe('recording a task', () => {
    it('keeps a severity only for an Issue, and drops empty fields', () => {
        let a = setTask(EMPTY_ANSWERS, 4, { result: 'ISSUE', severity: 'BLOCKS', kind: 'WRONG_RESULT', note: 'Totals differ' });
        expect(a.tasks[4]).toEqual({ result: 'ISSUE', severity: 'BLOCKS', kind: 'WRONG_RESULT', note: 'Totals differ' });
        a = setTask(a, 4, { result: 'PASS' });
        expect(a.tasks[4]).toEqual({ result: 'PASS', kind: 'WRONG_RESULT', note: 'Totals differ' });
        a = setTask(a, 4, { note: '', kind: undefined });
        expect(a.tasks[4]).toEqual({ result: 'PASS' });
        expect(answersSchema.safeParse(a).success).toBe(true);
    });
    it('counts progress over the tasks for the role', () => {
        const ten = allPass([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        expect(progress(ten, false)).toEqual({ recorded: 10, total: 10, complete: true });
        expect(progress(ten, true)).toEqual({ recorded: 10, total: 11, complete: false });
    });
    it('describes the device without anything that identifies the person', () => {
        expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36', 1440)).toBe('Chrome · macOS · 1440 px');
        expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', 390.4)).toBe('Safari · iOS · 390 px');
        expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0', 1280)).toBe('Edge · Windows · 1280 px');
    });
});

describe('everyone\'s results', () => {
    const a = tester('a@saic.example', 'FINANCE', setTask(setTask(allPass([1, 2, 3, 4, 5, 6, 7, 8]), 9, { result: 'ISSUE', severity: 'COSMETIC', note: '=HYPERLINK("x")' }), 10, { result: 'NOT_DONE' }), '2026-11-20T02:00:00Z');
    const b = tester('b@saic.example', 'FINANCE', setTask(allPass([1, 2, 3]), 4, { result: 'ISSUE', severity: 'BLOCKS', kind: 'WRONG_RESULT', note: 'Net is wrong,\n"see screenshot"' }));
    const c = tester('admin@team.example', 'ADMIN', { ...allPass([1, 2, 3, 4, 5, 6, 7, 8, 11]), overall: { trust: 4, useful: 'AI report' } }, '2026-11-20T04:00:00Z');

    it('lists issues with the most serious first', () => {
        expect(issues([a, b, c]).map(i => [i.task, i.severity])).toEqual([[4, 'BLOCKS'], [9, 'COSMETIC']]);
    });
    it('counts the sign-off criteria: two Finance testers passing 1 to 8, no blockers, no wrong results', () => {
        expect(signOff([a, b, c])).toEqual({ financePassing: 1, financeNeeded: 2, blocking: 1, wrongResults: 1 });
        const b2 = tester('b@saic.example', 'FINANCE', allPass([1, 2, 3, 4, 5, 6, 7, 8]));
        expect(signOff([a, b2, c])).toEqual({ financePassing: 2, financeNeeded: 2, blocking: 0, wrongResults: 0 });
    });
    it('exports a CSV with numbered testers and email domains only, safe to open in a spreadsheet', () => {
        const csv = resultsCsv([b, c, a]);
        const lines = csv.trimEnd().split('\r\n');
        expect(lines[0]).toBe('Tester,Role,Email domain,Device,App version,Submitted,Task,Result,Kind,Severity,Note');
        expect(csv).not.toMatch(/a@saic|b@saic|admin@team/);
        // Oldest first: a is Tester 1. Finance testers get 10 task rows; the Admin 11, plus their overall answers.
        expect(lines.filter(l => l.startsWith('Tester 1,FINANCE,saic.example'))).toHaveLength(10);
        expect(lines.filter(l => l.startsWith('Tester 3,ADMIN,team.example'))).toHaveLength(13);
        expect(csv).toContain(`9. Try a document of your own,Issue,,Cosmetic,"'=HYPERLINK(""x"")"`);
        expect(csv).toContain('Wrong result,Blocks the task,"Net is wrong,\n""see screenshot"""');
        expect(csv).toContain('Overall: On a scale of 1 (not at all) to 5 (fully)');
    });
});
