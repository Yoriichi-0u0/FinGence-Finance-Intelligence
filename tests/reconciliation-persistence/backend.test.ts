import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {createReconciliationBackend} from '../../lib/server/reconciliation/backend';
import type {TransactionDatabase} from '../../lib/server/db/postgres';
import type {FinanceAdmission} from '../../lib/server/reconciliation/team-contracts';
import type {RegisteredPair} from '../../lib/server/reconciliation/processing';
const registry={bank:'a'.repeat(64),ledger:'b'.repeat(64)};
function database(){return {transaction:vi.fn(),close:vi.fn()} as unknown as TransactionDatabase;}
it('requires an explicit trusted admission instead of constructing personal or synthetic identity',()=>{
    expect(()=>createReconciliationBackend({financial:database(),registry,admission:undefined as unknown as FinanceAdmission<unknown>})).toThrow('FINANCE_ADMISSION_REQUIRED');
});
it.each([undefined,{}, {bank:'unverified',ledger:'b'.repeat(64)}, {bank:'a'.repeat(64),ledger:'a'.repeat(64)}])('rejects absent or invalid source registration without falling back to PoC sources (%j)',registry=>{
    const financial=database();
    expect(()=>createReconciliationBackend({financial,registry:registry as RegisteredPair,admission:{withFinance:async()=>{throw Error('NOT_CALLED');}}})).toThrow('REGISTERED_SOURCES_REQUIRED');
    expect(financial.transaction).not.toHaveBeenCalled();
});
it('denies processing and retrieval before touching persistence when admission rejects',async()=>{
    const financial=database();
    const backend=createReconciliationBackend({financial,registry,admission:{withFinance:async()=>{throw Error('IDENTITY_DENIED');}}});
    await expect(backend.get({},'c'.repeat(64))).rejects.toThrow('IDENTITY_DENIED');
    await expect(backend.process({},{})).rejects.toThrow('IDENTITY_DENIED');
    expect(financial.transaction).not.toHaveBeenCalled();
    expect(financial.close).not.toHaveBeenCalled();
});
it('lets the authority own context and capability cleanup even when processing is unsupported',async()=>{
    const financial=database(),seen:unknown[]=[];
    const identity={serverSession:'opaque'};
    const backend=createReconciliationBackend({financial,registry,admission:{withFinance:async(context,operation)=>{
        seen.push(context);try{return await operation('A'.repeat(43));}finally{seen.push('CLOSED');}
    }}});
    expect(await backend.process(identity,{organizationId:'attacker'})).toMatchObject({supported:false});
    expect(seen).toEqual([identity,'CLOSED']);
    expect(financial.transaction).not.toHaveBeenCalled();
});
