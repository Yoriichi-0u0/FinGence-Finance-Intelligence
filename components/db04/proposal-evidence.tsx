import type {ProcessingDashboardV1} from '@/lib/reconciliation-dashboard';
export default function ProposalEvidence({context}:{context:ProcessingDashboardV1}) {
 const rows=(x:unknown):Record<string,unknown>[]=>Array.isArray(x)?x.filter(v=>v&&typeof v==='object'):[];
 return <section><h2>AI proposals and independent evidence</h2><p>Ranking scores and financial eligibility are not approved financial transactions.</p>
 {['db04-fuzzy-proposals/1','db04-e5-proposals/1'].map(version=><section key={version}><h3>{version.includes('fuzzy')?'Fuzzy ranking proposals':'E5 ranking proposals'}</h3>
 {(context.rankings??[]).filter(r=>r.version===version).flatMap(r=>rows(r.evidence)).map((r,i)=><p key={i}>{String(r.bankRecordId)} → {String(r.ledgerRecordId)}: ranking proposal, unresolved</p>)}</section>)}
 <h3>Independent candidate checks</h3>{(context.proposalVerifications??[]).map((snapshot,i)=><section key={i}><p>Policy: {String(snapshot.policy_version)} · Snapshot: {String(snapshot.snapshot_sha256)}</p>
 {rows(snapshot.evidence).map((r,j)=><div key={j}><p>{String(r.bankRecordId)} → {String(r.ledgerRecordId)}: {String(r.outcome)} · Financial eligibility: {r.financialEligible===true?'passed (not approved)':'not established'}</p><p>{Array.isArray(r.reasons)?r.reasons.map(String).join(', '):'Evidence unavailable'}</p></div>)}</section>)}</section>;
}
