import 'server-only';
import type { createLocalFinancialReportService } from './local-financial-report';

type ReportService = ReturnType<typeof createLocalFinancialReportService>;
/** Deliberately narrow deterministic local control, not a language model or general chatbot. */
export function createLocalFinancialQuestionService(reports: ReportService) {
 return {
  async answer(token:string, ids:readonly string[], policy:'include'|'exclude', question:string) {
   if (typeof question !== 'string' || question.trim().toLowerCase() !== 'what is the sum of signed source amounts?') return {status:'UNSUPPORTED' as const};
   const report = await reports.build(token,ids,policy);
   if (report.status !== 'AVAILABLE') return report;
   return {status:'ANSWERED' as const,...report.answer};
  },
 };
}
