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
function ReviewHarness(job?:string,key=''){hooks.stateIndex=0;hooks.refIndex=0;const result=useGPTReview(job,key);if(hooks.effect){hooks.cleanup?.();const effect=hooks.effect;hooks.effect=undefined;hooks.cleanup=effect();}return result;}
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
beforeEach(()=>{hooks.states=[];hooks.refs=[];hooks.stateIndex=0;hooks.refIndex=0;hooks.deps=undefined;hooks.effect=undefined;hooks.cleanup=undefined;});
afterEach(()=>{hooks.cleanup?.();vi.unstubAllGlobals();vi.useRealTimers();});
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
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('',{status:401})));ReviewHarness(jobA);await flush();expect(ReviewHarness(jobA).message).toContain('review status is unavailable');expect(ReviewHarness(jobA).review).toBeNull();
});

it('fetches permissions immediately when suggestions become ready and stays loading until authorization returns',async()=>{
 let finish!:(value:Response)=>void;const waiting=new Promise<Response>(resolve=>{finish=resolve;});const fetcher=vi.fn<typeof fetch>(async()=>waiting);vi.stubGlobal('fetch',fetcher);
 expect(ReviewHarness().loading).toBe(false);expect(fetcher).not.toHaveBeenCalled();
 const first=ReviewHarness(jobA,'evidence-ready');expect(first.loading).toBe(true);expect(first.review).toBeNull();expect(fetcher).toHaveBeenCalledOnce();
 await first.decide(0,'REJECT');expect(fetcher).toHaveBeenCalledOnce();
 finish(Response.json(view));await flush();const ready=ReviewHarness(jobA,'evidence-ready');expect(ready.loading).toBe(false);expect(ready.review).not.toBeNull();
 ReviewHarness(jobA,'evidence-ready');expect(fetcher).toHaveBeenCalledOnce();
});
it('aborts stale job reads and never displays their authorization on the next job',async()=>{
 let finishA!:(value:Response)=>void,finishB!:(value:Response)=>void;
 const a=new Promise<Response>(resolve=>{finishA=resolve;}),b=new Promise<Response>(resolve=>{finishB=resolve;});
 const fetcher=vi.fn<typeof fetch>(async input=>String(input).includes(jobA)?a:b);vi.stubGlobal('fetch',fetcher);
 ReviewHarness(jobA,'a');const next=ReviewHarness(jobB,'b');expect(next.review).toBeNull();expect(next.loading).toBe(true);expect((fetcher.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
 finishA(Response.json(view));await flush();expect(ReviewHarness(jobB,'b').review).toBeNull();
 finishB(Response.json({...view,evidenceId:'b'.repeat(64)}));await flush();expect(ReviewHarness(jobB,'b').review!.evidenceId).toBe('b'.repeat(64));
});
it('invalidates stale same-job permission state when the saved-evidence readiness key changes',async()=>{
 let finish!:(value:Response)=>void;const next=new Promise<Response>(resolve=>{finish=resolve;});let calls=0;
 vi.stubGlobal('fetch',vi.fn(async()=>++calls===1?Response.json(view):next));ReviewHarness(jobA,'first');await flush();expect(ReviewHarness(jobA,'first').review).not.toBeNull();
 const changed=ReviewHarness(jobA,'second');expect(changed.review).toBeNull();expect(changed.loading).toBe(true);expect(changed.message).toBe('');
 finish(Response.json(view));await flush();expect(ReviewHarness(jobA,'second').loading).toBe(false);expect(calls).toBe(2);
});
it('recovers a transient empty review read without waiting for evidence polling or issuing a POST',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});let calls=0;const fetcher=vi.fn<typeof fetch>(async()=>++calls===1?new Response('',{status:404}):Response.json(view));vi.stubGlobal('fetch',fetcher);
 ReviewHarness(jobA,'ready');await flush();expect(ReviewHarness(jobA,'ready').loading).toBe(true);expect(calls).toBe(1);
 await vi.advanceTimersByTimeAsync(250);await flush();expect(ReviewHarness(jobA,'ready').review).not.toBeNull();expect(calls).toBe(2);expect(fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});
it('does not retry authorization denial and bounds transient retries',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const fetcher=vi.fn<typeof fetch>(async()=>new Response('',{status:401}));vi.stubGlobal('fetch',fetcher);
 ReviewHarness(jobA,'denied');await flush();await vi.advanceTimersByTimeAsync(5000);expect(fetcher).toHaveBeenCalledOnce();expect(ReviewHarness(jobA,'denied').loading).toBe(false);expect(ReviewHarness(jobA,'denied').review).toBeNull();
 fetcher.mockImplementation(async()=>new Response('',{status:503}));ReviewHarness(jobB,'retry');await flush();await vi.advanceTimersByTimeAsync(1250);await flush();expect(fetcher).toHaveBeenCalledTimes(4);expect(ReviewHarness(jobB,'retry').loading).toBe(false);
});
it('cancels a scheduled read retry when the job switches',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const fetcher=vi.fn<typeof fetch>(async input=>String(input).includes(jobA)?new Response('',{status:404}):Response.json(view));vi.stubGlobal('fetch',fetcher);
 ReviewHarness(jobA,'ready');await flush();ReviewHarness(jobB,'ready');await flush();await vi.advanceTimersByTimeAsync(5000);expect(fetcher.mock.calls.filter(([input])=>String(input).includes(jobA))).toHaveLength(1);
});
