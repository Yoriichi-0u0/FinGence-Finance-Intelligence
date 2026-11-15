import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {ownsFinancialResource} from '../../lib/server/workspace/ownership';
it.each([null,{},true,{owned:true},{version:'owner-only/2',owned:true},{version:'owner-only/1',owned:'true'}])('fails closed on absent or unrecognized ownership contract %j',async body=>{
 const transport=vi.fn(async()=>Response.json(body)) as unknown as typeof fetch;
 expect(await ownsFinancialResource('trusted','JOB','id',{url:'https://example.invalid',key:'synthetic'},transport)).toBe('UNAVAILABLE');
});
it.each([true,false])('accepts only the token-bound versioned ownership response: %s',async owned=>{
 const transport=vi.fn(async()=>Response.json({version:'owner-only/1',owned})) as unknown as typeof fetch;
 expect(await ownsFinancialResource('trusted','JOB','id',{url:'https://example.invalid',key:'synthetic'},transport)).toBe(owned?'OWNED':'DENIED');
});
