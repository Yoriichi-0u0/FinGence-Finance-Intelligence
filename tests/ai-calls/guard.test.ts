import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every AI model call goes through the AI-call door (lib/ai-calls), so it appears on the Technical log. A file that
 * talks to a model provider directly must also use withAiCall. If this test fails for your file, wrap the call:
 * see docs/ai-integration/ai-calls.md.
 */
const ROOTS = ['lib', 'app', 'components', 'scripts'];
const SOURCE = /\.(ts|tsx|js|mjs|cjs)$/;
const MODEL_CALL = /api\.groq\.com|api\.openai\.com|new OpenAI\(|new Groq\(|from ['"]groq-sdk['"]|require\(['"]groq-sdk['"]\)|\.chat\.completions\.create\(|\.responses\.create\(/;
const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : SOURCE.test(name) ? [path] : [];
});

describe('the AI-call door is the only way to a model', () => {
    const callers = ROOTS.flatMap(files).filter(f => MODEL_CALL.test(readFileSync(f, 'utf8')));
    it('finds the known model clients (so the guard is really looking)', () => {
        expect(callers).toContain(join('lib', 'server', 'ai', 'groq.ts'));
    });
    it('every file that calls a model provider goes through withAiCall', () => {
        const bypass = callers.filter(f => !/\bwithAiCall\b|\bstructuredCompletion\b/.test(readFileSync(f, 'utf8')));
        expect(bypass, `These files call an AI model without the door. Wrap the call in withAiCall (docs/ai-integration/ai-calls.md): ${bypass.join(', ')}`).toEqual([]);
    });
});
