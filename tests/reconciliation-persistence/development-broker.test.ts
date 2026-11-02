import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {isolatedDevelopmentBroker} from '../../lib/server/reconciliation/development-broker';
it('rewrites only the two internal broker functions and preserves parameters',async()=>{
 const query=vi.fn(async()=>({rows:[],rowCount:0}));
 const adapter=isolatedDevelopmentBroker({transaction:work=>work({query}),close:async()=>{}});
 await adapter.transaction(tx=>tx.query('SELECT fingence_m2.revoke_hosted_grant($1)',['synthetic-hash']));
 expect(query).toHaveBeenCalledWith('SELECT fingence_db04_dev_identity.revoke_hosted_grant($1)',['synthetic-hash']);
});
it('denies arbitrary SQL before accessing the broker database',async()=>{
 const query=vi.fn();const adapter=isolatedDevelopmentBroker({transaction:work=>work({query}),close:async()=>{}});
 await expect(async()=>adapter.transaction(tx=>tx.query('SELECT * FROM public.financial_records'))).rejects.toThrow('DEVELOPMENT_BROKER_OPERATION_DENIED');
 expect(query).not.toHaveBeenCalled();
});
