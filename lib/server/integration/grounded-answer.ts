import 'server-only';
import { createGroundedEvidenceService } from './grounded-evidence';
import type { ScopedReadDependencies } from './scoped-queries';

type Evidence = Awaited<ReturnType<ReturnType<typeof createGroundedEvidenceService>['retrieve']>>;
/** Injected server-only adapter. No implementation here may dispatch to an external provider. */
export interface GroundedProposalAdapter {
  propose(input: Readonly<{ question: string; evidence: Evidence }>): Promise<unknown>;
}
export type GroundedAnswer =
  | { status:'UNAVAILABLE'; reason:'MODEL_NOT_CONFIGURED'|'MODEL_FAILURE' }
  | { status:'UNSUPPORTED'; reason:'UNVERIFIED_CLAIM'|'INVALID_QUESTION' }
  | { status:'VERIFIED_SOURCE_CLAIMS'; transactionId:string; batchId:string; sourceRowId:string; monetaryBasis:string; ingestionStatus:string; claims:readonly Readonly<{field:string;value:string}>[] };

/**
 * Local internal composition: no route, model transport, financial interpretation or raw SQL.
 * The two scoped reads independently authorize and durably audit before any result is released.
 */
export function createGroundedAnswerService(deps:ScopedReadDependencies, adapter?:GroundedProposalAdapter) {
  const evidence=createGroundedEvidenceService(deps);
  return {
    async answer(transactionId:string,request:Request,question:string):Promise<GroundedAnswer> {
      if(typeof question!=='string'||!question.trim()||question.length>500) return {status:'UNSUPPORTED',reason:'INVALID_QUESTION'};
      if(!adapter) return {status:'UNAVAILABLE',reason:'MODEL_NOT_CONFIGURED'};
      // Never pass financial evidence to the adapter until scope and audit both succeed.
      const source=await evidence.retrieve(transactionId,request);
      let proposal:unknown;
      try { proposal=await adapter.propose(Object.freeze({question:question.trim(),evidence:source})); }
      catch { return {status:'UNAVAILABLE',reason:'MODEL_FAILURE'}; }
      try {
        const verified=await evidence.verify(transactionId,request,proposal);
        return {status:'VERIFIED_SOURCE_CLAIMS',transactionId:verified.transactionId,batchId:verified.batchId,sourceRowId:verified.sourceRowId,monetaryBasis:verified.monetaryBasis,ingestionStatus:verified.ingestionStatus,claims:verified.claims};
      } catch(error) {
        if(error instanceof Error && ['INVALID_PROPOSAL','UNSUPPORTED_CLAIM'].includes(error.message)) return {status:'UNSUPPORTED',reason:'UNVERIFIED_CLAIM'};
        throw error; // Access, membership and audit failures remain fail-closed.
      }
    },
  };
}
