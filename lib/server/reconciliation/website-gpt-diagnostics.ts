import 'server-only';
import {PersistenceError} from '../persistence/contracts';

const reasons=[
 'GPT_STORAGE_DISABLED','GPT_BACKEND_UNAPPROVED','GPT_APPROVAL_REQUIRED','GPT_DATABASE_URL_MISSING','GPT_DATABASE_INVALID',
 'GPT_RESTRICTED_CONNECTION_REQUIRED','GPT_SESSION_REQUIRED','GPT_SCOPE_INVALID','GPT_RUNTIME_DENIED','GPT_STORAGE_INVALID',
 'GPT_SCOPE_DENIED','GPT_CLAIM_INVALID','GPT_AUDIT_INVALID','GPT_SAVE_INVALID','GPT_EVIDENCE_INVALID',
 'GPT_JOB_DENIED','GPT_SESSION_DENIED','GPT_SQL_ACCESS_DENIED','GPT_SQL_CONTRACT_MISSING','GPT_SQL_DUPLICATE','GPT_SQL_FAILED',
 'DATABASE_CONFIGURATION','DATABASE_UNAVAILABLE','PERSISTENCE_FAILED','COMMIT_OUTCOME_UNKNOWN','ROLLBACK_UNCONFIRMED',
 'DB_TLS_FAILED','DB_AUTH_FAILED','DB_NETWORK_FAILED','DB_CONNECT_FAILED','DB_POOL_ERROR',
 'STORAGE_UNAVAILABLE','SESSION_SERVICE_UNAVAILABLE','SESSION_VERIFICATION_FAILED','READ_FAILED','REVIEW_FAILED','GENERATION_FAILED',
 'GPT_GATEWAY_DISABLED','GPT_KEY3_MISSING','GPT_BUDGET_UNAVAILABLE',
] as const;
export type GPTDiagnosticReason=typeof reasons[number];
export type GPTDiagnosticStage='CONFIG'|'POOL'|'RUNTIME'|'OPERATE'|'VALIDATE'|'SESSION'|'READ'|'REVIEW'|'GENERATE';
/** Extends the existing safe persistence error so its code survives transaction rollback. */
export class WebsiteGPTError extends PersistenceError{
 constructor(readonly reason:GPTDiagnosticReason){super('PERSISTENCE_FAILED');this.message=reason;}
}
export function gptDiagnosticReason(error:unknown,fallback:GPTDiagnosticReason):GPTDiagnosticReason{
 const reason=error instanceof WebsiteGPTError?error.reason:error instanceof PersistenceError?error.code:null;
 return reasons.includes(reason as GPTDiagnosticReason)?reason as GPTDiagnosticReason:fallback;
}
/** Strict allowlist only: never error objects, messages, SQL, subjects, payloads or secrets. */
export function reportWebsiteGPT(stage:GPTDiagnosticStage,reason:GPTDiagnosticReason){
 if(!reasons.includes(reason)||!['CONFIG','POOL','RUNTIME','OPERATE','VALIDATE','SESSION','READ','REVIEW','GENERATE'].includes(stage))return;
 try{console.error(JSON.stringify({event:'AI06_GPT_DIAGNOSTIC',stage,reason}));}catch{/* Observability is separate from mandatory durable SQL auditing. */}
}
export function websiteGPTConnectReason(error:unknown):GPTDiagnosticReason{
 const code=(error as {code?:unknown}|null)?.code;
 if((error as {message?:unknown}|null)?.message==='The server does not support SSL connections')return 'DB_TLS_FAILED';
 if(['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(String(code)))return 'DB_TLS_FAILED';
 if(code==='28P01'||code==='28000')return 'DB_AUTH_FAILED';
 if(['ENOTFOUND','ECONNREFUSED','ECONNRESET','ETIMEDOUT','EHOSTUNREACH','ENETUNREACH','08001','08006'].includes(String(code)))return 'DB_NETWORK_FAILED';
 return 'DB_CONNECT_FAILED';
}
export function websiteGPTSqlError(error:unknown):WebsiteGPTError{
 const e=error as {code?:unknown;message?:unknown}|null;
 if(e?.code==='42501'){
  if(e.message==='AI06 job denied'||e.message==='AI06 ingestion scope denied')return new WebsiteGPTError('GPT_JOB_DENIED');
  if(['AI06 session denied','AI06 session ended','AI06 membership denied'].includes(String(e.message)))return new WebsiteGPTError('GPT_SESSION_DENIED');
  return new WebsiteGPTError('GPT_SQL_ACCESS_DENIED');
 }
 if(e?.code==='42P01'||e?.code==='42883'||e?.code==='3F000')return new WebsiteGPTError('GPT_SQL_CONTRACT_MISSING');
 if(e?.code==='23505')return new WebsiteGPTError('GPT_SQL_DUPLICATE');
 return new WebsiteGPTError('GPT_SQL_FAILED');
}
