import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {archiveRetiredOperation,clearResolvedOperation,createPendingOperation,pendingOperation,pendingOperationKey,retiredOperationKey,recoverCommittedOperation} from '../../lib/ai-ingestion/local-demo-operation';
function storage(raw:string){const entries=new Map([[pendingOperationKey,raw]]);return {getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};}
describe('browser pending-operation persistence (nonvisual)',()=>{
 it('round-trips the stored generation and original identity through reload',()=>{
  const id=randomUUID(),generation=randomUUID(),raw=createPendingOperation(id,generation),store=storage(raw);
  expect(pendingOperation(store.getItem(pendingOperationKey)!)).toEqual({operationId:id,generation});
  clearResolvedOperation(store,raw);expect(store.getItem(pendingOperationKey)).toBeNull();
 });
 it('archives an explicitly acknowledged discarded generation without retrying',()=>{
  const id=randomUUID(),old=randomUUID(),current=randomUUID(),raw=createPendingOperation(id,old),store=storage(raw);
  archiveRetiredOperation(store,raw,{state:'RETIRED_GENERATION',operationId:id,generation:old,currentGeneration:current},current);
  expect(store.getItem(pendingOperationKey)).toBeNull();expect(JSON.parse(store.getItem(retiredOperationKey)!)[0].reference).toBe(raw);
  const next=createPendingOperation(randomUUID(),old);store.setItem(pendingOperationKey,next);
  archiveRetiredOperation(store,next,{state:'RETIRED_GENERATION',operationId:pendingOperation(next).operationId,generation:old,currentGeneration:current},current);
  expect(JSON.parse(store.getItem(retiredOperationKey)!)).toHaveLength(2);
 });
 it('never clears unknown, processing, mismatched or same-generation uncertainty',()=>{
  const id=randomUUID(),generation=randomUUID(),raw=createPendingOperation(id,generation),store=storage(raw);
  for(const state of ['UNKNOWN','PROCESSING','NOT_REGISTERED','RETIRED_GENERATION'])expect(()=>archiveRetiredOperation(store,raw,{state,operationId:id,generation,currentGeneration:generation},generation)).toThrow();
  expect(()=>archiveRetiredOperation(store,raw,{state:'RETIRED',operationId:randomUUID(),generation,currentGeneration:generation},generation)).toThrow();
  expect(store.getItem(pendingOperationKey)).toBe(raw);
 });
 it('keeps references when archival fails or another tab has a different pending operation',()=>{
  const id=randomUUID(),generation=randomUUID(),raw=createPendingOperation(id,generation),store=storage(raw),receipt={state:'RETIRED',operationId:id,generation,currentGeneration:generation};
  expect(()=>archiveRetiredOperation({...store,setItem:()=>{throw new Error('quota');}},raw,receipt,generation)).toThrow('quota');expect(store.getItem(pendingOperationKey)).toBe(raw);
  store.setItem(pendingOperationKey,createPendingOperation(randomUUID(),generation));expect(()=>archiveRetiredOperation(store,raw,receipt,generation)).toThrow();expect(()=>clearResolvedOperation(store,raw)).toThrow();
 });
 it('preserves legacy IDs and requires an explicit server fence before archival',()=>{
  const raw=randomUUID(),current=randomUUID(),store=storage(raw);expect(pendingOperation(raw)).toEqual({operationId:raw,generation:null});
  expect(()=>archiveRetiredOperation(store,raw,{state:'UNKNOWN'},current)).toThrow();
  archiveRetiredOperation(store,raw,{state:'RETIRED',operationId:raw,generation:null,currentGeneration:current},current);expect(store.getItem(pendingOperationKey)).toBeNull();
  expect(()=>pendingOperation('broken marker')).toThrow();
 });
});

