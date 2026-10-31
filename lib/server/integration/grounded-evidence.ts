import 'server-only';
import { z } from 'zod';
import { createScopedReadService, type ScopedReadDependencies } from './scoped-queries';

const fields=['transaction_date','posting_date','reference','source_amount','debit','credit','currency'] as const;
const proposalSchema=z.strictObject({claims:z.array(z.strictObject({field:z.enum(fields),value:z.string().min(1).max(200)})).min(1).max(7)});
/** Internal-only evidence helper. It neither invokes an AI model nor authenticates users itself. */
export function createGroundedEvidenceService(deps:ScopedReadDependencies) {
  const reads=createScopedReadService(deps);
  async function retrieve(id:string,request:Request) {
    const row=await reads.getTransaction(id,request); // P2 verifies scope and durably audits before return.
    return Object.freeze({transaction_id:row.transaction_id,batch_id:row.batch_id,source_row_id:row.source_row_id,
      transaction_date:row.transaction_date,posting_date:row.posting_date,reference:row.reference,source_amount:row.source_amount,
      debit:row.debit,credit:row.credit,currency:row.currency,monetary_basis:row.monetary_basis,ingestion_status:row.ingestion_status});
  }
  return {
    retrieve,
    async verify(id:string,request:Request,proposal:unknown) {
      const evidence=await retrieve(id,request);
      const parsed=proposalSchema.safeParse(proposal);if(!parsed.success)throw new Error('INVALID_PROPOSAL');
      if(new Set(parsed.data.claims.map(c=>c.field)).size!==parsed.data.claims.length)throw new Error('INVALID_PROPOSAL');
      const claims=parsed.data.claims.map(c=>{if(evidence[c.field]===null||evidence[c.field]!==c.value)throw new Error('UNSUPPORTED_CLAIM');return Object.freeze({...c});});
      return Object.freeze({version:'grounded-source-claims-0.1' as const,origin:'VERIFIED_SOURCE_CLAIMS' as const,
        transactionId:evidence.transaction_id,batchId:evidence.batch_id,sourceRowId:evidence.source_row_id,monetaryBasis:evidence.monetary_basis,
        ingestionStatus:evidence.ingestion_status,claims:Object.freeze(claims)});
    },
  };
}
