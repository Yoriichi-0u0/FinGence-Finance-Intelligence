import {it,expect,vi,afterEach} from 'vitest';
vi.mock('server-only',()=>({}));
import {localFinancialReadAllowed} from '../../lib/server/reconciliation/http';
afterEach(()=>vi.unstubAllEnvs());
it('keeps Production, remote and cross-origin financial reads disabled',()=>{
 const req=new Request('http://localhost:3000/api/db04/processing',{headers:{host:'localhost:3000'}});
 expect(localFinancialReadAllowed(req,{NODE_ENV:'production',FINGENCE_DB04_LOCAL:'1'})).toBe(false);
 expect(localFinancialReadAllowed(req,{NODE_ENV:'development',FINGENCE_DB04_LOCAL:'1',VERCEL:'1'})).toBe(false);
 expect(localFinancialReadAllowed(new Request(req,{headers:{host:'localhost:3000',origin:'https://other.test'}}),{NODE_ENV:'development',FINGENCE_DB04_LOCAL:'1'})).toBe(false);
 expect(localFinancialReadAllowed(req,{NODE_ENV:'development',FINGENCE_DB04_LOCAL:'1'})).toBe(true);
});
