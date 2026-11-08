import 'server-only';
import {createHash} from 'node:crypto';
import {subtractDecimalStrings} from '../../analytics';
import {parseTransactionId} from '../api/transaction-contract';
import type {TransactionDatabase} from '../db/postgres';
import {persistSecurityAuditEvent} from '../security/audit-store';

type Policy='include'|'exclude';
type Outcome={status:'DENIED'}|{status:'UNAVAILABLE';reason:'NO_INCLUDED_RECORDS'|'UNSUPPORTED_FINANCIAL_BASIS'}|
 {status:'AVAILABLE';kind:'SOURCE_SIGNED_AMOUNT_SUM';currency:string;total:string;includedCount:number;excludedWarnings:number;sources:readonly Readonly<{transactionId:string;batchId:string;sourceRowId:string}>[]};

/** Disposable local-only session/scope experiment. No login, issuing endpoint or production access. */
export function createLocalSessionSumService(database:TransactionDatabase) {
 return {
  async sum(token:string,ids:readonly string[],policy:Policy):Promise<Outcome> {
   if(!['test','development'].includes(process.env.NODE_ENV??'')||process.env.VERCEL)throw new Error('LOCAL_ONLY');
   if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))return {status:'DENIED'};
   if(!Array.isArray(ids)||ids.length<1||ids.length>50||!['include','exclude'].includes(policy))throw new Error('INVALID_SELECTION');
   let selected:string[];try{selected=ids.map(parseTransactionId);}catch{throw new Error('INVALID_SELECTION');}
   if(new Set(selected).size!==selected.length)throw new Error('INVALID_SELECTION');
   const tokenHash=createHash('sha256').update(token).digest('hex');
   try {
    return await database.transaction(async tx=>{
     // Share locks serialize revocation/role changes against this transaction; the request never selects its tenant.
     const auth=await tx.query<{subject_id:string;organization_id:string;role:string}>(`SELECT s.subject_id::text,s.organization_id::text,m.role
       FROM fingence_local_security_v1.sessions s JOIN fingence_local_security_v1.memberships m
       ON m.subject_id=s.subject_id AND m.organization_id=s.organization_id
       WHERE s.token_hash=$1 AND s.revoked=false AND s.expires_at>clock_timestamp() AND m.active=true FOR SHARE OF s,m`,[tokenHash]);
     const principal=auth.rows.length===1?auth.rows[0]:null;
     const audit=async(outcome:'success'|'denied')=>persistSecurityAuditEvent(tx,{actorId:principal?.subject_id??null,organizationId:principal?.organization_id??null,action:'transactions.list',outcome,targetType:'transaction_collection',targetId:'transactions',requestId:null,approvalId:null});
     if(!principal||principal.role!=='Finance'){await audit('denied');return {status:'DENIED'} as const;}
     const result=await tx.query<{id:string;batch_id:string;source_row_id:string;amount:string|null;currency:string|null;currency_basis:string|null;monetary_basis:string;ingestion_status:string}>(`SELECT r.id::text,r.batch_id::text,r.source_row_id,r.source_amount::text AS amount,r.currency,r.currency_basis,r.monetary_basis,r.ingestion_status
       FROM public.financial_records r JOIN fingence_local_security_v1.batch_owners o ON o.batch_id=r.batch_id
       WHERE r.id=ANY($1::uuid[]) AND o.organization_id=$2::uuid AND r.ingestion_status IN ('VALID','WARNING') FOR SHARE OF r,o`,[selected,principal.organization_id]);
     if(result.rows.length!==selected.length){await audit('denied');return {status:'DENIED'} as const;}
     const rows=result.rows;if(new Set(rows.map(r=>r.batch_id)).size!==1){await audit('denied');return {status:'DENIED'} as const;}
     const included=rows.filter(r=>policy==='include'||r.ingestion_status==='VALID'),excludedWarnings=rows.length-included.length;
     if(!included.length){await audit('success');return {status:'UNAVAILABLE',reason:'NO_INCLUDED_RECORDS'} as const;}
     const currency=included[0].currency;
     if(!currency||included.some(r=>r.currency!==currency||r.currency_basis!=='SOURCE'||r.monetary_basis!=='source_signed_amount'||r.amount===null)){await audit('success');return {status:'UNAVAILABLE',reason:'UNSUPPORTED_FINANCIAL_BASIS'} as const;}
     let total='0';for(const row of included){const v=row.amount!;total=subtractDecimalStrings(total,v.startsWith('-')?v.slice(1):`-${v.replace(/^\+/,'')}`);}
     // Check time again immediately before the audit and return; locks remain held through commit.
     const valid=await tx.query(`SELECT 1 FROM fingence_local_security_v1.sessions s JOIN fingence_local_security_v1.memberships m
       ON m.subject_id=s.subject_id AND m.organization_id=s.organization_id
       WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp() AND s.revoked=false AND m.active=true AND m.role='Finance'`,[tokenHash]);
     const owner=await tx.query('SELECT 1 FROM fingence_local_security_v1.batch_owners WHERE batch_id=$1::uuid AND organization_id=$2::uuid',[rows[0].batch_id,principal.organization_id]);
     if(valid.rows.length!==1||owner.rows.length!==1){await audit('denied');return {status:'DENIED'} as const;}
     await audit('success');
     return {status:'AVAILABLE',kind:'SOURCE_SIGNED_AMOUNT_SUM',currency,total,includedCount:included.length,excludedWarnings,sources:included.map(r=>({transactionId:r.id,batchId:r.batch_id,sourceRowId:r.source_row_id}))} as const;
    });
   } catch {throw new Error('SECURITY_UNAVAILABLE');}
  },
 };
}
