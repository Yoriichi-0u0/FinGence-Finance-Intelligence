import type {FinancialViewsV1} from '@/lib/server/reconciliation/financial-views';
export default function FinancialViews({data,view}:{data:FinancialViewsV1|undefined;view:string}) {
 if(!data)return <p>Persisted financial summary unavailable.</p>;
 return <section><h2>{view==='reports'?'Source-backed financial report':view==='forecasting'?'Forecasting':'Financial analytics'}</h2>
 <p>Processing: {data.processingId} · Organization: {String(data.organizationId)} · Period: {data.period} · Currency: {data.currency}</p>
 {view==='forecasting'?<><p>Forecast status: {data.forecast.forecast.status}</p><pre>{JSON.stringify(data.forecast.forecast,null,2)}</pre></>:<>
 <p>BANK cash inflows: {data.cashMovement.inflows}</p><p>BANK cash outflows: {data.cashMovement.outflows}</p><p>Net BANK cash movement: {data.cashMovement.net}</p>
 <p>Deterministic verified suggestions: {data.reconciliation.verifiedSuggestions} · Unresolved cases: {data.reconciliation.unresolvedCases}</p>
 <p>AI ranking batches: {data.aiProposals.rankingBatches} · Approved AI financial transactions: {data.aiProposals.approvedTransactions}</p>
 <p>Independent verification snapshots: {data.aiProposals.verificationSnapshots} — proposal evidence, not financial approval.</p>
 {data.evidence.cases.map((c,i)=><p key={i}>Unresolved: {String(c.reason)}</p>)}
 {Object.entries(data.unavailable).map(([metric,reason])=><p key={metric}>{metric}: UNAVAILABLE — {reason}</p>)}</>}
 {data.sources.map(s=><p key={String(s.kind)}>{String(s.kind)} SHA256: {String(s.sha256)}</p>)}
 <p>Calculation: {data.version}</p>{view==='reports'&&<p>Report version: {data.report.version}</p>}{data.limitations.map(s=><p key={s}>{s}</p>)}</section>;
}
