import 'server-only';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Pool,type PoolConfig} from 'pg';
import {serverPoolConfig,transactionDatabase,type TransactionDatabase} from '../db/postgres';
import type {FinanceAdmission} from './team-contracts';

export const GROUP_PROJECT='zmtdozblpvtjniehwjrw';
export const SYNTHETIC_ISSUER='urn:fingence:db04:group-synthetic:1';
export const SYNTHETIC_ROLES={runtime:'db04_group_test_runtime',broker:'db04_group_test_broker'} as const;
const subjects={PRIMARY:'00000000-0000-4000-8000-000000000005',OTHER:'00000000-0000-4000-8000-000000000006'} as const;
export type SyntheticActor=keyof typeof subjects;

/** Operator-only fixed target check. Does not establish approval or authenticate.
 * No pooler fallback, personal credentials or environment-name trust. */
export function assertGroupSyntheticTarget(config:PoolConfig,kind:keyof typeof SYNTHETIC_ROLES){
    if(config.host!==`db.${GROUP_PROJECT}.supabase.co`||config.port!==5432||config.database!=='postgres'
        ||config.user!==SYNTHETIC_ROLES[kind]||typeof config.ssl!=='object'||!config.ssl||config.ssl.rejectUnauthorized!==true)
        throw Error('APPROVED_GROUP_SYNTHETIC_TARGET_REQUIRED');
}
/** No caller can select the identity schema or issue financial SQL through this adapter. */
export function restrictedSyntheticBroker(db:TransactionDatabase):TransactionDatabase{
    return {close:()=>db.close(),transaction:(work,options)=>db.transaction(tx=>work({query:(sql,values)=>{
        if(!['SELECT * FROM fingence_db04_group_synthetic.issue_hosted_grant($1,$2,$3,$4,$5,$6)',
            'SELECT fingence_db04_group_synthetic.revoke_hosted_grant($1)'].includes(sql))throw Error('SYNTHETIC_BROKER_OPERATION_DENIED');
        return tx.query(sql,values);
    }}),options)};
}
export function createGroupSyntheticBrokerDatabase(environment:Readonly<Record<string,string|undefined>>){
    const config={...serverPoolConfig(environment),max:2};assertGroupSyntheticTarget(config,'broker');
    const pool=new Pool(config);pool.on('error',()=>{});return restrictedSyntheticBroker(transactionDatabase(pool));
}
/** Deliberately not a user authenticator. A separately approved CLI demonstration
 * may act only as these two synthetic subjects. Never import into an HTTP route.
 * NODE_ENV=test is required even for the separately approved hosted demonstration.
 */
export function createGroupSyntheticAdmission(broker:TransactionDatabase):FinanceAdmission<SyntheticActor>{
    if(process.env.NODE_ENV!=='test')throw Error('SYNTHETIC_DEMONSTRATION_ONLY');
    return {async withFinance(actor,operation){
        if(!Object.hasOwn(subjects,actor))throw Error('SYNTHETIC_ACTOR_DENIED');
        const token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
        await broker.transaction(tx=>tx.query('SELECT * FROM fingence_db04_group_synthetic.issue_hosted_grant($1,$2,$3,$4,$5,$6)',
            [hash,randomUUID(),SYNTHETIC_ISSUER,subjects[actor],randomUUID(),new Date(Date.now()+30000).toISOString()]));
        let failed=false;
        try{return await operation(token);}catch(error){failed=true;throw error;}
        finally{try{await broker.transaction(tx=>tx.query('SELECT fingence_db04_group_synthetic.revoke_hosted_grant($1)',[hash]));}
            catch{if(!failed)throw Error('LEASE_REVOCATION_UNCONFIRMED_NO_OPERATION_RETRY');}}
    }};
}
