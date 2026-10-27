import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { minimalEnvironment } from './native.mjs';

if(process.argv.slice(2).some(arg=>arg!=='--regressions'))throw new Error('Usage: node scripts/db03/run.mjs [--regressions]');
const regressions=process.argv.includes('--regressions');
if(execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim()!=='feature/backend-api-celester')throw new Error('Wrong development branch');
execFileSync('git',['merge-base','--is-ancestor','3637faa10fd1f42304d983ff5be420e9ec72dea8','HEAD']);
const output = path.resolve('docs/database/db03/evidence',new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(output,{recursive:true});
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'fingence-db03-run-'));
fs.writeFileSync(path.join(temp,'empty-pgpass'),''); fs.writeFileSync(path.join(temp,'empty-service'),'');
const bin=process.env.DB03_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
const env={...minimalEnvironment(temp,bin), DB03_PG_BIN:bin, DB03_REQUIRED:'1', DB03_EVIDENCE:output};
const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','scripts/db03/vitest.config.mts',
  'tests/recovery',...(regressions?['tests/api','tests/persistence','tests/integration/grouped-consultation.test.ts']:[]),
  '--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile=${path.join(output,'vitest.json')}`],
{env,stdio:'inherit',shell:false,windowsHide:true});
fs.writeFileSync(path.join(output,'runner.json'),JSON.stringify({regressions,exitCode:result.status,error:result.error?.message||null},null,2));
console.log(`DB03 sanitized evidence: ${output}`);
// The run wrapper owns only these two empty configuration sentinels.
fs.unlinkSync(path.join(temp,'empty-pgpass'));fs.unlinkSync(path.join(temp,'empty-service'));
if(fs.readdirSync(temp).length===0)fs.rmdirSync(temp);
else console.log(`DB03 retained failure diagnostics: ${temp}`);
if(result.status!==0)process.exitCode=1;
