import {expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
vi.mock('server-only',()=>({}));
import {websiteGPTReview} from '../../lib/server/reconciliation/website-gpt-review';
import {WebsiteGPTError} from '../../lib/server/reconciliation/website-gpt-diagnostics';
import {GPTReviewActions,type GPTReviewControls} from '../../components/reconciliation/gpt-review';
import type {Caller} from '../../lib/server/workspace/session';
const jobId='00000000-0000-4000-8000-000000000001',organizationId='00000000-0000-4000-8000-000000000002',memberId='00000000-0000-4000-8000-000000000003';
const view={version:'website-gpt-review/1' as const,evidenceId:'a'.repeat(64),accountingEffect:'NONE' as const,items:[{ordinal:0,decision:'PENDING' as const,canApprove:true,canReject:true}]};
const body={decision:'APPROVE',ordinal:0,requestId:'00000000-0000-4000-8000-000000000004',expectedEvidenceId:view.evidenceId};
function request(payload:unknown=body){return new Request(`https://synthetic.invalid/api/reconciliation/website-gpt-review?jobId=${jobId}`,{method:'POST',headers:{origin:'https://synthetic.invalid',host:'synthetic.invalid','content-type':'application/json'},body:JSON.stringify(payload)});}
const verify=(role:'FINANCE'|'ADMIN'|'SUPERADMIN')=>async():Promise<Caller>=>({kind:'SIGNED_IN',tokenHash:'b'.repeat(64),principal:{sessionId:'session',email:'synthetic@example.invalid',memberId,role,organization:{id:organizationId,name:'Synthetic'},processing:{paused:false,reason:null,since:null},ai:{enabled:true,since:null}}});
it.each(['FINANCE','ADMIN','SUPERADMIN'] as const)('%s uses server ownership only and receives a simple review response',async role=>{
 const reviewOperation=vi.fn(async()=>({version:'website-gpt-review/1',ordinal:0,decision:'APPROVE',financialOutcome:'UNRESOLVED',accountingEffect:'NONE'}));
 const response=await websiteGPTReview(request(),{verify:verify(role),store:()=>({reviewOperation})});
 expect(response.status).toBe(200);expect(reviewOperation).toHaveBeenCalledWith({organizationId,memberId,jobId},'APPROVE',{ordinal:0,requestId:body.requestId,expectedEvidenceId:view.evidenceId});
 expect(await response.json()).toEqual({version:'website-gpt-review/1',ordinal:0,decision:'APPROVE',financialOutcome:'UNRESOLVED',accountingEffect:'NONE'});
});
it.each(['ANONYMOUS','ENDED','UNAVAILABLE'] as const)('denies %s without database access',async kind=>{
 const store=vi.fn();expect((await websiteGPTReview(request(),{store,verify:async()=>({kind})})).status).toBe(kind==='UNAVAILABLE'?503:401);expect(store).not.toHaveBeenCalled();
});
it('rejects CSRF, client ownership claims, oversized bodies and unexpected queries',async()=>{
 const store=vi.fn(),deps={verify:verify('FINANCE'),store};
 const csrf=request();csrf.headers.set('origin','https://other.invalid');expect((await websiteGPTReview(csrf,deps)).status).toBe(403);
 expect((await websiteGPTReview(request({...body,memberId}),deps)).status).toBe(400);
 expect((await websiteGPTReview(request({...body,notes:'x'.repeat(1100)}),deps)).status).toBe(413);
 expect((await websiteGPTReview(new Request(`https://synthetic.invalid/?jobId=${jobId}&organizationId=other`),deps)).status).toBe(400);expect(store).not.toHaveBeenCalled();
});
it.each([['GPT_JOB_DENIED',404],['GPT_SESSION_DENIED',401],['GPT_SQL_DUPLICATE',409],['GPT_RUNTIME_DENIED',503]] as const)('fails closed safely: %s',async(reason,status)=>{
 const response=await websiteGPTReview(request(),{verify:verify('FINANCE'),store:()=>({reviewOperation:async()=>{throw new WebsiteGPTError(reason);}})});
 expect(response.status).toBe(status);expect(await response.text()).not.toContain(reason);
});
it('fails closed without approved review SQL and on malformed evidence',async()=>{
 expect((await websiteGPTReview(request(),{verify:verify('FINANCE'),store:()=>null})).status).toBe(503);
 expect((await websiteGPTReview(request(),{verify:verify('FINANCE'),store:()=>({reviewOperation:async()=>({secret:'internal'})})})).status).toBe(503);
});
it('reads only opaque review state and serves no-store responses',async()=>{
 const response=await websiteGPTReview(new Request(`https://synthetic.invalid/?jobId=${jobId}`),{verify:verify('FINANCE'),store:()=>({reviewOperation:async()=>view})});
 expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(await response.json()).toEqual(view);
});
it('shows proposal controls only when authorized and never claims an accounting approval',()=>{
 const controls: GPTReviewControls={review:view,busy:false,message:'',decide:vi.fn()};
 const render=()=>renderToStaticMarkup(createElement(GPTReviewActions,{ordinal:0,controls}));
 expect(render()).toContain('Approve suggestion');expect(render()).not.toContain('disabled=');
 controls.busy=true;expect(render()).toContain('disabled=');controls.busy=false;
 controls.review={...view,items:[{...view.items[0],decision:'APPROVE',canApprove:false,canReject:false}]};expect(render()).toContain('No financial posting');expect(render()).not.toContain('<button');
 controls.review=null;expect(render()).toBe('');
});
