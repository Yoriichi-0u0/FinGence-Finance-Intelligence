import 'server-only';
import type {createLocalSessionSumService} from './local-session-sum';

type SumService=ReturnType<typeof createLocalSessionSumService>;
/** Internal synthetic report, created only after the scoped calculation and audit commit. */
export function createLocalFinancialReportService(service:SumService) {
 return {
  async build(token:string,ids:readonly string[],policy:'include'|'exclude') {
   const result=await service.sum(token,ids,policy);
   if(result.status!=='AVAILABLE')return result;
   const report={version:'local-source-sum-report-v1',publicationEligible:false,...result};
   return {
    status:'AVAILABLE' as const,
    download:JSON.stringify(report,null,2),
    answer:{origin:'DETERMINISTIC_ONLY' as const,kind:result.kind,value:result.total,currency:result.currency,sources:result.sources},
   };
  },
 };
}
