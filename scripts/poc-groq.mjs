// Local-only signed-in Finance chat. Groq receives only a reviewed server-computed summary.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

if (process.env.VERCEL || process.env.NODE_ENV === 'production' || !process.versions.node.startsWith('24.')) throw Error('LOCAL_NODE_24_REQUIRED');
if (!process.env.GROQ_API_KEY || /[\r\n]/.test(process.env.GROQ_API_KEY)) throw Error('SET_GROQ_API_KEY_IN_SESSION');

const env = {
    ...process.env,
    NODE_ENV: 'development',
    FINGENCE_AI_LOCAL: '1',
    FINGENCE_V2_I1_LOCAL: '1',
    FINGENCE_M2_LOCAL: '1',
    FINGENCE_M3_LOCAL: '1',
    FINGENCE_M4_LOCAL: '1',
    FINGENCE_M5_LOCAL: '1',
    FINGENCE_POC_LOCAL: '1',
    FINGENCE_POC_GROQ: '1',
    FINGENCE_OBSIDIAN_DEMO: '0',
    FINGENCE_OBSIDIAN_SYNTHETIC_ONLY: '0',
    FINGENCE_OBSIDIAN_VAULT_PATH: '',
    FINGENCE_AI_GATEWAY: '0',
};
for (const name of Object.keys(env)) {
    if (/OLLAMA|OPENAI|DISPATCH_AUTHORIZED|AUTHORIZATION_ID|GROQ_API_KEY2/.test(name)) delete env[name];
    if (/^(FINGENCE_AI_BUDGET_REST_URL|FINGENCE_AI_BUDGET_REST_TOKEN|UPSTASH_REDIS_REST_URL|UPSTASH_REDIS_REST_TOKEN|KV_REST_API_URL|KV_REST_API_TOKEN)$/.test(name)) delete env[name];
}
const port = process.env.FINGENCE_POC_GROQ_PORT ?? '3191';
if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw Error('LOCAL_PORT_REQUIRED');
process.stdout.write('Local Finance Groq chat: enabled (API key hidden)\n');
process.stdout.write('Uploads: read by the signed-in local server; only reviewed computed summaries can be sent to Groq\n');
process.stdout.write('URL: http://127.0.0.1:' + port + '/chatbot\n');
process.stdout.write('Stop with Ctrl+C. Do not run alongside poc:dev because both use the same local database.\n');
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', port], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });

