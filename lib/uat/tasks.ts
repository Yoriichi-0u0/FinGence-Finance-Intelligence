import { z } from 'zod';

/**
 * The SAIC acceptance-testing tasks (the UAT guide, section 4), shown on the in-app Testing checklist. Each tester records a
 * result per task; the same strict answer shape is checked in the browser, the server and the database
 * (supabase/sql/workspace-v8-uat.sql, fingence_workspace.valid_uat). Task IDs 1 to 11 are fixed there.
 * Step text uses **bold** for the names of buttons and pages, as on screen.
 */
export type UatTask = { id: number; title: string; steps: string[]; expected: string; question: string; links: { href: string; label: string }[]; adminOnly?: true };

export const UAT_TASKS: UatTask[] = [
    { id: 1, title: 'Sign in', links: [],
        steps: ['Open the live site and choose **I have a code**.', 'Enter your invitation code, choose a password and continue.', 'Sign out from the account menu (your initials, bottom left), then sign in again with your email and password. Your answers here are kept.'],
        expected: 'You land on Overview, and the account menu shows your name and role.',
        question: 'Was anything about joining or signing in unclear?' },
    { id: 2, title: 'Process the sample documents', links: [{ href: '/data', label: 'Open Data' }],
        steps: ['Open **Data** and choose **Sample documents** (one month, March 2026, MYR).', 'Look at the preview of each document, then choose **Process Financial Documents**.', 'In step 3, look at the confidence card and at what FinGence read beside each document.'],
        expected: 'Processing finishes in under a minute; the results show a confidence percentage with a band (High, Check advised or Low) and the four headline figures.',
        question: 'Did you understand what FinGence did with your documents, step by step?' },
    { id: 3, title: 'Read the Overview and the confidence figure', links: [{ href: '/', label: 'Open Overview' }],
        steps: ['Open **Overview**.', 'Hover over or tap the confidence figure and read how it is measured.', 'Look at the cards for each page.'],
        expected: 'Cash in, cash out and net movement match the Data results; the confidence explanation says what fell short, if anything.',
        question: 'Would you be comfortable using these figures? What would you need to see first?' },
    { id: 4, title: 'Check Reconciliation and Anomalies', links: [{ href: '/reconciliation', label: 'Open Reconciliation' }, { href: '/anomalies', label: 'Open Anomalies' }],
        steps: ['Open **Reconciliation**: see what matched, what was resolved by a stated rule (timing items, correcting entries) and what is still unexplained.', 'Open **Anomalies**: see which payments were marked for review, and which the books confirm.'],
        expected: 'Every difference between bank and books has a stated reason or is clearly marked unexplained; correcting entries are prepared for your books, not posted anywhere; a marked payment is a reason to review, never a finding of fraud.',
        question: 'Is it clear what, if anything, needs your attention?' },
    { id: 5, title: 'Print the management report', links: [{ href: '/reports', label: 'Open Reports' }],
        steps: ['Open **Reports** and choose **Print or save PDF**.', 'Save it as a PDF.'],
        expected: 'A clean, printable management summary of the same figures.',
        question: 'Is this report useful as it is? What would you add or remove?' },
    { id: 6, title: 'Write the AI report for a quarter', links: [{ href: '/data', label: 'Open Data' }, { href: '/ai-report', label: 'Open AI report' }],
        steps: ['Go back to **Data**, choose **Quarter sample** (January to March 2026, SGD) and process it.', 'Open **AI report** and choose **Write with AI**. Wait for all five sections (about one to two minutes).', 'Read it, then choose **Print or save PDF**.'],
        expected: 'A quarterly report for the first quarter ended 31 March 2026, compared with October to December 2025. Each section is marked either “Written by AI · figures checked” or shows FinGence’s own summary where the AI text did not pass the checks; every highlighted figure matches the tables.',
        question: 'Does it read like a quarterly report you would give management? What is missing?' },
    { id: 7, title: 'Ask Fin', links: [],
        steps: ['Open **Ask Fin** (the button at the bottom right, or Ctrl/⌘ K).', 'Ask: “Where do I see what did not match?”', 'Ask: “How much did we pay Tiong Flour Mills this quarter?”', 'Ask: “Should we take a loan?”'],
        expected: 'Fin guides you to the right page; the money question is answered with checked figures from your run; the loan question is politely declined, because advice is outside what cash records support.',
        question: 'Did Fin answer the way a helpful colleague would?' },
    { id: 8, title: 'Reopen a run from History', links: [{ href: '/history', label: 'Open History' }],
        steps: ['Open **History** and find the March 2026 run from task 2.', 'Choose **Open**, check that Overview shows the March figures again, then go back to the latest run.'],
        expected: 'Every earlier run is listed with its date, business, period and confidence, and reopens exactly as it was.',
        question: 'Would you use History to keep or compare periods?' },
    { id: 9, title: 'Try a document of your own', links: [{ href: '/data', label: 'Open Data' }],
        steps: ['On **Data**, choose your own **non-confidential** bank statement and ledger: an old, anonymised or made-up one. CSV, Excel, PDF statements, or scans and photos, up to 6 files.', 'Process them and look at the results, Reconciliation and the AI report.', 'Delete the run from **History** when you are done.'],
        expected: 'FinGence either reads the documents and shows results, or sets them aside and says why. It never shows figures it could not check.',
        question: 'Did FinGence read your document correctly? If it set it aside, was the reason clear?' },
    { id: 10, title: 'Use it on a phone', links: [],
        steps: ['Sign in on a phone and open Overview, Reconciliation and the AI report.', 'Ask Fin one question from the **Chat** tab.', 'You can record this task from the phone too: open **Testing checklist** in the menu.'],
        expected: 'Pages fit the screen without sideways scrolling; buttons are easy to tap.',
        question: 'Would you use FinGence on a phone, and for what?' },
    { id: 11, title: 'Admin only: Team and Technical log', adminOnly: true, links: [{ href: '/team', label: 'Open Team' }, { href: '/log', label: 'Open Technical log' }],
        steps: ['Open **Team**, invite a test Finance user and note the one-time code (do not share it outside the test).', 'Open **Technical log** and find the AI calls from task 6 and task 7.'],
        expected: 'The invitation code appears once; the Technical log lists each AI call with its feature, model, time and outcome, but never the question text or the figures.',
        question: 'Does the Technical log give you enough to oversee how AI is used?' },
];

