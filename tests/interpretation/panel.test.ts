import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';
import type { LayoutInterpreter } from '../../lib/interpretation/contracts';
import { InterpretationPanel } from '../../components/demo/interpretation-panel';
import { CORRECT } from './proposals';

const doc = (dir: string, name: string): DocumentInput => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const receipt = { provider: 'GROQ' as const, model: 'openai/gpt-oss-120b', requestId: 'req', latencyMs: 3200, inputTokens: 3306, outputTokens: 1195, estimatedUsd: 0.0012, mode: 'LIVE' as const };
const recorded: LayoutInterpreter = { async propose(e) { return { proposal: CORRECT[e.fileName], receipt }; } };
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&gt;/g, '>').replace(/\s+/g, ' ');

describe('AI interpretation panel', () => {
    it('shows the receipt, the proposed mapping and every gate, and labels the rationale as not evidence', async () => {
        const c = await processDocuments([doc('public/demo/unfamiliar', 'bank-statement-march-2026-export.csv'), doc('public/demo', 'demo-general-ledger-2026-03.csv')], undefined, undefined, { interpreter: recorded });
        const t = text(renderToStaticMarkup(createElement(InterpretationPanel, { context: c })));
        expect(t).toContain('AI proposal · verified');
        expect(t).toContain('openai/gpt-oss-120b · Groq');
        expect(t).toContain('Live · 3.2 s');
        expect(t).toContain('3306 / 1195');
        expect(t).toMatch(/Withdrawal \(RM\) Money out Heading agrees/);
        expect(t).toContain('Running balance agrees with every signed amount');
        expect(t).toContain('Model rationale (not evidence)');
        expect(t).toContain('It never supplies an amount');
    });
    it('renders nothing when no document needed interpretation', async () => {
        const c = await processDocuments([doc('public/demo', 'demo-bank-statement-2026-03.csv'), doc('public/demo', 'demo-general-ledger-2026-03.csv')]);
        expect(renderToStaticMarkup(createElement(InterpretationPanel, { context: c }))).toBe('');
    });
});
