export interface ProcessingDashboardV1 {
    version:'db04-processing-read/1';processingId:string;
    job:Record<string,unknown>;sources:Record<string,unknown>[];
    transactions:Record<string,unknown>[];proposals:Record<string,unknown>[];cases:Record<string,unknown>[];
    rankings?:Record<string,unknown>[];proposalVerifications?:Record<string,unknown>[];
}
/** Bind both views to the same server context, without inventing missing financial values. */
export function dashboardContext(input:unknown,expectedId:string):ProcessingDashboardV1 {
    const r=input as ProcessingDashboardV1;
    if(!r||r.version!=='db04-processing-read/1'||r.processingId!==expectedId||r.job?.processing_id!==expectedId
        ||!Array.isArray(r.sources)||r.sources.length!==2||!Array.isArray(r.transactions)||!Array.isArray(r.proposals)||!Array.isArray(r.cases))throw Error('Invalid processing context');
    const byKind=new Map(r.sources.map(s=>[s.kind,s.sha256]));
    if(!byKind.has('BANK')||!byKind.has('LEDGER')||r.sources.some(s=>s.organization_id!==r.job.organization_id||typeof s.sha256!=='string'||!/^[a-f0-9]{64}$/.test(s.sha256))
        ||r.transactions.some(t=>t.sha256!==byKind.get(t.kind)||typeof t.signed_amount!=='string'))throw Error('Source lineage mismatch');
    return r;
}
