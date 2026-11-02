import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createHostedAdmission,HOSTED_ISSUER,type HostedAuthority} from '../../lib/server/reconciliation/hosted-identity';
import type {TransactionDatabase} from '../../lib/server/db/postgres';
const authority:HostedAuthority={kind:'SYNTHETIC_TEST_AUTHORITY',verify:async()=>({issuer:HOSTED_ISSUER,audience:'authenticated',subject:'00000000-0000-4000-8000-000000000001',sessionId:'00000000-0000-4000-8000-000000000002',expiresAt:100000}),session:async({subject,sessionId})=>({subject,sessionId,active:true,suspended:false,checkedAt:1000})};
it('does not expose verifier errors or invoke database/operation after failed verification',async()=>{
 const transaction=vi.fn();const operation=vi.fn();const a={...authority,verify:async()=>{throw Error('sensitive-provider-error');}};
 const adapter=createHostedAdmission(a,{transaction,close:async()=>{}},()=>1000);
 await expect(adapter.withFinance('token',operation)).rejects.toThrow('HOSTED_IDENTITY_DENIED');expect(transaction).not.toHaveBeenCalled();expect(operation).not.toHaveBeenCalled();
});
it('reports unconfirmed grant cleanup without retrying an acknowledged financial operation',async()=>{
 let calls=0;const broker={close:async()=>{},transaction:async()=>{if(++calls===2)throw Error('connection-lost');return {rows:[],rowCount:0};}} as unknown as TransactionDatabase;
 const operation=vi.fn(async()=>({commitAcknowledged:true}));
 await expect(createHostedAdmission(authority,broker,()=>1000).withFinance('token',operation)).rejects.toThrow('LEASE_REVOCATION_UNCONFIRMED_NO_OPERATION_RETRY');expect(operation).toHaveBeenCalledTimes(1);
});
it('preserves even an undefined original failure if grant cleanup also fails',async()=>{
 let calls=0;const broker={close:async()=>{},transaction:async()=>{if(++calls===2)throw Error();return {rows:[],rowCount:0};}} as unknown as TransactionDatabase;
 let caught=false;
 try{await createHostedAdmission(authority,broker,()=>1000).withFinance('token',async()=>{throw undefined;});}catch(error){caught=true;expect(error).toBeUndefined();}
 expect(caught).toBe(true);
});
