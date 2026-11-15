import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import GPTSuggestions,{GPTSuggestionsView,watchGPTEvidence,type GPTEvidenceState} from '../../components/reconciliation/gpt-suggestions';
import type {GPTEvidenceView} from '../../lib/gpt-evidence-view';
const batch='website-job';
const data:GPTEvidenceView={version:'gpt-evidence-view/1',batchId:batch,processingId:'processing',runs:[{evidenceId:'saved',model:'model',prompt:'prompt',createdAt:'date',bankSha256:'bank',ledgerSha256:'ledger',outcome:'UNRESOLVED',items:[]}]};
const empty=()=>new Response('',{status:404});
const flush=()=>vi.advanceTimersByTimeAsync(0);
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
it('polls empty website evidence every five seconds until ready, using only authenticated saved-evidence GETs',async()=>{
 const onState=vi.fn(),transport=vi.fn<typeof fetch>().mockImplementationOnce(async()=>empty()).mockImplementationOnce(async()=>Response.json(data));
 const stop=watchGPTEvidence(batch,true,onState,transport);await flush();expect(onState).toHaveBeenLastCalledWith({status:'generating'});
 await vi.advanceTimersByTimeAsync(4999);expect(transport).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(transport).toHaveBeenCalledTimes(2);expect(onState).toHaveBeenLastCalledWith({status:'ready',data});
 await vi.advanceTimersByTimeAsync(90_000);expect(transport).toHaveBeenCalledTimes(2);expect(vi.getTimerCount()).toBe(0);
 for(const [url,init]of transport.mock.calls){expect(url).toBe(`/api/reconciliation/website-gpt-evidence?jobId=${batch}`);expect(init).toMatchObject({method:'GET',credentials:'same-origin',cache:'no-store'});expect(init?.body).toBeUndefined();}
 stop();
});
it.each([404,200])('never polls DB04, including its empty HTTP %i result',async status=>{
 const transport=vi.fn<typeof fetch>(async()=>status===404?empty():Response.json({...data,runs:[]})),onState=vi.fn();
 watchGPTEvidence(batch,false,onState,transport);await flush();expect(onState).toHaveBeenLastCalledWith({status:status===404?'unavailable':'empty'});
 await vi.advanceTimersByTimeAsync(100_000);expect(transport).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);expect(transport.mock.calls[0][0]).toContain('/gpt-evidence?batchId=');
});
it.each([401,403,503,500])('stops polling on terminal HTTP %i',async status=>{
 const transport=vi.fn<typeof fetch>().mockImplementationOnce(async()=>empty()).mockImplementationOnce(async()=>new Response('',{status})),onState=vi.fn();
 watchGPTEvidence(batch,true,onState,transport);await flush();await vi.advanceTimersByTimeAsync(5000);
 expect(onState).toHaveBeenLastCalledWith({status:status===500?'error':'unavailable'});expect(vi.getTimerCount()).toBe(0);
 await vi.advanceTimersByTimeAsync(100_000);expect(transport).toHaveBeenCalledTimes(2);
});
it('also polls a valid empty run array and stops on an invalid saved response',async()=>{
 const transport=vi.fn<typeof fetch>().mockImplementationOnce(async()=>Response.json({...data,runs:[]})).mockImplementationOnce(async()=>Response.json({...data,batchId:'stale'})),onState=vi.fn();
 watchGPTEvidence(batch,true,onState,transport);await flush();expect(onState).toHaveBeenLastCalledWith({status:'generating'});await vi.advanceTimersByTimeAsync(5000);expect(onState).toHaveBeenLastCalledWith({status:'error'});expect(vi.getTimerCount()).toBe(0);
});
it('stops at 90 seconds, clears timers and returns to the empty/manual-refresh state',async()=>{
 const transport=vi.fn<typeof fetch>(async()=>empty()),onState=vi.fn();
 watchGPTEvidence(batch,true,onState,transport);await flush();await vi.advanceTimersByTimeAsync(89_999);expect(onState).toHaveBeenLastCalledWith({status:'generating'});
 await vi.advanceTimersByTimeAsync(1);expect(onState).toHaveBeenLastCalledWith({status:'empty'});expect(transport).toHaveBeenCalledTimes(18);expect(vi.getTimerCount()).toBe(0);
 await vi.advanceTimersByTimeAsync(100_000);expect(transport).toHaveBeenCalledTimes(18);
});
it('never overlaps slow polls, aborts at the deadline and ignores a late ready response',async()=>{
 let finish!:(response:Response)=>void;const transport=vi.fn<typeof fetch>().mockImplementationOnce(async()=>empty()).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})),onState=vi.fn();
 watchGPTEvidence(batch,true,onState,transport);await flush();await vi.advanceTimersByTimeAsync(25_000);expect(transport).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(65_000);expect(transport.mock.calls[1][1]?.signal?.aborted).toBe(true);expect(onState).toHaveBeenLastCalledWith({status:'empty'});const calls=onState.mock.calls.length;
 finish(Response.json(data));await flush();expect(onState).toHaveBeenCalledTimes(calls);expect(vi.getTimerCount()).toBe(0);
});
it('does not start a late poll after a suspended tab exceeds the wall-clock deadline',async()=>{
 const transport=vi.fn<typeof fetch>(async()=>empty()),onState=vi.fn();watchGPTEvidence(batch,true,onState,transport);await flush();
 vi.setSystemTime(Date.now()+90_000);await vi.advanceTimersByTimeAsync(5000);expect(transport).toHaveBeenCalledTimes(1);expect(onState).toHaveBeenLastCalledWith({status:'empty'});expect(vi.getTimerCount()).toBe(0);
});
it('aborts an initial pending request on unmount and never publishes its stale result',async()=>{
 let finish!:(response:Response)=>void;const transport=vi.fn<typeof fetch>(()=>new Promise(resolve=>{finish=resolve;})),onState=vi.fn();
 const stop=watchGPTEvidence(batch,true,onState,transport);stop();expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(true);finish(Response.json(data));await flush();expect(onState).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it.each(['manual refresh','job change'])('cleanup on %s cancels the old loop before starting a fresh one',async mode=>{
 let finish!:(response:Response)=>void;const old=vi.fn<typeof fetch>().mockImplementationOnce(async()=>empty()).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})),onState=vi.fn();
 const stop=watchGPTEvidence(batch,true,onState,old);await flush();await vi.advanceTimersByTimeAsync(5000);stop();
 const id=mode==='job change'?'new-job':batch,newData={...data,batchId:id};const current=vi.fn<typeof fetch>(async()=>Response.json(newData));watchGPTEvidence(id,true,onState,current);await flush();
 finish(Response.json(data));await flush();expect(onState).toHaveBeenLastCalledWith({status:'ready',data:newData});expect(old.mock.calls[1][1]?.signal?.aborted).toBe(true);expect(current).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
it('manual refresh can start a fresh read after timeout without retaining the old polling timer',async()=>{
 const old=vi.fn<typeof fetch>(async()=>empty()),onState=vi.fn();const stop=watchGPTEvidence(batch,true,onState,old);await flush();await vi.advanceTimersByTimeAsync(90_000);stop();
 const current=vi.fn<typeof fetch>(async()=>Response.json(data));watchGPTEvidence(batch,true,onState,current);await flush();expect(current).toHaveBeenCalledTimes(1);expect(onState).toHaveBeenLastCalledWith({status:'ready',data});expect(vi.getTimerCount()).toBe(0);
});
it('renders the requested waiting text, keeps manual refresh and preserves UNRESOLVED rules',()=>{
 expect(renderToStaticMarkup(createElement(GPTSuggestionsView,{state:{status:'generating'}}))).toContain('Generating GPT suggestions...');
 const html=renderToStaticMarkup(createElement(GPTSuggestions,{batchId:batch,websiteJob:true}));expect(html).toContain('Refresh suggestions');expect(html).toContain('UNRESOLVED');
 const ready:GPTEvidenceState={status:'ready',data};expect(renderToStaticMarkup(createElement(GPTSuggestionsView,{state:ready}))).toContain('UNRESOLVED');
});
