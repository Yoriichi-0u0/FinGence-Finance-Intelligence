import 'server-only';
import {createHash} from 'node:crypto';
import type {TransactionDatabase} from '../db/postgres';
import {groupGPTRuntimeDatabase} from './gpt-runtime';
export interface GPTSavedEvidenceReader {
 listSavedGPTEvidence(token:string,id:string,expected:{userId:string;organizationId:string}):Promise<{runs:Record<string,unknown>[];items:Record<string,unknown>[]}>;
}
const schema='fingence_reconciliation';
const sha=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function localOnly(){if(process.env.NODE_ENV==='production'||process.env.VERCEL)throw Error('GPT_LOCAL_ONLY');}
/** Saved-evidence reader extracted from source 6a071e0. No proposals, inference,
 * financial persistence, schema installation or environment/credential discovery.
 * Audited reads still require separately approved database write permission. */
export function createGPTSavedEvidenceReader(financial:TransactionDatabase):GPTSavedEvidenceReader{
 const db=groupGPTRuntimeDatabase(financial);
 async function principal(tx:import('../db/postgres').SqlConnection,token:string){
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('ACCESS_DENIED');
  await tx.query("SELECT set_config('fingence.reconciliation_token_hash',$1,true)",[createHash('sha256').update(token).digest('hex')]);
  const p=(await tx.query<{user_id:string;organization_id:string}>(`SELECT p.user_id::text,p.organization_id::text FROM ${schema}.principal() p WHERE p.organization_id=${schema}.authorized_organization()`)).rows[0];
  if(!p)throw Error('ACCESS_DENIED');return p;
 }
 return {
  async listSavedGPTEvidence(token:string,id:string,expected:{userId:string;organizationId:string}){
   localOnly();if(!sha(id))throw Error('ACCESS_DENIED');
   return db.transaction(async tx=>{
    const p=await principal(tx,token);
    if(p.user_id!==expected.userId||p.organization_id!==expected.organizationId)throw Error('ACCESS_DENIED');
    const args=[p.organization_id,id];
    const job=await tx.query(`SELECT processing_id FROM ${schema}.jobs WHERE organization_id=$1 AND processing_id=$2`,args);
    if(job.rows.length!==1)throw Error('ACCESS_DENIED');
    const runs=(await tx.query(`SELECT * FROM ${schema}.gpt_runs WHERE organization_id=$1 AND processing_id=$2 ORDER BY created_at DESC,evidence_id LIMIT 10`,args)).rows;
    const items=runs.length?(await tx.query(`SELECT i.*,b.evidence->>'BankReference' AS bank_reference,l.evidence->>'LedgerReference' AS ledger_reference
     FROM ${schema}.gpt_items i
     LEFT JOIN ${schema}.transactions b ON b.organization_id=i.organization_id AND b.processing_id=i.processing_id AND b.kind='BANK' AND b.record_id=i.bank_record_id
     LEFT JOIN ${schema}.transactions l ON l.organization_id=i.organization_id AND l.processing_id=i.processing_id AND l.kind='LEDGER' AND l.record_id=i.ledger_record_id
     WHERE i.organization_id=$1 AND i.processing_id=$2 AND i.evidence_id=ANY($3::text[]) ORDER BY i.evidence_id,i.item_type DESC,i.ordinal`,[...args,runs.map(r=>r.evidence_id)])).rows:[];
    await tx.query(`INSERT INTO ${schema}.audit(organization_id,processing_id,actor_id,action) VALUES($1,$2,$3,'READ')`,[...args,p.user_id]);
    return {runs,items};
   },{isolationLevel:'READ COMMITTED'});
  },
 };
}
