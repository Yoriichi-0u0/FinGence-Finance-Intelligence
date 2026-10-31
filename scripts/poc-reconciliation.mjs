// Local-only launcher; this checkout's existing M2/M5 database and identity, never hosted infrastructure.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
if (process.env.VERCEL || process.env.NODE_ENV === 'production' || !process.versions.node.startsWith('24.')) throw Error('LOCAL_NODE_24_REQUIRED');
const env = { ...process.env, NODE_ENV: 'development', FINGENCE_AI_LOCAL: '1', FINGENCE_V2_I1_LOCAL: '1', FINGENCE_M2_LOCAL: '1', FINGENCE_M3_LOCAL: '1', FINGENCE_M4_LOCAL: '1', FINGENCE_M5_LOCAL: '1', FINGENCE_POC_LOCAL: '1' };
for (const name of Object.keys(env)) if (/GROQ|OLLAMA|OPENAI|DISPATCH_AUTHORIZED|AUTHORIZATION_ID/.test(name)) delete env[name];
const port = process.env.FINGENCE_POC_PORT ?? '3186';
if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw Error('LOCAL_PORT_REQUIRED');
const require = createRequire(import.meta.url), child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', port], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
