import { headingRule, contextRule, observedDocumentKind } from '../../lib/ai-ingestion/increment-02/registry';
import { hash } from '../../lib/ai-ingestion/increment-03/plan';
import type { Provider03, InferenceRequest03 } from '../../lib/server/ai-ingestion/increment-03/providers';
/** Deterministic test control only; cannot be substituted for a provider in the live CLI. */
export class RecordedControlI2 implements Provider03 {
  async propose(request: InferenceRequest03) {
    const input=JSON.parse(request.messages[1].content) as {policyVersion:string;policyHash:string;evidence:{headers:[string,number,number,number,string][];context:[string,string][];values:[string,number,number,number,string][]}};
    const headers=input.evidence.headers; const contexts=input.evidence.context;
    const kind=observedDocumentKind(contexts.map(c=>c[1])) ?? 'TRANSACTION_TABLE';
    const fields=headers.map(h=>({headerId:h[0],ruleId:headingRule(h[4])?.id ?? null,reason:'RECORDED_TEST rule control'}));
    const context=contexts.map(c=>{const rule=contextRule(c[1]);return {evidenceId:c[0],ruleId:rule??'unknown',disposition:rule?'SUPPORTING_METADATA':'UNRESOLVED'};});
    const roles=headers.map(h=>headingRule(h[4])?.role); const cols=(role:string)=>new Set(headers.filter(h=>headingRule(h[4])?.role===role).map(h=>`${h[1]}:${h[3]}`));
    const values=(role:string)=>input.evidence.values.filter(v=>cols(role).has(`${v[1]}:${v[3]}`)).map(v=>v[4]).filter(Boolean);
    const dates=values('transaction_date'); const iso=dates.length>0&&dates.every(x=>/^\d{4}-\d{2}-\d{2}$/.test(x));
    const dmy=dates.length>0&&dates.every(x=>/^(?:1[3-9]|[2-3]\d)[/.]\d{1,2}[/.]\d{4}$/.test(x));
    const money=[...values('amount'),...values('debit'),...values('credit')];const plain=money.length>0&&money.every(x=>/^-?\d+(?:\.\d+)?$/.test(x));
    const mode=roles.includes('amount')&&!roles.some(x=>x==='debit'||x==='credit')?(roles.includes('direction')?'amount_direction':'signed_amount'):kind==='GENERAL_LEDGER'&&roles.includes('debit')&&roles.includes('credit')&&!roles.includes('amount')?'debit_credit':null;
    const conventions=(iso||dmy)&&plain&&mode?{dateOrder:iso?'ISO':'DMY',numberFormat:'plain',dateBasis:'transaction_date',monetaryMode:mode}:null;
    const plan={version:'v2-plan-0.3',policyVersion:input.policyVersion,policyHash:input.policyHash,documentKind:kind,assumptions:[],conventions,fields,context};
    return {plan,receipt:{mode:'RECORDED_TEST' as const,model:'deterministic-control',requestId:null,inputTokens:null,outputTokens:null,reasoningTokens:null,estimatedUsd:null,retries:0 as const,durationMs:0,outputHash:hash(plan)}};
  }
}
