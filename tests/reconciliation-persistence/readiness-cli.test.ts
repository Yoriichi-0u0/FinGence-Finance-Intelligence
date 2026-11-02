import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const run=(mode:string,env:Readonly<Record<string,string|undefined>>={})=>spawnSync(process.execPath,['--conditions=react-server','scripts/db04-readiness.mjs',mode],{encoding:'utf8',windowsHide:true,timeout:30000,env:{...process.env,...env}});
it('emits an executable ordered checksum plan without claiming deployment approval',()=>{
 const result=run('plan');expect(result.status).toBe(0);const plan=JSON.parse(result.stdout);
 expect(plan.hostedDeploymentAuthorized).toBe(false);expect(plan.migrations).toHaveLength(7);
 expect(plan.teamProjectAccess).toBe('FORBIDDEN');expect(plan.foundationReferences).toHaveLength(6);
 expect(plan.foundationReferences.every((r:{execution:string})=>r.execution==='REFERENCE_ONLY_NOT_AN_EXECUTION_SEQUENCE')).toBe(true);
 for(const migration of plan.migrations)expect(migration.sha256).toBe(createHash('sha256').update(readFileSync('supabase/sql/'+migration.name)).digest('hex'));
});
it('never falls back to the application database URL for inspection',()=>{
 const result=run('inspect',{DB04_INSPECTION_DATABASE_URL:'',SUPABASE_DATABASE_URL:'postgresql://unused:synthetic-secret@invalid/postgres'});
 expect(result.status).toBe(2);expect(JSON.parse(result.stdout)).toEqual({status:'BLOCKED',reason:'DEDICATED_INSPECTION_CONNECTION_REQUIRED'});expect(result.stdout+result.stderr).not.toContain('synthetic-secret');
});
it('rejects unapproved hosted inspection before connecting and suppresses credentials',()=>{
 const result=run('inspect',{DB04_INSPECTION_DATABASE_URL:`postgresql://catalog_inspector:synthetic-secret@db.${'a'.repeat(20)}.supabase.co:5432/postgres?sslmode=require`,DB04_INSPECTION_ROLE:'catalog_inspector',DB04_INSPECTION_DATABASE:'postgres',DB04_HOSTED_INSPECTION_AUTHORIZATION:''});
 expect(result.status).toBe(2);expect(JSON.parse(result.stdout).reason).toBe('EXPLICIT_FYP_A_READ_ONLY_APPROVAL_REQUIRED');expect(result.stdout+result.stderr).not.toContain('synthetic-secret');
});
