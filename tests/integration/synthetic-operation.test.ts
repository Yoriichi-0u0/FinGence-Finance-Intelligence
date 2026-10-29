import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {archiveRetiredOperation,clearResolvedOperation,createPendingOperation,pendingOperation,pendingOperationKey,retiredOperationKey} from '../../lib/ai-ingestion/local-demo-operation';
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
