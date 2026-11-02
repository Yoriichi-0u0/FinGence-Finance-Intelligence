import 'server-only';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import type {TransactionDatabase} from '../db/postgres';
export const HOSTED_ADMISSION_VERSION='hosted-finance-admission/1';
export const HOSTED_ISSUER='https://fhipzomczevbpybezzxu.supabase.co/auth/v1';
/** Trusted server dependency. No decoder/getSession/browser claims implementation.
 * Jason must supply audited signature/issuer/audience AND authoritative lifecycle
 * verification. Tests use SYNTHETIC_TEST_AUTHORITY, never real hosted Auth proof. */
export interface HostedAuthority {
 kind:'SUPABASE_AUTH_VERIFIED_V1'|'SYNTHETIC_TEST_AUTHORITY';
 verify(token:string):Promise<{issuer:string;audience:string;subject:string;sessionId:string;expiresAt:number}>;
 session(input:{subject:string;sessionId:string}):Promise<{subject:string;sessionId:string;active:boolean;suspended:boolean;checkedAt:number}>;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Internal opt-in proposal, not imported by routes. Broker DB and financial DB
 * must be separate restricted identities; no owner or service-role fallback. */
export function createHostedAdmission(authority:HostedAuthority,broker:TransactionDatabase,now=Date.now) {
 if(authority.kind==='SYNTHETIC_TEST_AUTHORITY'&&process.env.NODE_ENV!=='test')throw Error('TEST_AUTHORITY_REQUIRES_TEST_ENV');
 if(!['SUPABASE_AUTH_VERIFIED_V1','SYNTHETIC_TEST_AUTHORITY'].includes(authority.kind))throw Error('VERIFIED_AUTHORITY_REQUIRED');
 return {async withFinance<T>(accessToken:string,operation:(capability:string)=>Promise<T>):Promise<T>{
  let verified:Awaited<ReturnType<HostedAuthority['verify']>>;
  try{
   if(typeof accessToken!=='string'||accessToken.length<1||accessToken.length>16384)throw Error();
   verified=await authority.verify(accessToken);
   if(verified.issuer!==HOSTED_ISSUER||verified.audience!=='authenticated'||!uuid.test(verified.subject)||!uuid.test(verified.sessionId)||!Number.isSafeInteger(verified.expiresAt)||verified.expiresAt<=now())throw Error();
   const lifecycle=await authority.session({subject:verified.subject,sessionId:verified.sessionId});
   if(lifecycle.subject!==verified.subject||lifecycle.sessionId!==verified.sessionId||!lifecycle.active||lifecycle.suspended||!Number.isSafeInteger(lifecycle.checkedAt)||lifecycle.checkedAt>now()||now()-lifecycle.checkedAt>5000||verified.expiresAt<=now())throw Error();
  }catch{throw Error('HOSTED_IDENTITY_DENIED');}
  const capability=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(capability).digest('hex');
  const deadline=new Date(Math.min(verified.expiresAt,now()+30000));
  await broker.transaction(tx=>tx.query('SELECT * FROM fingence_m2.issue_hosted_grant($1,$2,$3,$4,$5,$6)',[hash,randomUUID(),verified.issuer,verified.subject,verified.sessionId,deadline.toISOString()]));
  let operationFailed=false;
  try{return await operation(capability);}catch(error){operationFailed=true;throw error;}
  finally{
   try{await broker.transaction(tx=>tx.query('SELECT fingence_m2.revoke_hosted_grant($1)',[hash]));}
   catch{if(!operationFailed)throw Error('LEASE_REVOCATION_UNCONFIRMED_NO_OPERATION_RETRY');}
  }
 }};
}
