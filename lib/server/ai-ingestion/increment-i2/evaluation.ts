import 'server-only';
import type { SemanticEvidence, SemanticVerification } from '../../../ai-ingestion/increment-02/contracts';
import { terminologyRegistry } from '../../../ai-ingestion/increment-02/registry';
import { hash, planSchema, requestPlanSchema, policyHash, promptRevision } from '../../../ai-ingestion/increment-03/plan';
import type { Run03 } from '../increment-03/service';
import { scoreAccepted, scoreExtraction } from '../../../ai-ingestion/increment-03/metrics';

/** Evaluation-only labels. Never passed to an inference provider or verifier. */
export interface GoldCase {
  caseId: string; sourceSha256: string; headers: string[]; roles: string[]; rows: string[][];
  documentKind: string | null; conventions: Record<string, string> | null;
  accepted: Record<string, unknown>[]; prohibitedAcceptance: boolean;
  allowedAssumptions: string[]; context: { text: string; ruleId: string; disposition: string }[] | null;
}
export type EvaluationOrigin = 'NOT_EXECUTED' | 'RECORDED_TEST' | 'VERIFIED_BLUEPRINT_REUSE' | 'LIVE_GROQ' | 'LIVE_OLLAMA';
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export function scoreEvaluation(evidence: SemanticEvidence, proposal: unknown, verification: SemanticVerification | null, gold: GoldCase, origin: EvaluationOrigin) {
  if (evidence.sourceId !== gold.sourceSha256) throw new Error('GOLD_SOURCE_MISMATCH');
  if (gold.headers.length !== gold.roles.length || gold.rows.some(row => row.length !== gold.headers.length)) throw new Error('INVALID_GOLD');
  const parsed=planSchema.safeParse(proposal); const plan=parsed.success?parsed.data:null;
  const resolve=(id:string)=>/^e(?:0|[1-9]\d*)$/.test(id)?evidence.items[Number(id.slice(1))]?.id:id;
  const headerIds=new Set(evidence.tables.flatMap(t=>t.headerIds));
  let correct=0;
  if(plan) for(const [n,heading] of gold.headers.entries()) {
    const matches=evidence.items.filter(i=>headerIds.has(i.id)&&norm(i.text)===norm(heading));
    if(matches.length!==1)continue;
    const fields=plan.fields.filter(f=>resolve(f.headerId)===matches[0].id);
    const role=fields.length===1?(fields[0].ruleId===null?'unknown':terminologyRegistry.rules.find(r=>r.id===fields[0].ruleId)?.role):undefined;
    if(role===gold.roles[n])correct++;
  }
  const proposed=plan?.fields.length ?? 0;
  const mappings=plan?{correct,expected:gold.headers.length,proposed,precision:proposed?correct/proposed:null,recall:gold.headers.length?correct/gold.headers.length:null}:null;
  const extraction=scoreExtraction(evidence,{headers:gold.headers,rows:gold.rows});
  const accepted=verification?.accepted ?? []; const matched=verification?scoreAccepted(accepted,gold.accepted):null;
  const observed=verification?.coverage.rowCountEstablished ? verification.coverage.sourceRows : null;
  const rate=(n:number)=>observed!==null&&observed>0?n/observed:null;
  const validIds=new Set(evidence.items.map(i=>i.id));
  const invalidEvidenceReferences=verification?[...verification.accepted,...verification.rejected,...verification.unresolved].flatMap(r=>r.evidenceIds).filter(id=>!validIds.has(id)).length:0;
  const context=gold.context===null||!plan?null:{expected:gold.context.length,correct:gold.context.filter(expected=>{
    const matches=evidence.items.filter(i=>i.table===null&&i.text===expected.text);if(matches.length!==1)return false;
    const selected=plan.context.filter(c=>resolve(c.evidenceId)===matches[0].id);
    return selected.length===1&&selected[0].ruleId===expected.ruleId&&selected[0].disposition===expected.disposition;
  }).length};
  return { version:'v2-i2-score-0.1' as const, origin, sourceSha256:evidence.sourceId,
    // This standalone scorer cannot authenticate a provider receipt. Live accuracy requires a separately authorized run with its receipt.
    modelAccuracy:null, schemaValid:plan!==null, requestSchemaValid:requestPlanSchema(evidence).safeParse(proposal).success, extraction, mappings,
    documentKindCorrect:plan&&gold.documentKind!==null?plan.documentKind===gold.documentKind:null,
    conventionsCorrect:plan&&gold.conventions!==null?Boolean(plan.conventions&&Object.entries(gold.conventions).every(([k,v])=>(plan.conventions as Record<string,string>)[k]===v)):null,
    unsupportedAssumptions:plan?plan.assumptions.filter(a=>!gold.allowedAssumptions.includes(a)):null,context,
    acceptance:verification&&matched?{accepted:accepted.length,rejected:verification.rejected.length,unresolved:verification.unresolved.length,...matched,prohibitedAccepted:gold.prohibitedAcceptance?accepted.length:0,acceptedRate:rate(accepted.length),rejectedRate:rate(verification.rejected.length),unresolvedRate:rate(verification.unresolved.length),falseAcceptedRate:accepted.length?matched.falseAccepted/accepted.length:null}:null,
    coverage:verification?.coverage ?? null,provenance:{invalidEvidenceReferences},
  };
}

/** Only a completed trusted provider run with a matching receipt can be labeled live. */
export function scoreLiveRun(run: Run03, gold: GoldCase) {
  const receipt=run.receipt;
  if (!run.evidence || !receipt || run.mode!=='LIVE_GROQ' || receipt.mode!=='LIVE_GROQ' || receipt.model!=='openai/gpt-oss-20b' || run.error !== null || receipt.finishReason!=='stop' || !receipt.requestId || receipt.outputHash!==hash(run.proposal) || run.policyHash!==policyHash || run.promptRevision!==promptRevision || !run.promptHash) throw new Error('UNVERIFIED_LIVE_RECEIPT');
  const result=scoreEvaluation(run.evidence,run.proposal,run.verification,gold,'LIVE_GROQ');
  return {...result,modelAccuracy:{mappings:result.mappings,documentKindCorrect:result.documentKindCorrect,conventionsCorrect:result.conventionsCorrect,context:result.context}};
}
