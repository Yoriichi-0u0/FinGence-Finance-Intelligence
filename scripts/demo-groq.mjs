import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

if (!process.versions.node.startsWith('24.')) throw new Error('LOCAL_NODE_24_REQUIRED');
if (process.env.VERCEL || process.env.NODE_ENV === 'production') throw new Error('LOCAL_DEMO_ONLY');
if (!process.env.GROQ_API_KEY || /[\r\n]/.test(process.env.GROQ_API_KEY)) throw new Error('SET_GROQ_API_KEY_IN_SESSION');

const projectRoot = resolve('.');
const localRoot = resolve(projectRoot, '.local');
const vaultPath = resolve(localRoot, 'obsidian-demo-groq-vault');
if (!vaultPath.startsWith(`${localRoot}${sep}`)) throw new Error('SYNTHETIC_VAULT_PATH_INVALID');
const rootStat = await lstat(localRoot).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
if (rootStat && (!rootStat.isDirectory() || rootStat.isSymbolicLink())) throw new Error('LOCAL_PATH_INVALID');
const vaultStat = await lstat(vaultPath).catch(error => error.code === 'ENOENT' ? null : Promise.reject(error));
if (vaultStat && (!vaultStat.isDirectory() || vaultStat.isSymbolicLink())) throw new Error('SYNTHETIC_VAULT_PATH_INVALID');

const hostEnv = {};
for (const name of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PATHEXT', 'ComSpec']) {
    if (process.env[name] !== undefined) hostEnv[name] = process.env[name];
}
const demoEnv = { ...hostEnv, NODE_ENV: 'development', VERCEL: '', GROQ_API_KEY: process.env.GROQ_API_KEY,
    FINGENCE_OBSIDIAN_DEMO: '1', FINGENCE_POC_GROQ: '0', FINGENCE_OBSIDIAN_SYNTHETIC_ONLY: '1', FINGENCE_OBSIDIAN_VAULT_PATH: vaultPath };
for (const name of [
    'FINGENCE_POC_LOCAL', 'FINGENCE_M2_LOCAL', 'FINGENCE_M3_LOCAL', 'FINGENCE_M4_LOCAL', 'FINGENCE_M5_LOCAL',
    'FINGENCE_AI_GATEWAY', 'FINGENCE_AI_LOCAL', 'FINGENCE_V2_I1_LOCAL', 'FINGENCE_AI03_LOCAL',
    'FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED', 'FINGENCE_AI03_FREE_PLAN_CONFIRMED',
    'FINGENCE_M4_SINGLE_DISPATCH_AUTHORIZED', 'FINGENCE_PROCESSING_JOBS',
]) demoEnv[name] = '0';
for (const name of ['GROQ_API_KEY2', 'FINGENCE_AI_BUDGET_REST_URL', 'FINGENCE_AI_BUDGET_REST_TOKEN',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) demoEnv[name] = '';

const require = createRequire(import.meta.url);
const generatorEnv = { ...demoEnv, FINGENCE_AI_LOCAL: '1', FINGENCE_V2_I1_LOCAL: '1' };
delete generatorEnv.GROQ_API_KEY;
process.stdout.write('Demo mode: local development only\nGroq key: configured (value hidden)\nGenerating isolated synthetic vault from the server pipeline...\n');
const generated = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--conditions=react-server', 'scripts/obsidian-demo.mjs', 'generate'], { cwd: projectRoot, env: generatorEnv, stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { output += chunk; });
    child.once('error', reject); child.once('exit', code => {
        if (code !== 0) { reject(new Error('SYNTHETIC_VAULT_GENERATION_FAILED')); return; }
        try { resolvePromise(JSON.parse(output)); } catch { reject(new Error('SYNTHETIC_VAULT_GENERATION_FAILED')); }
    });
});
if (generated.status !== 'GENERATED_FROM_SERVER_PIPELINE') throw new Error('SYNTHETIC_VAULT_GENERATION_FAILED');
process.stdout.write(`Synthetic vault: generated from server pipeline (${generated.period}, ${generated.currency}, ${generated.processingId})\n`);

const entries = await readdir(vaultPath, { withFileTypes: true });
const notes = entries.filter(entry => entry.isFile() && /^FinGence Synthetic Finance Summary - \d{4}-\d{2}\.md$/.test(entry.name));
if (entries.length !== 1 || notes.length !== 1) throw new Error('SYNTHETIC_VAULT_REQUIRED');
const noteText = await readFile(resolve(vaultPath, notes[0].name), 'utf8');
if (!/^data_classification:\s*synthetic\s*$/m.test(noteText)) throw new Error('SYNTHETIC_VAULT_REQUIRED');

process.stdout.write('Synthetic-only check: passed (one generated summary note; no uploaded source files)\n');
process.stdout.write('Loopback bind requested: 127.0.0.1 only\nDemo URL: http://127.0.0.1:3190/chatbot\nProvider calls: none during startup\n');
const childEnv = { ...demoEnv };
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3190'], { cwd: projectRoot, env: childEnv, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', error => { process.stderr.write(`Demo server failed to start: ${error.message}\n`); process.exitCode = 1; });
child.once('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });

