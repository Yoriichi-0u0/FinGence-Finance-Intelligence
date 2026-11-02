import 'server-only';
import type {TransactionDatabase} from '../db/postgres';
/** Fixed internal adapter for the isolated synthetic lab, never a user-selected
 * namespace. No financial SQL or production identity mapping is rewritten. */
export function isolatedDevelopmentBroker(db:TransactionDatabase):TransactionDatabase{
 return {close:()=>db.close(),transaction:(work,options)=>db.transaction(tx=>work({query:(sql,values)=>{
  const allowed=['SELECT * FROM fingence_m2.issue_hosted_grant($1,$2,$3,$4,$5,$6)','SELECT fingence_m2.revoke_hosted_grant($1)'];
  if(!allowed.includes(sql))throw Error('DEVELOPMENT_BROKER_OPERATION_DENIED');
  return tx.query(sql.replace('fingence_m2.','fingence_db04_dev_identity.'),values);
 }}),options)};
}
