/** Browser state fencing only. Server authentication and ownership remain authoritative. */
export interface M2ClientPrincipal {
  userId: string;
  organizationId: string;
  role: 'Finance' | 'Technical (Management)' | 'Admin';
  membershipVersion: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function clientPrincipal(value: unknown): M2ClientPrincipal {
  if (!value || typeof value !== 'object') throw new Error('INVALID_SESSION');
  const p = value as M2ClientPrincipal;
  if (!uuid.test(p.userId) || !uuid.test(p.organizationId) || !['Finance','Technical (Management)','Admin'].includes(p.role) || !Number.isSafeInteger(p.membershipVersion) || p.membershipVersion < 1) throw new Error('INVALID_SESSION');
  return {userId:p.userId,organizationId:p.organizationId,role:p.role,membershipVersion:p.membershipVersion};
}
export const principalScope = (p: M2ClientPrincipal) => JSON.stringify([p.userId,p.organizationId]);
const accessScope = (p: M2ClientPrincipal | null) => p ? JSON.stringify([principalScope(p),p.role,p.membershipVersion]) : null;
export class M2ClientFence {
  epoch = 0;
  principal: M2ClientPrincipal | null = null;
  observe(value: unknown): boolean {
    // Validation is atomic: a thrown observation does not advance the response epoch.
    // The request catch can then invalidate the client display using its captured epoch.
    const next=clientPrincipal(value),changed=accessScope(next)!==accessScope(this.principal);
    if(changed){this.epoch++;this.principal=next;}
    return changed;
  }
  invalidate(): number {this.principal=null;return ++this.epoch;}
}
export interface PendingStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void}
export const legacyPendingKey='fingence-m2-pending-operation-v1';
const pendingKey=(p:M2ClientPrincipal)=>'fingence-m2-pending-operation-v2:'+principalScope(p);
export function readPending(storage:PendingStorage,p:M2ClientPrincipal){return storage.getItem(pendingKey(p));}
export function retainPending(storage:PendingStorage,p:M2ClientPrincipal,id:string){
  if(!uuid.test(id)||readPending(storage,p))throw new Error('PENDING_OPERATION_UNRESOLVED');
  storage.setItem(pendingKey(p),id);
  if(readPending(storage,p)!==id)throw new Error('PENDING_STORAGE_UNCONFIRMED');
}
export function retirePending(storage:PendingStorage,p:M2ClientPrincipal,id:string){
  if(readPending(storage,p)!==id)throw new Error('PENDING_OPERATION_CHANGED');
  storage.removeItem(pendingKey(p));
  if(readPending(storage,p)!==null)throw new Error('PENDING_STORAGE_UNCONFIRMED');
}
/** Called only after a scoped server lookup identifies the original creating user. */
export function migrateOwnedLegacy(storage:PendingStorage,p:M2ClientPrincipal,id:string,serverOwnerUserId:string){
  if(serverOwnerUserId!==p.userId||storage.getItem(legacyPendingKey)!==id)throw new Error('LEGACY_OWNER_UNCONFIRMED');
  const existing=readPending(storage,p);
  if(existing!==id){if(existing)throw new Error('PENDING_OPERATION_CHANGED');retainPending(storage,p,id);}
  // Preserve either the scoped reference or both references on any storage failure.
  if(storage.getItem(legacyPendingKey)!==id)throw new Error('PENDING_OPERATION_CHANGED');
  storage.removeItem(legacyPendingKey);
  if(storage.getItem(legacyPendingKey)!==null)throw new Error('PENDING_STORAGE_UNCONFIRMED');
}
