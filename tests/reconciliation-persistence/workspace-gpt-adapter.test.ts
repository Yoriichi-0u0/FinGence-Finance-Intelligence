import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createWorkspaceGPTPrincipalResolver,createWorkspaceGPTWebsiteHandler,type WorkspaceGPTPermissionPolicy} from '../../lib/server/reconciliation/workspace-gpt-adapter';
import type {SqlConnection,TransactionDatabase} from '../../lib/server/db/postgres';
const p={sessionId:'session-1',memberId:'member-1',role:'FINANCE',organization:{id:'saic',name:'SAIC'},email:'private@example.invalid'};
const policy={approvalReference:'SYNTHETIC_TEST_ONLY',roles:{FINANCE:'finance_analyst',ADMIN:'administrator',SUPERADMIN:'administrator'}} satisfies WorkspaceGPTPermissionPolicy;
const request=()=>new Request('https://example.invalid/api/reconciliation/gpt-evidence?batchId=batch-1',{headers:{cookie:'fingence_session=opaque'}});
it('adapts only verified server identity without carrying token hashes, email or invented IDs',async()=>{
 const verify=vi.fn(async()=>({kind:'SIGNED_IN',principal:p,tokenHash:'private'}));const req=request();
 expect(await createWorkspaceGPTPrincipalResolver(verify,policy)(req)).toEqual({subjectId:'member-1',organizationId:'saic',role:'finance_analyst'});expect(verify).toHaveBeenCalledWith(req.headers);
});
it('fails closed for ended/public sessions and unavailable or malformed verification',async()=>{
 for(const kind of ['ANONYMOUS','ENDED'])expect(await createWorkspaceGPTPrincipalResolver(async()=>({kind}),policy)(request())).toBe(null);
 for(const who of [null,{kind:'UNAVAILABLE'},{kind:'SIGNED_IN',principal:{...p,role:'Finance'}},{kind:'SIGNED_IN',principal:{...p,organization:{id:''}}},{kind:'SIGNED_IN',principal:{...p,sessionId:null}}])
  await expect(createWorkspaceGPTPrincipalResolver(async()=>who,policy)(request())).rejects.toThrow('WORKSPACE_IDENTITY_UNAVAILABLE');
});
it('does not upgrade admins to Finance or infer group capabilities',async()=>{
 for(const role of ['ADMIN','SUPERADMIN'])expect((await createWorkspaceGPTPrincipalResolver(async()=>({kind:'SIGNED_IN',principal:{...p,role}}),policy)(request()))?.role).toBe('administrator');
});
function fixture(role='FINANCE'){
 const query=vi.fn(async()=>({rows:[],rowCount:1}));const database={transaction:async<T>(work:(tx:SqlConnection)=>Promise<T>)=>work({query} as unknown as SqlConnection),close:async()=>{}} satisfies TransactionDatabase;
 const backend={listSavedGPTEvidence:vi.fn(async()=>({runs:[],items:[]}))};
 const resolveBatch=vi.fn(async()=>({batchId:'batch-1',organizationId:'saic',processingId:'a'.repeat(64),capability:'approved-group-capability'}));
 const input={database,backend,permissionPolicy:policy,verifyWorkspaceCaller:async()=>({kind:'SIGNED_IN',principal:{...p,role}}),resolveAccess:async()=>({subjectId:'member-1',organizationId:'saic',scopeVersion:'1',batchIds:['batch-1']}),resolveBatch};
 return {input,query,backend,resolveBatch,handler:createWorkspaceGPTWebsiteHandler(input)};
}
it('connects the adapter to Jason batch authorization and durable auditing with supplied server scope',async()=>{
 const f=fixture();const response=await f.handler(request());expect(response.status).toBe(200);expect(f.backend.listSavedGPTEvidence).toHaveBeenCalledWith('approved-group-capability','a'.repeat(64),{userId:'member-1',organizationId:'saic'});expect(f.query).toHaveBeenCalledTimes(1);
});
it('denies admin inheritance and cross-organization mapping before backend evidence access',async()=>{
 const admin=fixture('ADMIN');expect((await admin.handler(request())).status).toBe(403);expect(admin.backend.listSavedGPTEvidence).not.toHaveBeenCalled();
 const f=fixture();f.resolveBatch.mockResolvedValue({batchId:'batch-1',organizationId:'other',processingId:'a'.repeat(64),capability:'no'});expect((await f.handler(request())).status).toBe(404);expect(f.backend.listSavedGPTEvidence).not.toHaveBeenCalled();
});
it('withholds responses when durable audit cannot commit and never retries evidence access',async()=>{
 const f=fixture();f.query.mockRejectedValue(Error('private diagnostic'));const response=await f.handler(request());expect(response.status).toBe(503);expect(await response.text()).not.toContain('private diagnostic');expect(f.backend.listSavedGPTEvidence).toHaveBeenCalledTimes(1);
});

it('requires explicit owner permission configuration and never derives it from a workspace hierarchy',async()=>{
 const verify=vi.fn(async()=>({kind:'SIGNED_IN',principal:{...p,role:'ADMIN'}}));
 expect(()=>createWorkspaceGPTPrincipalResolver(verify)).toThrow('WORKSPACE_PERMISSION_POLICY_REQUIRED');expect(verify).not.toHaveBeenCalled();
 const financeOnly={approvalReference:'SYNTHETIC_TEST_ONLY',roles:{FINANCE:'finance_analyst'}} satisfies WorkspaceGPTPermissionPolicy;
 await expect(createWorkspaceGPTPrincipalResolver(verify,financeOnly)(request())).rejects.toThrow('WORKSPACE_ROLE_NOT_APPROVED');
});
it('snapshots the approved policy so later caller mutation cannot widen permissions',async()=>{
 const roles:WorkspaceGPTPermissionPolicy['roles']={FINANCE:'finance_analyst'};
 const resolver=createWorkspaceGPTPrincipalResolver(async()=>({kind:'SIGNED_IN',principal:{...p,role:'SUPERADMIN'}}),{approvalReference:'SYNTHETIC_TEST_ONLY',roles});
 Object.assign(roles,{SUPERADMIN:'finance_analyst'});
 await expect(resolver(request())).rejects.toThrow('WORKSPACE_ROLE_NOT_APPROVED');
});
