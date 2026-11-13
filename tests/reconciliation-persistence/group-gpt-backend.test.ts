import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {assertGroupGPTConnection,groupGPTRuntimeDatabase,createGroupGPTBackend,GROUP_GPT_CONTRACT} from '../../lib/server/reconciliation/group-gpt-backend';
import type {TransactionDatabase,SqlConnection,TransactionOptions} from '../../lib/server/db/postgres';
const config={host:`db.${GROUP_GPT_CONTRACT.projectRef}.supabase.co`,port:5432,database:'postgres',user:'approved_group_runtime_login',ssl:{rejectUnauthorized:true}};
it('pins group direct connection and verified TLS without constructing a pool',()=>{
 expect(()=>assertGroupGPTConnection(config)).not.toThrow();
 for(const change of [{host:'db.unrelated.supabase.co'},{port:6543},{database:'other'},{user:'postgres'},{user:'service_role'},{user:GROUP_GPT_CONTRACT.runtime},{ssl:false},{ssl:{rejectUnauthorized:false}}])
  expect(()=>assertGroupGPTConnection({...config,...change})).toThrow('GROUP_GPT_RESTRICTED_CONNECTION_REQUIRED');
});
it('fails closed before callback on missing or incompatible runtime contract',async()=>{
 for(const rows of [[],[{compatible:false}],[{compatible:null}]]){
  const tx={query:vi.fn().mockResolvedValue({rows,rowCount:rows.length})} as unknown as SqlConnection;
  const db={transaction:async<T>(work:(c:SqlConnection)=>Promise<T>)=>work(tx),close:vi.fn()} satisfies TransactionDatabase;
  const work=vi.fn();await expect(groupGPTRuntimeDatabase(db).transaction(work)).rejects.toThrow('GROUP_GPT_RUNTIME_CONTRACT_DENIED');expect(work).not.toHaveBeenCalled();
 }
});
it('checks the same connection on each transaction and preserves transaction options',async()=>{
 const tx={query:vi.fn().mockResolvedValue({rows:[{compatible:true}],rowCount:1})} as unknown as SqlConnection;
 const observed=vi.fn();
 const db={transaction:async<T>(work:(c:SqlConnection)=>Promise<T>,options?:TransactionOptions)=>{observed(options);return work(tx);},close:vi.fn()} satisfies TransactionDatabase;
 const guarded=groupGPTRuntimeDatabase(db),work=vi.fn(async(c:SqlConnection)=>{expect(c).toBe(tx);return 'ok';});
 expect(await guarded.transaction(work,{isolationLevel:'READ COMMITTED'})).toBe('ok');await guarded.transaction(work);
 expect(tx.query).toHaveBeenCalledTimes(2);expect(observed).toHaveBeenCalledWith({isolationLevel:'READ COMMITTED'});
 await guarded.close();expect(db.close).toHaveBeenCalledTimes(1);
});
it('retains Production activation guards before any DB or provider access',async()=>{
 const transaction=vi.fn(),db={transaction,close:vi.fn()} as TransactionDatabase;
 const backend=createGroupGPTBackend(db,{bank:'b'.repeat(64),ledger:'c'.repeat(64)}),provider={kind:'GROQ' as const,suggest:vi.fn()};
 vi.stubEnv('NODE_ENV','production');try{
  await expect(backend.proposeGPT('A'.repeat(43),'a'.repeat(64),provider)).rejects.toThrow('GPT_LOCAL_ONLY');
  await expect(backend.getGPTEvidence('A'.repeat(43),'a'.repeat(64),'d'.repeat(64))).rejects.toThrow('GPT_LOCAL_ONLY');
  expect(transaction).not.toHaveBeenCalled();expect(provider.suggest).not.toHaveBeenCalled();
 }finally{vi.unstubAllEnvs();}
});
