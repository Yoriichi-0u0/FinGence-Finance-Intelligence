import 'server-only';
import type {TransactionDatabase} from '../db/postgres';
import {principal,readReconciliationContext} from './service';
import {digest,type RegisteredPair,supportedPolicy} from './processing';
import {gptAuthority,verifyGPTProposal,GPT_VERSION,type GPTResult} from './gpt';
import {parseSuggestion,VERSION} from './gpt-schema';
import {GPT_PROMPT_VERSION} from './gpt-prompt';
import {PROPOSAL_POLICY} from './proposal-verification';

const schema='fingence_reconciliation';
const sha=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
/** Canonical key order; array order remains evidence order. No dates/undefined in persisted payload. */
export function canonicalEvidence(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonicalEvidence).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalEvidence((value as Record<string,unknown>)[k])).join(',')+'}';
}
function localOnly(){if(process.env.NODE_ENV==='production'||process.env.VERCEL)throw Error('GPT_LOCAL_ONLY');}
/** Review-prepared only: no auto-install, provider dispatch, retries or default route wiring.
 * Call with a server-produced result; revalidation inside the scoped transaction is authoritative. */
export function createGPTEvidenceService(db:TransactionDatabase,registry:RegisteredPair){
 const registered=Object.freeze({...registry});
 return {
  async persist(token:string,result:GPTResult){
   localOnly();
   if(!result||result.version!==GPT_VERSION||result.modelVersion!=='openai/gpt-oss-120b'||result.promptVersion!==GPT_PROMPT_VERSION||result.schemaVersion!==VERSION||result.outcome!=='UNRESOLVED'
    ||![result.processingId,result.sourceFingerprint,result.requestFingerprint,result.proposalFingerprint].every(sha))throw Error('GPT_INVALID_EVIDENCE');
   // Parse only the proposal contract. Discard caller verification, status, receipt and arbitrary keys.
   const proposal=parseSuggestion(JSON.stringify(result.proposal));
   return db.transaction(async tx=>{
    const p=await principal(tx,token),id=result.processingId;
    if(p.organization_id!==result.organizationId)throw Error('ACCESS_DENIED');
    const context={version:'db04-processing-read/1' as const,processingId:id,...await readReconciliationContext(tx,p.organization_id,id)};
    if(context.sources.length!==2||context.sources.some(s=>s.classification_method!=='REGISTERED_SYNTHETIC_EXACT_SCHEMA'||s.sha256!==(s.kind==='BANK'?registered.bank:registered.ledger)))throw Error('GPT_REGISTERED_SYNTHETIC_REQUIRED');
    if(digest(JSON.stringify(gptAuthority(context)))!==result.sourceFingerprint)throw Error('GPT_CONTEXT_CHANGED');
    const policy=supportedPolicy(context.job.policy as {version:string;maxDays:number});
    const verified=verifyGPTProposal(context,proposal);
    const record=(kind:unknown,key:unknown)=>context.transactions.find(r=>r.kind===kind&&r.record_id===key);
    const suggestions=proposal.suggestions.map((s,i)=>{
     const v=verified[i];
     const verification={checks:v.checks,identity:v.identity,conflicts:v.conflicts,rankingLineage:v.rankingLineage,financialEligible:v.financialEligible,referenceClaims:v.referenceClaims,uniqueEligiblePartner:v.uniqueEligiblePartner};
     return {itemType:'SUGGESTION',ordinal:i,bankClaim:s.bankId,ledgerClaim:s.ledgerId,recordClaim:null,
      bankRecordId:record('BANK',s.bankId)?s.bankId:null,ledgerRecordId:record('LEDGER',s.ledgerId)?s.ledgerId:null,
      abstentionKind:null,abstentionRecordId:null,explanation:s.rationale,reasons:v.reasons,verification};
    });
    const abstentions=proposal.abstentions.map((a,i)=>{
     const matches=context.transactions.filter(r=>r.record_id===a.recordId);
     if(matches.length!==1)throw Error('GPT_UNKNOWN_OR_AMBIGUOUS_ABSTENTION');
     return {itemType:'ABSTENTION',ordinal:i,bankClaim:null,ledgerClaim:null,recordClaim:a.recordId,
      bankRecordId:null,ledgerRecordId:null,abstentionKind:matches[0].kind,abstentionRecordId:a.recordId,
      explanation:a.reason,reasons:['MODEL_ABSTENTION','ASSIGNMENT_POLICY_NOT_APPROVED'],verification:{}};
    });
    const items=[...suggestions,...abstentions],verificationFingerprint=digest(canonicalEvidence(items));
    const payload={organizationId:p.organization_id,processingId:id,modelVersion:result.modelVersion,promptVersion:result.promptVersion,schemaVersion:result.schemaVersion,
     proposalVersion:GPT_VERSION,verificationPolicy:PROPOSAL_POLICY,financialPolicy:policy.version,
     bankSha256:registered.bank,ledgerSha256:registered.ledger,sourceFingerprint:result.sourceFingerprint,requestFingerprint:result.requestFingerprint,proposalFingerprint:result.proposalFingerprint,verificationFingerprint,items};
    const evidenceId=digest(canonicalEvidence(payload));
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[p.organization_id+':gpt:'+id+':'+evidenceId]);
    const args=[p.organization_id,id,evidenceId];
    const existing=(await tx.query(`SELECT evidence_id FROM ${schema}.gpt_runs WHERE organization_id=$1 AND processing_id=$2 AND evidence_id=$3`,args)).rows;
    if(existing.length)return {organizationId:p.organization_id,processingId:id,evidenceId,reused:true,outcome:'UNRESOLVED' as const};
    await tx.query(`INSERT INTO ${schema}.gpt_runs(organization_id,processing_id,evidence_id,bank_sha256,ledger_sha256,created_by,model_version,prompt_version,schema_version,proposal_version,verification_policy,financial_policy,source_fingerprint,request_fingerprint,proposal_fingerprint,verification_fingerprint,suggestion_count,abstention_count)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,[...args,registered.bank,registered.ledger,p.user_id,result.modelVersion,result.promptVersion,result.schemaVersion,GPT_VERSION,PROPOSAL_POLICY,policy.version,result.sourceFingerprint,result.requestFingerprint,result.proposalFingerprint,verificationFingerprint,suggestions.length,abstentions.length]);
    for(const item of items)await tx.query(`INSERT INTO ${schema}.gpt_items(organization_id,processing_id,evidence_id,item_type,ordinal,bank_claim,ledger_claim,record_claim,bank_record_id,ledger_record_id,abstention_kind,abstention_record_id,explanation,reasons,verification)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb)`,[...args,item.itemType,item.ordinal,item.bankClaim,item.ledgerClaim,item.recordClaim,item.bankRecordId,item.ledgerRecordId,item.abstentionKind,item.abstentionRecordId,item.explanation,JSON.stringify(item.reasons),canonicalEvidence(item.verification)]);
    // AFTER INSERT audit trigger and deferred completeness checks share this transaction.
    return {organizationId:p.organization_id,processingId:id,evidenceId,reused:false,outcome:'UNRESOLVED' as const};
   },{isolationLevel:'READ COMMITTED'});
  },
  /** Saved website evidence only. Actor/tenant are bound to Jason's verified context.
   * Reads are audited; never call against Production without write approval. */
  async listSaved(token:string,id:string,expected:{userId:string;organizationId:string}){
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
  async get(token:string,id:string,evidenceId:string){
   localOnly();if(!sha(id)||!sha(evidenceId))throw Error('ACCESS_DENIED');
   return db.transaction(async tx=>{
    const p=await principal(tx,token),args=[p.organization_id,id,evidenceId];
    const run=(await tx.query(`SELECT * FROM ${schema}.gpt_runs WHERE organization_id=$1 AND processing_id=$2 AND evidence_id=$3`,args)).rows[0];
    if(!run)throw Error('ACCESS_DENIED');
    const items=(await tx.query(`SELECT * FROM ${schema}.gpt_items WHERE organization_id=$1 AND processing_id=$2 AND evidence_id=$3 ORDER BY item_type DESC,ordinal`,args)).rows;
    await tx.query(`INSERT INTO ${schema}.audit(organization_id,processing_id,actor_id,action) VALUES($1,$2,$3,'READ')`,[p.organization_id,id,p.user_id]);
    return {run,items};
   },{isolationLevel:'READ COMMITTED'});
  },
 };
}