// Deterministic scheduling of separate tabs; not browser visual evidence.
function coordinatedTabs() {
 const raw=createPendingOperation(randomUUID(),randomUUID()),store=storage(raw);
 const jobs:(()=>void)[]=[];let held=false,active=true,updates=0;
 const locks={request:(name:string,options:{ifAvailable?:boolean},callback:(lock:Lock|null)=>unknown)=>new Promise((resolve,reject)=>{
  expect(name).toBe('fingence-synthetic-c1-demo');expect(options.ifAvailable).toBe(true);
  jobs.push(()=>{const available=!held;if(available)held=true;try{resolve(callback(available?{name} as Lock:null));}catch(error){reject(error);}finally{if(available)held=false;}});
 })} as unknown as Pick<LockManager,'request'>;
 const response={state:'COMMITTED',batchId:randomUUID(),sourceFile:'edge_cases.csv'};
 const recover=(overrides:Partial<Parameters<typeof recoverCommittedOperation>[0]>={})=>recoverCommittedOperation({locks,storage:store,raw,response,isActive:()=>active,onRecovered:()=>{expect(held).toBe(true);updates++;},...overrides});
 return {raw,store,locks,response,recover,flush:()=>jobs.shift()?.(),revoke:()=>{active=false;},hold:()=>{held=true;},updates:()=>updates,queued:()=>jobs.length};
}
describe('committed recovery shares the processing/retirement Web Lock',()=>{
 it('recovers a single committed operation and updates state while holding the lock',async()=>{
  const tabs=coordinatedTabs(),result=tabs.recover();expect(tabs.store.getItem(pendingOperationKey)).toBe(tabs.raw);tabs.flush();
  expect(await result).toBe(true);expect(tabs.store.getItem(pendingOperationKey)).toBeNull();expect(tabs.updates()).toBe(1);
 });
 it('allows only one of two tabs to acknowledge the same committed marker',async()=>{
  const tabs=coordinatedTabs(),first=tabs.recover(),second=tabs.recover();const rejected=expect(second).rejects.toThrow('changed');
  tabs.flush();tabs.flush();expect(await first).toBe(true);await rejected;expect(tabs.updates()).toBe(1);
 });
 it('preserves a newer marker installed before lock acquisition',async()=>{
  const tabs=coordinatedTabs(),result=tabs.recover(),rejected=expect(result).rejects.toThrow('changed');const newer=createPendingOperation(randomUUID(),randomUUID());
  tabs.store.setItem(pendingOperationKey,newer);tabs.flush();await rejected;expect(tabs.store.getItem(pendingOperationKey)).toBe(newer);expect(tabs.updates()).toBe(0);
 });
 it('does not erase an upload begun between two committed recoveries',async()=>{
  const tabs=coordinatedTabs(),first=tabs.recover(),newer=createPendingOperation(randomUUID(),randomUUID());
  const upload=tabs.locks.request('fingence-synthetic-c1-demo',{ifAvailable:true},lock=>{expect(lock).not.toBeNull();tabs.store.setItem(pendingOperationKey,newer);});
  const late=tabs.recover(),rejected=expect(late).rejects.toThrow('changed');tabs.flush();tabs.flush();tabs.flush();
  expect(await first).toBe(true);await upload;await rejected;expect(tabs.store.getItem(pendingOperationKey)).toBe(newer);expect(tabs.updates()).toBe(1);
 });
 it('retains the reference when the lock is occupied, missing or permission-denied',async()=>{
  const tabs=coordinatedTabs();tabs.hold();const unavailable=tabs.recover();tabs.flush();expect(await unavailable).toBe(false);
  expect(await tabs.recover({locks:undefined})).toBe(false);
  const denied={request:()=>Promise.reject(new Error('lock denied'))} as unknown as Pick<LockManager,'request'>;
  await expect(tabs.recover({locks:denied})).rejects.toThrow('lock denied');expect(tabs.store.getItem(pendingOperationKey)).toBe(tabs.raw);expect(tabs.updates()).toBe(0);
 });
 it('retains the reference and local state when storage read or removal fails',async()=>{
  for(const operation of ['getItem','removeItem'] as const){const tabs=coordinatedTabs();const broken={...tabs.store,[operation]:()=>{throw new Error('storage unavailable');}};
   const result=tabs.recover({storage:broken}),rejected=expect(result).rejects.toThrow('storage unavailable');tabs.flush();await rejected;
   expect(tabs.store.getItem(pendingOperationKey)).toBe(tabs.raw);expect(tabs.updates()).toBe(0);
  }
 });
 it('rechecks revocation after the response and before marker mutation',async()=>{
  const tabs=coordinatedTabs(),result=tabs.recover();tabs.revoke();tabs.flush();expect(await result).toBe(false);expect(tabs.store.getItem(pendingOperationKey)).toBe(tabs.raw);expect(tabs.updates()).toBe(0);
 });
 it('never clears PROCESSING, UNKNOWN or malformed responses and does not request a lock',async()=>{
  for(const response of [{state:'PROCESSING'},{state:'UNKNOWN'},{state:'COMMITTED',batchId:123,sourceFile:'edge_cases.csv'}]){
   const tabs=coordinatedTabs();expect(await tabs.recover({response})).toBe(false);expect(tabs.queued()).toBe(0);expect(tabs.store.getItem(pendingOperationKey)).toBe(tabs.raw);expect(tabs.updates()).toBe(0);
  }
 });
});
