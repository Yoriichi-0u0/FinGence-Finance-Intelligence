import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { hashBytes, hashSource, HASH_CONVENTION } from './integrity.mjs';
const folder=resolve(process.argv[2] || '');
const rows=JSON.parse(readFileSync(join(folder,'results.json'),'utf8'));
if(rows.length!==408) throw new Error(`Incomplete matrix: ${rows.length}/408 rows`);
const comparison=[];
for(const r of rows.filter(r=>r.variant!=='baseline' && r.medianMs!==undefined)) {
  const b=rows.find(b=>b.size===r.size && b.variant==='baseline' && b.scope===r.scope && b.kind===r.kind);
  comparison.push({size:r.size,variant:r.variant,scope:r.scope??'',kind:r.kind,
    baselineMedianMs:b.medianMs,candidateMedianMs:r.medianMs,medianChangePercent:(r.medianMs/b.medianMs-1)*100,
    baselineP95Ms:b.p95Ms,candidateP95Ms:r.p95Ms});
}
writeFileSync(join(folder,'comparison.json'),JSON.stringify(comparison,null,2));
const keys=Object.keys(comparison[0]);
writeFileSync(join(folder,'comparison.csv'),keys.join(',')+'\n'+comparison.map(r=>keys.map(k=>r[k]).join(',')).join('\n')+'\n');
const planRows=[];
for(const r of rows.filter(r=>r.planFile)) {
  const p=JSON.parse(readFileSync(join(folder,r.planFile),'utf8')).plan[0];
  const scans=[],sorts=[];
  function visit(n) {
    if(n['Node Type'].includes('Scan')) scans.push({type:n['Node Type'],index:n['Index Name'],relation:n['Relation Name'],rows:n['Actual Rows'],loops:n['Actual Loops']});
    if(n['Sort Method']) sorts.push({method:n['Sort Method'],space:n['Sort Space Used'],spaceType:n['Sort Space Type']});
    for(const key of ['Full-sort Groups','Pre-sorted Groups']) {
      if(n[key]) sorts.push({type:n['Node Type'],group:key,details:n[key]});
    }
    for(const child of n.Plans||[]) visit(child);
  }
  visit(p.Plan);
  planRows.push({size:r.size,variant:r.variant,scope:r.scope,kind:r.kind,executionMs:p['Execution Time'],planningMs:p['Planning Time'],
    sharedHits:p.Plan['Shared Hit Blocks'],sharedReads:p.Plan['Shared Read Blocks'],tempReads:p.Plan['Temp Read Blocks'],tempWrites:p.Plan['Temp Written Blocks'],scans,sorts});
}
writeFileSync(join(folder,'plan-summary.json'),JSON.stringify(planRows,null,2));
const artifacts=['environment.json','results.json','comparison.json','comparison.csv','plan-summary.json',...rows.filter(r=>r.planFile).map(r=>r.planFile)];
writeFileSync(join(folder,'manifest.json'),JSON.stringify({hashConvention:HASH_CONVENTION,
  artifacts:Object.fromEntries(artifacts.map(file=>[file,hashBytes(readFileSync(join(folder,file)))])),
  sources:Object.fromEntries(['scripts/db01/run.mjs','scripts/db01/fixture.ts','tests/benchmarks/db01.test.ts',
    'supabase/sql/phase1-clean-setup.sql','supabase/sql/c3b1-grouped-persistence-upgrade.sql',
    'lib/server/api/transaction-query.ts','lib/server/api/transaction-selection.ts','lib/server/api/transaction-detail-query.ts',
    'lib/server/api/batch-query.ts','lib/server/persistence/grouped.ts','lib/server/persistence/repository.ts',
    'scripts/db01/integrity.mjs','scripts/db01/verify.mjs','scripts/db01/summarize.mjs'].map(file=>[file,hashSource(readFileSync(file))]))},null,2));
console.log(JSON.stringify({folder,measurements:rows.length,plans:planRows.length,
  broad100k:comparison.filter(r=>r.size===100000 && r.scope===1000),
  writes:comparison.filter(r=>r.kind==='grouped_insert_100'),
  diskSorts:planRows.filter(p=>p.sorts.some(s=>s.spaceType==='Disk')).length,
  tempBlocks:planRows.reduce((n,p)=>n+(p.tempReads||0)+(p.tempWrites||0),0)},null,2));