export const RESULTS = { PASS: 'Pass', ISSUE: 'Issue', NOT_DONE: 'Not done' } as const;
export const KINDS = { WORKS_WELL: 'Works well', CONFUSING: 'Confusing', WRONG_RESULT: 'Wrong result', IDEA: 'Idea' } as const;
export const SEVERITIES = {
    BLOCKS: { label: 'Blocks the task', meaning: 'You cannot finish the task at all' },
    WORKAROUND: { label: 'Workaround exists', meaning: 'You finished, but only by guessing or retrying' },
    COSMETIC: { label: 'Cosmetic', meaning: 'Finished easily; wording or layout could be better' },
} as const;
export type UatResult = keyof typeof RESULTS;
export type UatKind = keyof typeof KINDS;
export type UatSeverity = keyof typeof SEVERITIES;

export const OVERALL = {
    trust: 'On a scale of 1 (not at all) to 5 (fully), how far would you trust FinGence’s figures for a month-end review?',
    trustWhy: 'Why?',
    useful: 'Which page was most useful, and which least?',
    change: 'What one change would make FinGence ready for your team to use every month?',
    other: 'Anything else the FinGence team should know?',
} as const;

/** The UAT guide, section 6: known and need not be reported, though comments are welcome. */
export const KNOWN_LIMITATIONS: [string, string][] = [
    ['Cash records only.', 'FinGence works from bank statements and the cash ledger. It does not produce profit, revenue, tax or balance-sheet figures, and says so when asked.'],
    ['One business and one currency per run.', 'Amounts stay in the documents’ own currency; nothing is converted.'],
    ['Correcting entries are prepared, not posted.', 'FinGence never writes to an accounting system.'],
    ['Forecasting is a baseline.', 'It is the average of recent months, not a prediction of specific payments.'],
    ['AI may hold back a paragraph.', 'When AI-written text fails a check, FinGence shows its own summary instead. The figures are the same either way.'],
    ['AI speed and daily limits.', 'The AI runs on a free service tier. A busy minute can make the AI report pause and retry, and each network address has a daily allowance of AI requests, shared by everyone in the same office.'],
    ['Unfamiliar layouts.', 'A document in a layout FinGence has not seen is read with AI help and then checked; if the checks fail, it is set aside with a reason rather than guessed.'],
    ['Invitations are passed on by hand.', 'FinGence does not send emails; an Admin gives each new user their code.'],
];

export const NOTE_MAX = 2000;
const note = z.string().max(NOTE_MAX);
export const taskAnswerSchema = z.object({
    result: z.enum(['PASS', 'ISSUE', 'NOT_DONE']),
    kind: z.enum(['WORKS_WELL', 'CONFUSING', 'WRONG_RESULT', 'IDEA']).optional(),
    severity: z.enum(['BLOCKS', 'WORKAROUND', 'COSMETIC']).optional(),
    note: note.optional(),
}).strict();
export const answersSchema = z.object({
    v: z.literal(1),
    tasks: z.record(z.string().regex(/^([1-9]|1[01])$/), taskAnswerSchema),
    overall: z.object({ trust: z.number().int().min(1).max(5).optional(), trustWhy: note.optional(), useful: note.optional(), change: note.optional(), other: note.optional() }).strict(),
    context: z.object({ device: z.string().max(120).optional() }).strict(),
}).strict();
export type TaskAnswer = z.infer<typeof taskAnswerSchema>;
export type UatAnswers = z.infer<typeof answersSchema>;
export const EMPTY_ANSWERS: UatAnswers = { v: 1, tasks: {}, overall: {}, context: {} };

