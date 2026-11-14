import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createGPTSavedEvidenceReader} from '../../lib/server/reconciliation/gpt-saved-evidence';
import {assertGroupGPTConnection} from '../../lib/server/reconciliation/gpt-runtime';
import type {TransactionDatabase,SqlConnection} from '../../lib/server/db/postgres';
const id='a'.repeat(64),token='A'.repeat(43),expected={userId:'user',organizationId:'org'};
function fixture(){
 const settings={compatible:true,principal:expected,job:true,audit:true,runs:[{evidence_id:'e'}],items:[{evidence_id:'e'}]};
 const calls:Array<{sql:string;values:unknown[]}> = [];
 const tx={query:vi.fn(async(sql:string,values:unknown[]=[])=>{
  calls.push({sql,values});let rows:Record<string,unknown>[]=[];
  if(sql.includes(' AS compatible'))rows=[{compatible:settings.compatible}];
  else if(sql.includes('principal() p'))rows=[{user_id:settings.principal.userId,organization_id:settings.principal.organizationId}];
  else if(sql.startsWith('SELECT processing_id'))rows=settings.job?[{processing_id:id}]:[];
  else if(sql.startsWith('SELECT * FROM fingence_reconciliation.gpt_runs'))rows=settings.runs;
  else if(sql.startsWith('SELECT i.*'))rows=settings.items;
  else if(sql.startsWith('INSERT INTO fingence_reconciliation.audit')&&!settings.audit)throw Error('audit denied');
  return {rows,rowCount:rows.length};
 })} as unknown as SqlConnection;
 const transaction=vi.fn();const db={transaction:async<T>(work:(tx:SqlConnection)=>Promise<T>)=>{transaction();return work(tx);},close:async()=>{}} satisfies TransactionDatabase;
 return {settings,calls,transaction,read:createGPTSavedEvidenceReader(db).listSavedGPTEvidence};
}
it('reads tenant/job-bound saved evidence and references, committing READ audit before returning',async()=>{
 const f=fixture();expect(await f.read(token,id,expected)).toEqual({runs:[{evidence_id:'e'}],items:[{evidence_id:'e'}]});
 const joined=f.calls.find(c=>c.sql.startsWith('SELECT i.*'))!;expect(joined.values).toEqual(['org',id,['e']]);expect(joined.sql).toContain('b.organization_id=i.organization_id');expect(joined.sql).toContain('b.processing_id=i.processing_id');
 expect(f.calls.at(-1)?.sql).toContain("'READ'");expect(f.calls.at(-1)?.values).toEqual(['org',id,'user']);
 expect(f.calls.filter(c=>/^INSERT/.test(c.sql))).toHaveLength(1);
});
it('denies incompatible/privileged runtime before principal or evidence queries',async()=>{
 const f=fixture();f.settings.compatible=false;await expect(f.read(token,id,expected)).rejects.toThrow('GROUP_GPT_RUNTIME_CONTRACT_DENIED');expect(f.calls).toHaveLength(1);
});
it('denies mismatched actors/tenants and missing jobs without evidence or audit writes',async()=>{
 for(const mode of ['user','organization','job']){
  const f=fixture();if(mode==='user')f.settings.principal={...expected,userId:'other'};if(mode==='organization')f.settings.principal={...expected,organizationId:'other'};if(mode==='job')f.settings.job=false;
  await expect(f.read(token,id,expected)).rejects.toThrow('ACCESS_DENIED');expect(f.calls.some(c=>c.sql.includes('FROM fingence_reconciliation.gpt_runs'))).toBe(false);expect(f.calls.some(c=>c.sql.startsWith('INSERT'))).toBe(false);
 }
});
it('returns audited empty evidence and never invents items',async()=>{
 const f=fixture();f.settings.runs=[];expect(await f.read(token,id,expected)).toEqual({runs:[],items:[]});expect(f.calls.some(c=>c.sql.startsWith('SELECT i.*'))).toBe(false);expect(f.calls.at(-1)?.sql).toContain("'READ'");
});
it('withholds evidence on audit denial, without retries',async()=>{
 const f=fixture();f.settings.audit=false;await expect(f.read(token,id,expected)).rejects.toThrow('audit denied');expect(f.transaction).toHaveBeenCalledTimes(1);
});
it('keeps Production reads disabled before connecting and rejects malformed capabilities/IDs',async()=>{
 const f=fixture();vi.stubEnv('NODE_ENV','production');try{await expect(f.read(token,id,expected)).rejects.toThrow('GPT_LOCAL_ONLY');expect(f.transaction).not.toHaveBeenCalled();}finally{vi.unstubAllEnvs();}
 await expect(f.read(token,'bad',expected)).rejects.toThrow('ACCESS_DENIED');await expect(f.read('bad',id,expected)).rejects.toThrow('ACCESS_DENIED');
});
it('rejects other projects, unverified TLS and owner credentials in trusted runtime configuration',()=>{
 const config={host:'db.zmtdozblpvtjniehwjrw.supabase.co',port:5432,database:'postgres',user:'restricted_login',ssl:{rejectUnauthorized:true}};
 expect(()=>assertGroupGPTConnection(config)).not.toThrow();for(const change of [{host:'db.other.supabase.co'},{user:'postgres'},{ssl:{rejectUnauthorized:false}}])expect(()=>assertGroupGPTConnection({...config,...change})).toThrow();
});
