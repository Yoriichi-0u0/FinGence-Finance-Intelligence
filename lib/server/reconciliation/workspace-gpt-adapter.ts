import 'server-only';
import type {TrustedPrincipal,SecurityRole} from '../security/authorization';
import {createGPTWebsiteHandler,type GPTWebsiteDependencies} from './gpt-website';
/** Verified workspace caller contract inspected at main 72731f2.
 * Supplied by the auth owner on the server, never JSON/browser claims. The GPT
 * adapter neither reads session cookies nor invokes service-role RPCs itself. */
export type VerifiedWorkspaceCaller=(headers:Headers)=>Promise<unknown>;
export interface WorkspaceGPTPermissionPolicy {
 /** Trusted operator configuration referencing the owner's permission approval.
  * Never accepted from HTTP data; this string alone is not proof of approval. */
 readonly approvalReference:string;
 readonly roles:Readonly<Partial<Record<'FINANCE'|'ADMIN'|'SUPERADMIN',SecurityRole>>>;
}
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(v);
export function createWorkspaceGPTPrincipalResolver(verify:VerifiedWorkspaceCaller,policy?:WorkspaceGPTPermissionPolicy){
 if(typeof verify!=='function')throw Error('VERIFIED_WORKSPACE_CALLER_REQUIRED');
 if(!policy||typeof policy.approvalReference!=='string'||!policy.approvalReference.trim()||policy.approvalReference.length>256
  ||!record(policy.roles)||Object.entries(policy.roles).some(([source,target])=>!['FINANCE','ADMIN','SUPERADMIN'].includes(source)||!['finance_analyst','administrator','management_reviewer'].includes(String(target))))
  throw Error('WORKSPACE_PERMISSION_POLICY_REQUIRED');
 const permissions=Object.freeze({...policy.roles});
 return async(request:Request):Promise<TrustedPrincipal|null>=>{
  const who=await verify(request.headers);
  if(!record(who))throw Error('WORKSPACE_IDENTITY_UNAVAILABLE');
  if(who.kind==='ANONYMOUS'||who.kind==='ENDED')return null;
  if(who.kind!=='SIGNED_IN'||!record(who.principal))throw Error('WORKSPACE_IDENTITY_UNAVAILABLE');
  const p=who.principal;
  if(!id(p.sessionId)||!id(p.memberId)||!record(p.organization)||!id(p.organization.id))throw Error('WORKSPACE_IDENTITY_UNAVAILABLE');
  if(p.role!=='FINANCE'&&p.role!=='ADMIN'&&p.role!=='SUPERADMIN')throw Error('WORKSPACE_IDENTITY_UNAVAILABLE');
  // No default role equivalence or workspace hierarchy inheritance. Jason's
  // resource guard still independently authorizes the explicit security role.
  const role=permissions[p.role];
  if(!role)throw Error('WORKSPACE_ROLE_NOT_APPROVED');
  return Object.freeze({subjectId:p.memberId,organizationId:p.organization.id,role});
 };
}
/** Owner composition seam only, not registration or live activation. Existing
 * batch/job/capability lookup, restricted group backend and durable audit DB are
 * still mandatory. Workspace IDs are preserved; never cast them to DB04 IDs. */
export function createWorkspaceGPTWebsiteHandler(input:Omit<GPTWebsiteDependencies,'resolvePrincipal'>&{verifyWorkspaceCaller:VerifiedWorkspaceCaller;permissionPolicy:WorkspaceGPTPermissionPolicy}){
 const {verifyWorkspaceCaller,permissionPolicy,...dependencies}=input;
 return createGPTWebsiteHandler({...dependencies,resolvePrincipal:createWorkspaceGPTPrincipalResolver(verifyWorkspaceCaller,permissionPolicy)});
}
