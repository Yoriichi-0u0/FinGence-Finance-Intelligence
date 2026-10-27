// Fresh local cluster only; application connection variables are never consumed.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
const bin = process.env.DB01_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const root = mkdtempSync(join(tmpdir(), 'fingence-db01-'));
const data = join(root, 'data');
const output = resolve('docs/database/db01', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(output, { recursive: true });
function run(command, args, env = process.env) {
  const p = spawnSync(command, args, { stdio: 'inherit', env, windowsHide: true });
  if (p.error || p.status !== 0) throw new Error(`${command} failed: ${p.error?.message || p.status}`);
}
const server = createServer();
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise(r => server.close(r));
let started = false;
try {
  run(join(bin, 'initdb.exe'), ['-D', data, '-U', 'db01', '-A', 'trust', '--no-locale', '--encoding=UTF8']);
  run(join(bin, 'pg_ctl.exe'), ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  started = true;
  run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/benchmarks/db01.test.ts', '--maxWorkers=1'], {
    ...process.env, DB01_PORT: String(port), DB01_OUTPUT: output, DB01_CLUSTER: root,
  });
} catch (error) {
  writeFileSync(join(output, 'failure.json'), JSON.stringify({ error: String(error), cluster: root }, null, 2));
  process.exitCode = 1;
} finally {
  if (started) run(join(bin, 'pg_ctl.exe'), ['-D', data, '-m', 'fast', '-w', 'stop']);
  console.log(`DB01 artifacts: ${output}\nDisposable cluster files retained at: ${root}`);
}
