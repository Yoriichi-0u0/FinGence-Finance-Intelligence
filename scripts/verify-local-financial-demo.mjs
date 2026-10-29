// Local HTTP rehearsal; tokens/cookies are kept in memory and never printed.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const origin=new URL(process.argv[2]??'http://127.0.0.1:3171');
assert.equal(origin.hostname,'127.0.0.1');assert.equal(origin.protocol,'http:');assert.equal(origin.pathname,'/');
const endpoint=new URL('/api/ai-ingestion/synthetic-financial',origin),bootstrap=process.env.FINGENCE_V2_I1_TOKEN;
assert.match(bootstrap??'',/^[0-9a-f]{64}$/);
let cookie='';const evidence={mode:'LOCAL_HTTP_DETERMINISTIC',checks:[],csv:null,xlsx:null,revocationMs:null};
const call=(query='',init={})=>fetch(new URL(endpoint.href+query),{...init,headers:{origin:origin.origin,cookie,...init.headers},signal:init.signal??AbortSignal.timeout(10000)});
const denied=await call('?batch='+randomUUID());assert.equal(denied.status,404);evidence.checks.push('missing session denied');
const login=await call('?action=login',{method:'POST',headers:{authorization:`Bearer ${bootstrap}`}});assert.equal(login.status,200);
const setCookie=login.headers.get('set-cookie');assert.ok(setCookie?.includes('HttpOnly')&&setCookie.includes('SameSite=Strict'));cookie=setCookie.split(';')[0];evidence.checks.push('server-issued HttpOnly session');
async function upload(name,id=randomUUID()) {const bytes=await readFile(new URL('../public/samples/ingestion/'+name,import.meta.url));const form=new FormData();form.append('file',new File([bytes],name));const response=await call('',{method:'POST',headers:{'x-fingence-operation':id},body:form});assert.equal(response.status,200);return response.json();}
const csv=await upload('edge_cases.csv');const result=await (await call('?batch='+csv.batchId)).json();
assert.deepEqual([result.batch.rows_received,result.batch.valid_count,result.batch.warning_count,result.batch.rejected_count,result.records.length],[8,2,3,3,5]);
const report=JSON.parse(result.report);assert.equal(report.total,'105.5');assert.equal(report.currency,'MYR');assert.equal(report.includedCount,2);assert.equal(report.excludedWarnings,3);assert.equal(report.publicationEligible,false);assert.equal(result.answer.value,report.total);assert.deepEqual(result.answer.sources,report.sources);
for(const ref of report.sources)assert.ok(result.records.some(r=>r.id===ref.transactionId&&r.source_row_id===ref.sourceRowId));
evidence.csv={checked:8,valid:2,warning:3,rejected:3,accepted:5,total:report.total,currency:report.currency,excludedWarnings:report.excludedWarnings,sourceReferences:report.sources.length};evidence.checks.push('CSV, calculation, report and deterministic answer agree');
const again=await upload('edge_cases.csv');assert.notEqual(again.batchId,csv.batchId);const session=await (await call('?action=session')).json();assert.equal(session.batches.find(b=>b.name==='edge_cases.csv').id,again.batchId);evidence.checks.push('reprocessing replaces latest batch');
const xlsx=await upload('bank_statement.xlsx');const bank=await (await call('?batch='+xlsx.batchId)).json();assert.equal(bank.batch.valid_count,8);assert.equal(bank.records.length,8);assert.equal(bank.report,null);assert.equal(bank.answer,null);evidence.xlsx={checked:8,accepted:8,sourceSignedSum:'UNAVAILABLE'};evidence.checks.push('incompatible XLSX basis unavailable');
assert.equal((await call('?batch='+csv.batchId,{headers:{cookie:'fingence_demo_session='+'b'.repeat(43)}})).status,404);evidence.checks.push('invalid session denied');
assert.equal((await call('?action=logout',{method:'POST',headers:{origin:'http://other.invalid'}})).status,404);evidence.checks.push('cross-origin mutation denied');
const controller=new AbortController();const events=await call('?action=events',{signal:controller.signal});assert.equal(events.status,200);const reader=events.body.getReader();const decode=new TextDecoder();assert.match(decode.decode((await reader.read()).value),/event: active/);
const started=performance.now();assert.equal((await call('?action=logout',{method:'POST'})).status,200);let revoked=false;
const timeout=setTimeout(()=>controller.abort(),3000);try{while(!revoked){const chunk=await reader.read();if(chunk.done)break;revoked=/event: revoked/.test(decode.decode(chunk.value));}}finally{clearTimeout(timeout);controller.abort();}
assert.ok(revoked);evidence.revocationMs=Math.round(performance.now()-started);assert.equal((await call('?batch='+csv.batchId)).status,404);evidence.checks.push('revocation event delivered and further reads denied');
console.log(JSON.stringify(evidence,null,2));
