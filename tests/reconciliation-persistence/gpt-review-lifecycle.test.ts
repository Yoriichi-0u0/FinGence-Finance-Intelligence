import {afterEach,beforeEach,expect,it,vi} from 'vitest';

// Minimal deterministic hook scheduler: exercise the actual hook's cleanup and pending
// requests without adding DOM/runtime dependencies to the website.
const hooks=vi.hoisted(()=>({states:[] as unknown[],refs:[] as {current:unknown}[],stateIndex:0,refIndex:0,
 deps:undefined as unknown[]|undefined,effect:undefined as (()=>(()=>void))|undefined,cleanup:undefined as (()=>void)|undefined}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:unknown)=>{const i=hooks.stateIndex++;if(!(i in hooks.states))hooks.states[i]=initial;return [hooks.states[i],(value:unknown)=>{hooks.states[i]=typeof value==='function'?value(hooks.states[i]):value;}];},
 useRef:(initial:unknown)=>{const i=hooks.refIndex++;return hooks.refs[i]??(hooks.refs[i]={current:initial});},
 useEffect:(effect:()=>()=>void,deps:unknown[])=>{if(!hooks.deps||deps.some((d,i)=>!Object.is(d,hooks.deps![i]))){hooks.effect=effect;hooks.deps=deps;}},
}));
import {useGPTReview} from '../../components/reconciliation/gpt-review';
const jobA='00000000-0000-4000-8000-000000000001',jobB='00000000-0000-4000-8000-000000000002';
const view={version:'website-gpt-review/1',evidenceId:'a'.repeat(64),accountingEffect:'NONE',items:[{ordinal:0,decision:'PENDING',canApprove:true,canReject:true}]};
const response=(decision:'APPROVE'|'REJECT')=>Response.json({version:'website-gpt-review/1',ordinal:0,decision,financialOutcome:'UNRESOLVED',accountingEffect:'NONE'});
function ReviewHarness(job:string){hooks.stateIndex=0;hooks.refIndex=0;const result=useGPTReview(job);if(hooks.effect){hooks.cleanup?.();const effect=hooks.effect;hooks.effect=undefined;hooks.cleanup=effect();}return result;}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
beforeEach(()=>{hooks.states=[];hooks.refs=[];hooks.stateIndex=0;hooks.refIndex=0;hooks.deps=undefined;hooks.effect=undefined;hooks.cleanup=undefined;});
afterEach(()=>{hooks.cleanup?.();vi.unstubAllGlobals();});
it.each(['resolve','reject'] as const)('job changes release buttons while the old POST is pending and later %ss',async completion=>{
 let resolveA!:(value:Response)=>void,rejectA!:(reason:Error)=>void,resolveB!:(value:Response)=>void;
 const old=new Promise<Response>((resolve,reject)=>{resolveA=resolve;rejectA=reject;}),next=new Promise<Response>(resolve=>{resolveB=resolve;});
 const fetcher=vi.fn<typeof fetch>(async(input,init)=>init?.method==='POST'?String(input).includes(jobA)?old:next:Response.json(view));vi.stubGlobal('fetch',fetcher);
 ReviewHarness(jobA);await flush();const a=ReviewHarness(jobA);expect(a.review).not.toBeNull();const postingA=a.decide(0,'APPROVE');expect(ReviewHarness(jobA).busy).toBe(true);
 // Changing jobs must release the old pending guard even if its POST never settles.
 ReviewHarness(jobB);await flush();const b=ReviewHarness(jobB);expect(b.busy).toBe(false);expect(b.message).toBe('');expect(b.review).not.toBeNull();
 const postingB=b.decide(0,'REJECT');expect(ReviewHarness(jobB).busy).toBe(true);
 expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(2);
 if(completion==='resolve')resolveA(response('APPROVE'));else rejectA(Error('synthetic old request failure'));
 await postingA;expect(ReviewHarness(jobB).busy).toBe(true);expect(ReviewHarness(jobB).review!.items[0].decision).toBe('PENDING');expect(ReviewHarness(jobB).message).toBe('');
 resolveB(response('REJECT'));await postingB;expect(ReviewHarness(jobB).busy).toBe(false);expect(ReviewHarness(jobB).review!.items[0].decision).toBe('REJECT');
});
it('still prevents duplicate clicks and reuses the request key for an explicit same-job retry',async()=>{
 let finish!:(value:Response)=>void;const first=new Promise<Response>(resolve=>{finish=resolve;});let posts=0;
 const fetcher=vi.fn<typeof fetch>(async(_input,init)=>init?.method==='POST'?++posts===1?first:response('APPROVE'):Response.json(view));vi.stubGlobal('fetch',fetcher);
 ReviewHarness(jobA);await flush();const a=ReviewHarness(jobA),pending=a.decide(0,'APPROVE');await a.decide(0,'APPROVE');expect(posts).toBe(1);
 finish(new Response('',{status:503}));await pending;expect(ReviewHarness(jobA).busy).toBe(false);await ReviewHarness(jobA).decide(0,'APPROVE');
 const commands=fetcher.mock.calls.filter(([,init])=>init?.method==='POST').map(([,init])=>JSON.parse(String(init?.body)));
 expect(commands).toHaveLength(2);expect(commands[0].requestId).toBe(commands[1].requestId);expect(ReviewHarness(jobA).review!.items[0].decision).toBe('APPROVE');
});

it('NEEDS_REVIEW rejects once, blocks approval, updates status and restores the saved decision after remount',async()=>{
 const pending={...view,items:[{...view.items[0],canApprove:false,canReject:true}]};let saved=false;
 const fetcher=vi.fn<typeof fetch>(async(_input,init)=>{
  if(init?.method==='POST'){expect(JSON.parse(String(init.body)).decision).toBe('REJECT');saved=true;return response('REJECT');}
  return Response.json(saved?{...pending,items:[{...pending.items[0],decision:'REJECT',canReject:false}]}:pending);
 });vi.stubGlobal('fetch',fetcher);
 ReviewHarness(jobA);await flush();const ready=ReviewHarness(jobA);await ready.decide(0,'APPROVE');expect(fetcher.mock.calls.filter(([,i])=>i?.method==='POST')).toHaveLength(0);
 await ready.decide(0,'REJECT');const decided=ReviewHarness(jobA);expect(decided.review!.items[0]).toMatchObject({decision:'REJECT',canApprove:false,canReject:false});expect(decided.message).toContain('Financial totals are unchanged');
 await decided.decide(0,'REJECT');expect(fetcher.mock.calls.filter(([,i])=>i?.method==='POST')).toHaveLength(1);
 hooks.cleanup?.();hooks.states=[];hooks.refs=[];hooks.deps=undefined;hooks.effect=undefined;hooks.cleanup=undefined;
 ReviewHarness(jobA);await flush();expect(ReviewHarness(jobA).review!.items[0].decision).toBe('REJECT');
});
it('shows a sanitized error when saved review status cannot be loaded',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:503})));ReviewHarness(jobA);await flush();expect(ReviewHarness(jobA).message).toContain('review status is unavailable');expect(ReviewHarness(jobA).review).toBeNull();
});
