// Correlation references only. These are never session or authorization evidence.
export const pendingOperationKey='fingence-synthetic-financial-pending-v1';
export const retiredOperationKey='fingence-synthetic-financial-retired-v1';
export const syntheticOperationLock='fingence-synthetic-c1-demo';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function pendingOperation(raw:string) {
 if(uuid.test(raw))return {operationId:raw,generation:null}; // Retain pre-fix references.
 try{const value=JSON.parse(raw);if(value.version===2&&uuid.test(value.operationId)&&uuid.test(value.generation))return {operationId:value.operationId as string,generation:value.generation as string};}catch{}
 throw new Error('Invalid pending reference; preserve it for investigation.');
}
export function createPendingOperation(operationId:string,generation:string) {
 if(!uuid.test(operationId)||!uuid.test(generation))throw new Error('Invalid operation reference.');
 return JSON.stringify({version:2,operationId,generation});
}
type Storage=Pick<globalThis.Storage,'getItem'|'setItem'|'removeItem'>;
// Callers must hold syntheticOperationLock; this compare/remove is not atomic.
export function clearResolvedOperation(storage:Storage,raw:string) {
 if(storage.getItem(pendingOperationKey)!==raw)throw new Error('Pending reference changed in another tab.');
 storage.removeItem(pendingOperationKey);
}
// Call only after lookup completes. The callback is synchronous: neither lookup
// nor subsequent financial retrieval holds the shared cross-tab mutation lock.
export async function recoverCommittedOperation(input:{locks:Pick<LockManager,'request'>|undefined;storage:Storage;raw:string;response:unknown;isActive:()=>boolean;onRecovered:()=>void}) {
 const {locks,storage,raw,isActive,onRecovered}=input;
 const response=input.response as {state?:unknown;batchId?:unknown;sourceFile?:unknown}|null;
 if(!locks||response?.state!=='COMMITTED'||typeof response.batchId!=='string'||typeof response.sourceFile!=='string')return false;
 return locks.request(syntheticOperationLock,{ifAvailable:true},lock=>{
  if(!lock||!isActive())return false;
  pendingOperation(raw);
  clearResolvedOperation(storage,raw);
  onRecovered();
  return true;
 });
}
export function archiveRetiredOperation(storage:Storage,raw:string,receipt:unknown,currentGeneration:string) {
 const pending=pendingOperation(raw);
 const value=receipt as {state?:string;operationId?:string;generation?:string|null;currentGeneration?:string};
 if(!value||value.operationId!==pending.operationId||value.generation!==pending.generation||value.currentGeneration!==currentGeneration||!uuid.test(currentGeneration)||
  !(value.state==='RETIRED'||(value.state==='RETIRED_GENERATION'&&pending.generation!==null&&pending.generation!==currentGeneration)))throw new Error('Retirement is not confirmed.');
 if(storage.getItem(pendingOperationKey)!==raw)throw new Error('Pending reference changed in another tab.');
 // Save the original identity before removing the blocking marker. Storage failure
 // leaves processing blocked. No financial values or credentials are retained.
 const history=JSON.parse(storage.getItem(retiredOperationKey)??'[]');
 if(!Array.isArray(history))throw new Error('Retired reference history is invalid.');
 storage.setItem(retiredOperationKey,JSON.stringify([...history,{reference:raw,receipt:value}]));
 clearResolvedOperation(storage,raw);
}
