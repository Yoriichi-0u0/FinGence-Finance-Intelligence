import './ai-runtime-03.mjs';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';
import { prepareI2ReportDestination, saveI2Report } from './ai-i2-report.mjs';
const { processLiveDocument03,liveEnabled03,providerStatus03 }=await import('../lib/server/ai-ingestion/increment-03/service.ts');
// Explicitly bounded to one frozen synthetic CSV and the existing Groq provider/quota gate.
if(process.argv.length!==3||process.argv[2]!=='--dispatch-one'||process.env.FINGENCE_V2_I2_SINGLE_DISPATCH_AUTHORIZED!=='1'||process.env.FINGENCE_V2_I2_QUOTA_REVIEW_CONFIRMED!=='1'||!process.env.FINGENCE_V2_I2_AUTHORIZATION_ID||!liveEnabled03()||process.env.FINGENCE_AI03_PROVIDER==='ollama'||!providerStatus03().ready)throw new Error('SEPARATE_LIVE_AUTHORIZATION_REQUIRED');
prepareI2ReportDestination(); // Fail before provider dispatch if report storage is predictably unsafe or unwritable.
const file='synthetic/ai-ingestion-i2/i01.csv';const manifest=JSON.parse(readFileSync('synthetic/ai-ingestion-i2/manifest.json','utf8'));const bytes=readFileSync(file);
if(createHash('sha256').update(bytes).digest('hex')!==manifest.files[basename(file)].sha256)throw new Error('INPUT_HASH_MISMATCH');
// All worktrees must use the original persistent quota ledger, never a fresh per-worktree ledger.
const common=realpathSync(resolve(execFileSync('git',['rev-parse','--git-common-dir'],{encoding:'utf8'}).trim()));
if(basename(common)!=='.git')throw new Error('CANONICAL_GIT_DIRECTORY_REQUIRED');
const workspace=dirname(common), quotaRoot=resolve(workspace,'.ai-local'), quotaDir=resolve(quotaRoot,'increment-03');
for(const path of [quotaRoot,quotaDir,resolve(quotaDir,'quota.json')]) {const stat=lstatSync(path);if(stat.isSymbolicLink()||(process.getuid&&stat.uid!==process.getuid())||(path===quotaRoot&&(!stat.isDirectory()||(stat.mode&0o022)!==0))||(path===quotaDir&&(!stat.isDirectory()||(stat.mode&0o077)!==0))||(path.endsWith('quota.json')&&(!stat.isFile()||(stat.mode&0o077)!==0)))throw new Error('UNSAFE_SHARED_QUOTA_LEDGER');}
const {QuotaLedger}=await import('../lib/server/ai-ingestion/increment-03/quota.ts');
const {GroqProvider03}=await import('../lib/server/ai-ingestion/increment-03/providers.ts');
const run=await processLiveDocument03(bytes,'source.csv',()=>{},new GroqProvider03(new QuotaLedger(quotaDir),undefined,{authorizationId:process.env.FINGENCE_V2_I2_AUTHORIZATION_ID,sourceSha256:manifest.files[basename(file)].sha256}));
let evaluation=null, evaluationError=null;
try {
 if(run.evidence&&run.evidence.sourceId!==manifest.files[basename(file)].sha256)throw new Error('OUTPUT_SOURCE_MISMATCH');
 if(run.mode==='LIVE_GROQ'&&run.receipt&&run.receipt.finishReason==='stop'){const {scoreLiveRun}=await import('../lib/server/ai-ingestion/increment-i2/evaluation.ts');const gold=JSON.parse(readFileSync('tests/fixtures/ai-ingestion-i2/gold.json','utf8'));evaluation=scoreLiveRun(run,gold.cases['i01.csv']);}
} catch {evaluationError='EVALUATION_FAILED';}
const report={version:'v2-i2-live-evaluation-0.1',run,evaluation,evaluationError};
const summary=`Origin: ${run.mode}\nSource SHA-256: ${run.evidence?.sourceId??'unavailable'}\nError: ${run.error??evaluationError??'none'}\nProvider input/output tokens: ${run.receipt?.inputTokens??'unavailable'}/${run.receipt?.outputTokens??'unavailable'}\nRetries: ${run.receipt?.retries??0}\nUnknown dispatches must be investigated; do not automatically retry.\n`;
const paths=saveI2Report(report,summary);
console.log(JSON.stringify({mode:run.mode,sourceSha256:run.evidence?.sourceId??null,receipt:run.receipt,dispatch:run.dispatch,error:run.error??evaluationError,coverage:run.verification?.coverage??null,promptHash:run.promptHash,policyHash:run.policyHash,runtimeMs:run.runtimeMs,...paths}));
if(run.mode!=='LIVE_GROQ'||run.error||evaluationError)process.exitCode=2;
