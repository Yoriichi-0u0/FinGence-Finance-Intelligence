import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const modulePath = resolve('scripts/ai-i2-report.mjs');
const execute = (cwd: string) => spawnSync(process.execPath, ['--input-type=module', '-e',
  `import {saveI2Report} from ${JSON.stringify(new URL(`file://${modulePath}`).href)}; console.log(JSON.stringify(saveI2Report({origin:'RECORDED_TEST'},${JSON.stringify('Synthetic report\n')})))`], { cwd, encoding: 'utf8' });

describe('private evaluation reports', () => {
  it('creates parseable owner-only reports', () => {
    const root = mkdtempSync(join(tmpdir(), 'fingence-i2-report-'));
    try {
      const result = execute(root); expect(result.status).toBe(0);
      const paths = JSON.parse(result.stdout) as { json: string; text: string };
      expect(JSON.parse(readFileSync(join(root, paths.json), 'utf8'))).toEqual({ origin: 'RECORDED_TEST' });
      expect(readFileSync(join(root, paths.text), 'utf8')).toBe('Synthetic report\n');
      expect(statSync(join(root, paths.json)).mode & 0o777).toBe(0o600);
      expect(statSync(join(root, paths.text)).mode & 0o777).toBe(0o600);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('rejects a symlinked private state directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'fingence-i2-report-'));
    try {
      symlinkSync(tmpdir(), join(root, '.ai-local'));
      const result = execute(root); expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('UNSAFE_REPORT_DIRECTORY');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('preflights and rejects an unsafe directory before any dispatch is attempted', () => {
    const root = mkdtempSync(join(tmpdir(), 'fingence-i2-report-'));
    try {
      symlinkSync(tmpdir(), join(root, '.ai-local'));
      const script = `import {prepareI2ReportDestination} from ${JSON.stringify(new URL(`file://${modulePath}`).href)}; prepareI2ReportDestination(); console.log('DISPATCH_MAY_START')`;
      const result = spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8'});
      expect(result.status).not.toBe(0); expect(result.stderr).toContain('UNSAFE_REPORT_DIRECTORY'); expect(result.stdout).not.toContain('DISPATCH_MAY_START');
    } finally { rmSync(root, { recursive:true, force:true }); }
  });
});
