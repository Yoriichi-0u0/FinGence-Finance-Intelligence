import 'server-only';
import { subtractDecimalStrings } from '../../analytics';
import { parseTransactionId, type TransactionListItem } from '../api/transaction-contract';
import { createScopedReadService, type ScopedReadDependencies } from './scoped-queries';

type WarningPolicy = 'include'|'exclude';
type SourceRef = Readonly<{transactionId:string;batchId:string;sourceRowId:string}>;
type SumResult =
 | {status:'UNAVAILABLE';reason:'NO_INCLUDED_RECORDS';includedCount:0;excludedWarnings:number}
 | {status:'AVAILABLE';kind:'SOURCE_SIGNED_AMOUNT_SUM';currency:string;currencyBasis:'SOURCE';monetaryBasis:'source_signed_amount';total:string;includedCount:number;excludedWarnings:number;sources:readonly SourceRef[]};

/** Internal-only arithmetic on an explicit selection; it does not infer economic meaning. */
export function createScopedFinancialTools(deps:ScopedReadDependencies) {
 const reads=createScopedReadService(deps);
 return {
  async sumSourceAmounts(ids:readonly string[],request:Request,warningPolicy:WarningPolicy):Promise<SumResult> {
   if(!Array.isArray(ids)||ids.length<1||ids.length>50||!['include','exclude'].includes(warningPolicy)) throw new Error('INVALID_SELECTION');
   let normalized:string[];
   try {normalized=ids.map(parseTransactionId);} catch {throw new Error('INVALID_SELECTION');}
   if(new Set(normalized).size!==normalized.length)throw new Error('INVALID_SELECTION');
   // Each read independently enforces tenant scope and durable audit; no partial result escapes.
   const rows:TransactionListItem[]=[];for(const id of normalized)rows.push(await reads.getTransaction(id,request));
   // The current P2 interface does not provide a shared tenant snapshot across reads.
   // Restrict this local experiment to one batch; do not combine datasets or imply atomicity.
   if(rows.some(row=>row.batch_id!==rows[0].batch_id))throw new Error('UNSUPPORTED_SELECTION_SCOPE');
   const included=rows.filter(row=>warningPolicy==='include'||row.ingestion_status==='VALID');
   const excludedWarnings=rows.length-included.length;
   if(!included.length)return {status:'UNAVAILABLE',reason:'NO_INCLUDED_RECORDS',includedCount:0,excludedWarnings};
   const currency=included[0].currency;
   if(!currency || included.some(row=>row.currency!==currency||row.currency_basis!=='SOURCE'||row.monetary_basis!=='source_signed_amount'||row.source_amount===null))throw new Error('UNSUPPORTED_FINANCIAL_BASIS');
   let total='0';
   for(const row of included){const value=row.source_amount!;const negative=value.startsWith('-')?value.slice(1):`-${value.replace(/^\+/,'')}`;total=subtractDecimalStrings(total,negative);}
   const sources=included.map(row=>Object.freeze({transactionId:row.transaction_id,batchId:row.batch_id,sourceRowId:row.source_row_id}));
   return {status:'AVAILABLE',kind:'SOURCE_SIGNED_AMOUNT_SUM',currency,currencyBasis:'SOURCE',monetaryBasis:'source_signed_amount',total,includedCount:included.length,excludedWarnings,sources:Object.freeze(sources)};
  },
 };
}