/** The tasks a tester in this role is asked to do: task 11 only for an Admin or Superadmin. */
export const tasksFor = (admin: boolean) => UAT_TASKS.filter(t => admin || !t.adminOnly);

/** How far a tester has got: tasks with any result, of the tasks for their role. */
export function progress(answers: UatAnswers, admin: boolean) {
    const tasks = tasksFor(admin);
    const recorded = tasks.filter(t => answers.tasks[t.id]?.result).length;
    return { recorded, total: tasks.length, complete: recorded === tasks.length };
}

/** A severity only belongs to an Issue: changing the result away from Issue drops it. */
export function setTask(answers: UatAnswers, id: number, change: Partial<TaskAnswer>): UatAnswers {
    const current: Partial<TaskAnswer> = answers.tasks[id] ?? {};
    const next = { ...current, ...change } as Partial<TaskAnswer>;
    if (next.result !== 'ISSUE') delete next.severity;
    for (const key of ['kind', 'severity', 'note'] as const) if (next[key] === undefined || next[key] === '') delete next[key];
    const tasks = { ...answers.tasks };
    if (next.result) tasks[id] = next as TaskAnswer; else delete tasks[id];
    return { ...answers, tasks };
}

/** "Chrome · macOS · 1440 px": enough to reproduce a layout finding, nothing that identifies the person. */
export function describeDevice(userAgent: string, width: number) {
    const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Other browser';
    const system = /iPhone|iPad|iPod/.test(userAgent) ? 'iOS' : /Android/.test(userAgent) ? 'Android' : /Mac OS X/.test(userAgent) ? 'macOS' : /Windows/.test(userAgent) ? 'Windows' : /Linux/.test(userAgent) ? 'Linux' : 'Other system';
    return `${browser} · ${system} · ${Math.max(0, Math.round(width))} px`;
}

export type UatRole = 'FINANCE' | 'ADMIN' | 'SUPERADMIN';
export type Tester = { email: string; role: UatRole; active: boolean; mine: boolean; answers: UatAnswers; appVersion: string; submittedAt: string | null; updatedAt: string };
const SEVERITY_ORDER: Record<string, number> = { BLOCKS: 0, WORKAROUND: 1, COSMETIC: 2 };

/** Every Issue across testers, the most serious first, for triage. */
export function issues(testers: Tester[]) {
    return testers.flatMap(t => Object.entries(t.answers.tasks).filter(([, a]) => a.result === 'ISSUE').map(([id, a]) => ({ task: Number(id), tester: t.email, role: t.role, ...a })))
        .sort((a, b) => (SEVERITY_ORDER[a.severity ?? ''] ?? 3) - (SEVERITY_ORDER[b.severity ?? ''] ?? 3) || a.task - b.task);
}

/** The UAT guide's sign-off criteria (section 8), as far as they can be counted: the third needs SAIC's agreement. */
export function signOff(testers: Tester[]) {
    const financePassing = testers.filter(t => t.role === 'FINANCE' && UAT_TASKS.filter(k => k.id <= 8).every(k => t.answers.tasks[k.id]?.result === 'PASS')).length;
    const all = issues(testers);
    return { financePassing, financeNeeded: 2, blocking: all.filter(i => i.severity === 'BLOCKS').length, wrongResults: all.filter(i => i.kind === 'WRONG_RESULT').length };
}

const cell = (value: unknown) => {
    let text = value === undefined || value === null ? '' : String(value);
    // A spreadsheet must never run a note as a formula.
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * One row per tester and task, then one per overall answer. Testers are "Tester 1, 2…" (oldest first) with their role and
 * email domain, not their address, so the export can go into the technical report as it is.
 */
export function resultsCsv(testers: Tester[]) {
    const ordered = [...testers].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.email.localeCompare(b.email));
    const rows: unknown[][] = [['Tester', 'Role', 'Email domain', 'Device', 'App version', 'Submitted', 'Task', 'Result', 'Kind', 'Severity', 'Note']];
    ordered.forEach((t, i) => {
        const who = [`Tester ${i + 1}`, t.role, t.email.split('@')[1] ?? '', t.answers.context.device ?? '', t.appVersion, t.submittedAt ?? ''];
        for (const task of tasksFor(t.role !== 'FINANCE')) {
            const a = t.answers.tasks[task.id];
            rows.push([...who, `${task.id}. ${task.title}`, a ? RESULTS[a.result] : '', a?.kind ? KINDS[a.kind] : '', a?.severity ? SEVERITIES[a.severity].label : '', a?.note ?? '']);
        }
        for (const [key, question] of Object.entries(OVERALL)) {
            const value = t.answers.overall[key as keyof UatAnswers['overall']];
            if (value !== undefined && value !== '') rows.push([...who, `Overall: ${question}`, '', '', '', String(value)]);
        }
    });
    return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
