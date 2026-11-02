// Synthetic local laboratory only; accepts no database URL or target arguments.
import {spawnSync} from 'node:child_process';
if(process.argv.length>2)throw Error('LOCAL_LAB_ACCEPTS_NO_TARGET_ARGUMENTS');
const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','tests/reconciliation-persistence','tests/persistence/db02.integrity.test.ts','--maxWorkers=1'],{
 stdio:'inherit',windowsHide:true,env:{...process.env,DB04_E5_SMOKE:'1'}});
process.exitCode=result.status??1;
