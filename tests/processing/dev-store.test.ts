import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The local development store must answer the FinGence server only, never a web page in a browser on this machine.
const port = 54391, url = `http://127.0.0.1:${port}/rest/v1/rpc/fingence_processing_set_paused`;
const body = JSON.stringify({ org: 'fingence-default', p_paused: true, reason: 'from a web page' });
let store: ChildProcess, dir: string;
beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fingence-dev-store-'));
    store = spawn(process.execPath, ['scripts/dev-store.mjs'], { env: { ...process.env, FINGENCE_DEV_STORE_PORT: String(port), FINGENCE_DEV_STORE_DIR: join(dir, 'db') }, stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((resolve, reject) => { store.stdout!.on('data', (d: Buffer) => { if (String(d).includes('local store on')) resolve(); }); store.on('exit', () => reject(Error('store exited'))); });
}, 60_000);
afterAll(() => { store?.kill(); rmSync(dir, { recursive: true, force: true }); });

describe('local development store', () => {
    it('refuses requests that come from a browser', async () => {
        const cases: Record<string, string>[] = [
            { 'content-type': 'text/plain' },
            { 'content-type': 'application/json', origin: 'https://evil.example' },
            { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors' },
        ];
        for (const headers of cases) expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(403);
        expect((await fetch(url, { method: 'OPTIONS' })).status).toBe(403);
        const state = await fetch(`http://127.0.0.1:${port}/rest/v1/rpc/fingence_processing_state`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ org: 'fingence-default' }) });
        expect((await state.json() as { paused: boolean }).paused).toBe(false);
    });
    it('answers the FinGence server (JSON, no browser headers, loopback host)', async () => {
        const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ org: 'fingence-default', p_paused: false, reason: null }) });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ paused: false });
    });
});
