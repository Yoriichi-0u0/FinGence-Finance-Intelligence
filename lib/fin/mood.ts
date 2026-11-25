/**
 * The assistant's mood, read from what FinGence itself knows: never from the model's opinion of its own answer, and never
 * from how long since the person last visited. Each mood has one real signal (docs/architecture/assistant-v3.md):
 *
 *   working   processing is running, or the assistant is waiting for a reply
 *   paused    the AI is off here, or at its limit: FinGence's own checks still work
 *   unsure    the last reply failed FinGence's checks, or this run's confidence is low
 *   found     reconciliation differences no rule explained, flagged payments, or documents set aside
 *   pleased   every stage verified, nothing left to look at and confidence high: the only cheerful mood, earned by code
 *   resting   everything else
 *
 * Any count in a line is counted by code (`attentionCounts`), never written by the model.
 */
import type { FinPage } from './contracts';

export type Mood = 'resting' | 'working' | 'paused' | 'unsure' | 'found' | 'pleased';
/** What the assistant's last turn ran into, if anything. */
export type Issue = 'WITHHELD' | 'LIMITED' | 'OFF' | 'UNREACHABLE' | null;

/** The budget gate's refusals (lib/server/ai/budget.ts, admit) and the provider's own limit, all "at its limit for now". */
const LIMIT_CODES = new Set(['RATE_LIMITED', 'CLIENT_RATE_LIMITED', 'CLIENT_DAILY_LIMIT', 'DAILY_LIMIT', 'DAILY_BUDGET_EXHAUSTED', 'BUDGET_EXHAUSTED']);
/** What a failed call to the assistant's gateway means for its mood. */
export function issueOf(code: string): Exclude<Issue, 'WITHHELD' | null> {
    return LIMIT_CODES.has(code) ? 'LIMITED' : code === 'AI_OFF' ? 'OFF' : 'UNREACHABLE';
}
export type MoodInput = {
    processing: boolean;
    busy: boolean;
    /** Whether the assistant can reach its AI here: null while still checking. */
    ai: boolean | null;
    issue: Issue;
    attention: { reconciliation: number; anomalies: number; documents: number } | null;
    /** The run's confidence band, 'INCOMPLETE' when a stage was set aside, null without a run. */
    confidence: 'HIGH' | 'CHECK' | 'LOW' | 'INCOMPLETE' | null;
    /** The run's period in words, for the one cheerful line ("March 2026"). */
    period: string | null;
};
export type MoodView = { mood: Mood; count: number; line: string | null; link: FinPage | null };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function assistantMood(i: MoodInput): MoodView {
    if (i.processing) return { mood: 'working', count: 0, line: 'Reading and checking your documents.', link: '/data' };
    if (i.busy) return { mood: 'working', count: 0, line: null, link: null };
    if (i.issue === 'LIMITED') return { mood: 'paused', count: 0, line: 'My AI is at its limit for the moment. FinGence\'s own checks still work, and I\'ll answer with its fixed rules.', link: null };
    if (i.issue === 'UNREACHABLE') return { mood: 'paused', count: 0, line: 'I can\'t reach my AI right now, so I answer with FinGence\'s fixed rules.', link: null };
    if (i.issue === 'OFF' || i.ai === false) return { mood: 'paused', count: 0, line: 'My AI is off here, so I answer with FinGence\'s fixed rules.', link: null };
    if (i.issue === 'WITHHELD') return { mood: 'unsure', count: 0, line: 'I couldn\'t back my last reply with the verified records, so I held it back. Try asking another way.', link: null };
    if (i.confidence === 'LOW' || i.confidence === 'INCOMPLETE') return { mood: 'unsure', count: 0, line: i.confidence === 'LOW' ? 'Confidence is low for this run. The Overview shows what fell short.' : 'Part of this run was set aside, so its figures are incomplete. Data shows why.', link: i.confidence === 'LOW' ? '/' : '/data' };
    const a = i.attention;
    if (a && a.reconciliation + a.anomalies + a.documents > 0) {
        const count = a.reconciliation + a.anomalies + a.documents;
        const line = a.reconciliation ? `${plural(a.reconciliation, 'bank difference isn\'t', 'bank differences aren\'t')} explained yet.`
            : a.anomalies ? `${plural(a.anomalies, 'payment is', 'payments are')} worth a second look.`
            : `${plural(a.documents, 'document was', 'documents were')} set aside.`;
        return { mood: 'found', count, line, link: a.reconciliation ? '/reconciliation' : a.anomalies ? '/anomalies' : '/data' };
    }
    if (a && i.confidence === 'HIGH') return { mood: 'pleased', count: 0, line: `${i.period ?? 'This run'} reconciles: every check passed and nothing needs you.`, link: '/' };
    return { mood: 'resting', count: 0, line: null, link: null };
}

/** The face the mascot shows for each mood. */
export const MASCOT_FACE: Record<Mood, 'idle' | 'thinking' | 'happy' | 'found' | 'unsure' | 'paused'> = {
    resting: 'idle', working: 'thinking', paused: 'paused', unsure: 'unsure', found: 'found', pleased: 'happy',
};
