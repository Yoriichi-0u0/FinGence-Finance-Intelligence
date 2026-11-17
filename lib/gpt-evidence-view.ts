export interface GPTEvidenceView {
 version:'gpt-evidence-view/1';batchId:string;processingId:string;
 runs:Array<{evidenceId:string;model:string;prompt:string;createdAt:string;bankSha256:string;ledgerSha256:string;outcome:'UNRESOLVED';items:Array<{
  type:'SUGGESTION'|'ABSTENTION';ordinal:number;bankId:string|null;ledgerId:string|null;recordId:string|null;
  bankReference:string|null;ledgerReference:string|null;explanation:string;reasons:string[];verification:Record<string,unknown>;score:null;outcome:'UNRESOLVED';
 }>}>
}

/** Financial projection: no processing identifiers, fingerprints, versions or raw verifier payload. */
export interface GPTFinanceView {
 version:'gpt-finance-view/1';batchId:string;
 runs:Array<{createdAt:string;outcome:'UNRESOLVED';items:Array<{
  type:'SUGGESTION'|'ABSTENTION';ordinal:number;bankId:string|null;ledgerId:string|null;recordId:string|null;
  bankReference:string|null;ledgerReference:string|null;explanation:string;reasons:string[];
  verificationResult:'PASS'|'FAIL'|'UNAVAILABLE'|'NOT_APPLICABLE';score:null;outcome:'UNRESOLVED';
 }>}>
}
export type GPTDisplayView=GPTEvidenceView|GPTFinanceView;

export function pairVerificationResult(item:GPTEvidenceView['runs'][number]['items'][number]):GPTFinanceView['runs'][number]['items'][number]['verificationResult']{
 if(item.type==='ABSTENTION')return 'NOT_APPLICABLE';
 if(item.verification.policy!=='website-pair-verifier/1')return 'UNAVAILABLE';
 const checks=['authoritativeRecordIds','equalSignedCents','sameCurrency','dateWithinSevenDays'].map(key=>item.verification[key]);
 if(checks.some(value=>value===false))return 'FAIL';
 return checks.every(value=>value===true)?'PASS':'UNAVAILABLE';
}

/** Explicit allowlist, never spread persisted/model objects into a Finance response. */
export function financeGPTView(data:GPTEvidenceView):GPTFinanceView{
 return {version:'gpt-finance-view/1',batchId:data.batchId,runs:data.runs.map(run=>({
  createdAt:run.createdAt,outcome:'UNRESOLVED',items:run.items.map(item=>({
   type:item.type,ordinal:item.ordinal,bankId:item.bankId,ledgerId:item.ledgerId,recordId:item.recordId,
   bankReference:item.bankReference,ledgerReference:item.ledgerReference,explanation:item.explanation,reasons:[...item.reasons],
   verificationResult:pairVerificationResult(item),score:null,outcome:'UNRESOLVED',
  })),
 }))};
}
