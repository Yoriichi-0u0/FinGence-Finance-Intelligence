import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
if (!process.versions.node.startsWith('24.')) throw new Error('Use Node.js 24.x');
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3107'], {
 stdio: 'inherit', env: { ...process.env, FINGENCE_AI_LOCAL: '1', FINGENCE_AI03_LOCAL: '1', FINGENCE_AI_PYTHON: resolve(process.platform === 'win32' ? '.venv-ai/Scripts/python.exe' : '.venv-ai/bin/python') },
});
console.log('Local Increment 03: http://127.0.0.1:3107/ai-ingestion/live — no credentials created; no replay fallback.');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
