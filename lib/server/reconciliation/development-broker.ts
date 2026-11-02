import 'server-only';
import type {TransactionDatabase} from '../db/postgres';
import {serverPoolConfig,transactionDatabase} from '../db/postgres';
import {Pool} from 'pg';
export const developmentBrokerPoolConfig=(env:Readonly<Record<string,string|undefined>>)=>({...serverPoolConfig(env),max:2});
/** Dedicated broker factory: match the approved role limit without changing the
 * shared financial adapter's pool policy or weakening certificate validation. */
export function createDevelopmentBrokerDatabase(env:Readonly<Record<string,string|undefined>>){
 const pool=new Pool(developmentBrokerPoolConfig(env));pool.on('error',()=>{});
 return isolatedDevelopmentBroker(transactionDatabase(pool));
}
/** Fixed internal adapter for the isolated synthetic lab, never a user-selected
 * namespace. No financial SQL or production identity mapping is rewritten. */
export function isolatedDevelopmentBroker(db:TransactionDatabase):TransactionDatabase{
 return {close:()=>db.close(),transaction:(work,options)=>db.transaction(tx=>work({query:(sql,values)=>{
  const allowed=['SELECT * FROM fingence_m2.issue_hosted_grant($1,$2,$3,$4,$5,$6)','SELECT fingence_m2.revoke_hosted_grant($1)'];
  if(!allowed.includes(sql))throw Error('DEVELOPMENT_BROKER_OPERATION_DENIED');
  return tx.query(sql.replace('fingence_m2.','fingence_db04_dev_identity.'),values);
 }}),options)};
}
