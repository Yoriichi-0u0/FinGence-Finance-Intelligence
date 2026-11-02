import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {digest} from '../../lib/server/reconciliation/processing';
vi.mock('server-only',()=>({}));
import {localFinancialReadAllowed,createProcessingUploadHandler,UPLOAD_LIMIT} from '../../lib/server/reconciliation/http';
afterEach(()=>vi.unstubAllEnvs());
it('rejects unregistered content and preserves uncertain commits without retry',async()=>{
 vi.stubEnv('NODE_ENV','development');vi.stubEnv('FINGENCE_DB04_LOCAL','1');vi.stubEnv('VERCEL','');
 const b=readFileSync(new URL('./fixtures/bank.csv',import.meta.url)),l=readFileSync(new URL('./fixtures/ledger.csv',import.meta.url));
 const persist=vi.fn().mockRejectedValue(Object.assign(new Error('safe test failure'),{code:'COMMIT_OUTCOME_UNKNOWN'}));
 const handler=createProcessingUploadHandler({persist},{bank:digest(b),ledger:digest(l)});
 const request=(valid:boolean)=>{const form=new FormData();form.append('documents',new File([valid?b:Buffer.from('unsupported')],'bank.csv'));form.append('documents',new File([l],'ledger.csv'));return new Request('http://localhost:3000/api/db04/processing',{method:'POST',headers:{host:'localhost:3000',authorization:`Bearer ${'A'.repeat(43)}`},body:form});};
 expect((await handler(request(false))).status).toBe(400);expect(persist).not.toHaveBeenCalled();
 expect((await handler(request(true))).status).toBe(409);expect(persist).toHaveBeenCalledTimes(1);
});
it('rejects unauthorized, oversized and malformed uploads without invoking persistence',async()=>{
 vi.stubEnv('NODE_ENV','development');vi.stubEnv('FINGENCE_DB04_LOCAL','1');vi.stubEnv('VERCEL','');
 const persist=vi.fn(),handler=createProcessingUploadHandler({persist});
 const request=(extra:Record<string,string>)=>new Request('http://localhost:3000/api/db04/processing',{method:'POST',headers:{host:'localhost:3000',...extra}});
 expect((await handler(request({}))).status).toBe(403);
 expect((await handler(request({authorization:`Bearer ${'A'.repeat(43)}`,'content-type':'application/json'}))).status).toBe(400);
 expect((await handler(request({authorization:`Bearer ${'A'.repeat(43)}`,'content-type':'multipart/form-data; boundary=test','content-length':String(UPLOAD_LIMIT+1)}))).status).toBe(413);
 expect(persist).not.toHaveBeenCalled();
});
it('keeps Production, remote and cross-origin financial reads disabled',()=>{
 const req=new Request('http://localhost:3000/api/db04/processing',{headers:{host:'localhost:3000'}});
 expect(localFinancialReadAllowed(req,{NODE_ENV:'production',FINGENCE_DB04_LOCAL:'1'})).toBe(false);
 expect(localFinancialReadAllowed(req,{NODE_ENV:'development',FINGENCE_DB04_LOCAL:'1',VERCEL:'1'})).toBe(false);
 expect(localFinancialReadAllowed(new Request(req,{headers:{host:'localhost:3000',origin:'https://other.test'}}),{NODE_ENV:'development',FINGENCE_DB04_LOCAL:'1'})).toBe(false);
 expect(localFinancialReadAllowed(req,{NODE_ENV:'development',FINGENCE_DB04_LOCAL:'1'})).toBe(true);
});
