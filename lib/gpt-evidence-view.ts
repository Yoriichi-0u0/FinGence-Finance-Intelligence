export interface GPTEvidenceView {
 version:'gpt-evidence-view/1';batchId:string;processingId:string;
 runs:Array<{evidenceId:string;model:string;prompt:string;createdAt:string;bankSha256:string;ledgerSha256:string;outcome:'UNRESOLVED';items:Array<{
  type:'SUGGESTION'|'ABSTENTION';ordinal:number;bankId:string|null;ledgerId:string|null;recordId:string|null;
  bankReference:string|null;ledgerReference:string|null;explanation:string;reasons:string[];verification:Record<string,unknown>;score:null;outcome:'UNRESOLVED';
 }>}>
}
