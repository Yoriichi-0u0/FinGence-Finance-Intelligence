import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {safeConnectionFailure} from '../../lib/server/db/connection-diagnostic';
it.each([['28P01','AUTHENTICATION_REJECTED'],['53300','CONNECTION_LIMIT'],['42501','PERMISSION_DENIED'],['ETIMEDOUT','NETWORK_OR_TLS']])('classifies %s without exposing raw errors',(code,category)=>{
 expect(safeConnectionFailure('BROKER_POOL_ACQUISITION_AUTHENTICATION',{code,message:'private connection details',stack:'private'})).toEqual({stage:'BROKER_POOL_ACQUISITION_AUTHENTICATION',code,category});
});
it('suppresses unapproved codes and nested connection details',()=>{
 const r=safeConnectionFailure('BROKER_FIRST_QUERY',{code:'private://credentials',cause:{password:'secret'},message:'secret'});
 expect(r.code).toBe('UNCLASSIFIED');expect(JSON.stringify(r)).not.toContain('secret');
});
