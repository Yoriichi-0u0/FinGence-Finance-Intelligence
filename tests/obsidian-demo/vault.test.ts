import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { retrieveObsidianPassages } from '../../lib/server/obsidian-demo/vault';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

afterEach(() => vi.unstubAllEnvs());

describe('Obsidian demo retrieval access gate', () => {
    it('refuses retrieval when the separate demo flag is unset', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('FINGENCE_OBSIDIAN_DEMO', '');
        const request = new Request('http://127.0.0.1:3186/internal/test', { headers: { host: '127.0.0.1:3186' } });
        await expect(retrieveObsidianPassages(request, 'cash in March')).rejects.toThrow('OBSIDIAN_DEMO_DISABLED');
    });

    it('refuses retrieval from a non-loopback caller even when the flag is enabled', async () => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('FINGENCE_OBSIDIAN_DEMO', '1');
        const request = new Request('http://example.com/internal/test', { headers: { host: 'example.com', origin: 'http://example.com' } });
        await expect(retrieveObsidianPassages(request, 'cash in March')).rejects.toThrow('OBSIDIAN_DEMO_LOOPBACK_REQUIRED');
    });

    it('rejects uploaded or non-generated notes in synthetic-only demo mode', async () => {
        vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('FINGENCE_OBSIDIAN_DEMO', '1');
        vi.stubEnv('FINGENCE_OBSIDIAN_SYNTHETIC_ONLY', '1'); vi.stubEnv('FINGENCE_OBSIDIAN_VAULT_PATH', 'temp/obsidian-synthetic-gate-test');
        const vault = resolve('.local', 'temp', 'obsidian-synthetic-gate-test');
        await mkdir(vault, { recursive: true });
        await writeFile(resolve(vault, 'private-upload.md'), '# Private upload\n\nShould never be read.\n', 'utf8');
        try {
            const request = new Request('http://127.0.0.1:3186/internal/test', { headers: { host: '127.0.0.1:3186', origin: 'http://127.0.0.1:3186' } });
            await expect(retrieveObsidianPassages(request, 'cash in March')).rejects.toThrow('OBSIDIAN_SYNTHETIC_VAULT_REQUIRED');
        } finally { await rm(vault, { recursive: true, force: true }); }
    });
});
