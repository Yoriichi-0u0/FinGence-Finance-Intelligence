// Post-seal read-only evaluator diagnostic. Never imported by matching or verification.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const dir='docs/reconciliation/evidence/ai05/official/';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=value=>{
 const sort=v=>Array.isArray(v)?v.map(sort):v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,sort(x)])):v;
 return JSON.stringify(sort(value),null,2)+'\n';
};
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const seal=read(dir+'prediction-seal.json');
assert(hash(fs.readFileSync(dir+'predictions.json'))===seal.predictionsSHA256,'Predictions must be sealed before audit');
const predictions=read(dir+'predictions.json'),official=read(dir+'evaluation.json');
const source=read('research/reconciliation/m2/fixtures/inputs/heldout.json');
// This separate offline evaluator reads labels only after the completed sealed official experiment.
const truth=read('research/reconciliation/m2/fixtures/evaluation-only/heldout-truth.json');
const records=new Map(source.records.map(r=>[r.id,r]));
const edge=p=>JSON.stringify([p.bankId,p.ledgerId]);
const positives=new Set(truth.relationships.filter(r=>r.kind==='PAIR').map(r=>edge({bankId:r.bankIds[0],ledgerId:r.ledgerIds[0]})));
const negatives=new Set(truth.negatives.map(edge));
function decimal(value){const [whole,fraction='']=value.split('.');return {units:BigInt(whole+fraction),scale:fraction.length};}
function equal(a,b){const x=decimal(a),y=decimal(b);return x.units*10n**BigInt(y.scale)===y.units*10n**BigInt(x.scale);}
const date=d=>Date.parse(d+'T00:00:00Z')/86400000;
const plausible=(b,l)=>equal(b.amount,l.amount)&&b.currency===l.currency&&b.direction===l.direction&&Math.abs(date(b.canonicalDate)-date(l.canonicalDate))<=2;
const identity=s=>s===null?null:s.normalize('NFC').trim();
const feature=r=>({amount:r.amount,currency:r.currency,direction:r.direction,transactionDate:r.transactionDate,postingDate:r.postingDate,canonicalDate:r.canonicalDate,description:r.description,counterparty:r.counterparty,reference:r.reference});
const input={version:source.version,split:source.split,candidates:source.records.map(r=>({candidateId:r.id,role:r.role,features:feature(r)})).sort((a,b)=>a.candidateId<b.candidateId?-1:1)};
const summaries=[];
for(const row of predictions.results){
 const run=row.run,{fingerprint,processingMs,timings,...result}=run;
 void processingMs;void timings;
 const expected=run.method==='E2b'?hash(canonical({...result,candidates:result.candidates.map(p=>({...p,cosine:p.score,evidence:{...p.evidence,description:p.score}})),input:input.candidates})):hash(canonical({input,result}));
 assert(expected===fingerprint,'Stored ranking fingerprint mismatch: '+row.method);
 const before=new Set(run.suggestions.map(edge));
 const after=new Set(row.verification.decisions.filter(d=>d.disposition==='VERIFIED_SUGGESTION').map(edge));
 const metrics=official.results.find(r=>r.method===row.method).metrics;
 for(const [name,edges]of [['before',before],['after',after]]){
  const tp=[...edges].filter(e=>positives.has(e)).length,fp=[...edges].filter(e=>negatives.has(e)).length;
  assert(tp===metrics[name].truePositives&&fp===metrics[name].explicitFalsePositives&&positives.size-tp===metrics[name].falseNegatives,'Independent economic count mismatch');
 }
 let total=0;
 for(const b of source.records.filter(r=>r.role==='BANK'))for(const l of source.records.filter(r=>r.role==='LEDGER'))if(plausible(b,l))total++;
 assert(total===run.candidateCount,'Independent candidate pool count mismatch');
 const pool=new Set(run.candidates.map(edge));
 for(const positive of positives)assert(pool.has(positive),'Positive missing from shared pool');
 for(const p of run.candidates){
  assert(plausible(records.get(p.bankId),records.get(p.ledgerId)),'Financially invalid ranked candidate');
  assert(p.rank===run.candidates.filter(q=>q.bankId===p.bankId&&q.score>=p.score-1e-12).length,'Worst-tie rank mismatch');
 }
 const used=[];
 for(const e of after){
  const [bId,lId]=JSON.parse(e),b=records.get(bId),l=records.get(lId);used.push(bId,lId);
  assert(plausible(b,l),'Financially invalid verified pair');
  assert(identity(b.reference)!==null&&identity(b.reference)===identity(l.reference),'Missing or conflicting verified reference');
  assert(identity(b.counterparty)!==null&&identity(b.counterparty)===identity(l.counterparty),'Missing or conflicting verified counterparty');
  assert(!source.records.some(r=>(r.role==='BANK'&&r.id!==bId&&plausible(r,l))||(r.role==='LEDGER'&&r.id!==lId&&plausible(b,r))),'Verified competing partner');
 }
 assert(new Set(used).size===used.length,'Duplicate verified consumption');
 summaries.push({method:row.method,beforeTP:metrics.before.truePositives,beforeExplicitFP:metrics.before.explicitFalsePositives,afterTP:metrics.after.truePositives,afterExplicitFP:metrics.after.explicitFalsePositives,candidatePairs:total,verifiedEdges:[...after].sort()});
}
const same=summaries.every(s=>JSON.stringify(s.verifiedEdges)===JSON.stringify(summaries[0].verifiedEdges));
const e1=new Set(predictions.results.find(r=>r.method==='E1').run.suggestions.map(edge));
const e5=predictions.results.find(r=>r.method==='E2b');
const additional=e5.run.suggestions.filter(p=>positives.has(edge(p))&&!e1.has(edge(p))).map(p=>({bankId:p.bankId,ledgerId:p.ledgerId,decision:e5.verification.decisions.find(d=>edge(d)===edge(p))}));
const audit={status:'PASSED_READ_ONLY_INDEPENDENT_AUDIT',officialRerun:false,configurationChanged:false,truthLocation:'Original evaluation-only artifact; no copied labels',predictionsSHA256:seal.predictionsSHA256,identicalVerifiedPairSets:same,additionalGenuineE5VsE1:additional,methods:summaries};
const bytes=canonical(audit),out='docs/reconciliation/evidence/ai05/independent-audit.json';
if(fs.existsSync(out))assert(fs.readFileSync(out,'utf8')===bytes,'Preserve existing audit; do not overwrite differing evidence');
else fs.writeFileSync(out,bytes,{flag:'wx'});
console.log(`Independent audit passed: ${positives.size} genuine pairs, shared ${summaries[0].candidatePairs} candidates, identical verified sets=${same}, additional genuine E5 pairs=${additional.length}.`);
