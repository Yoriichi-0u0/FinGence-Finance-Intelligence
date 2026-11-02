// Explicit operator CLI. Never installs SQL, changes roles or loads owner credentials.
import {registerHooks} from 'node:module';
import {readFileSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Pool} from 'pg';
import ts from 'typescript';
let stage='APPROVAL';
try{
    if(process.env.NODE_ENV!=='test'||process.env.VERCEL||process.argv.length!==4)throw Error('OPERATOR_APPROVAL_REQUIRED');
    const [configFile,approvalFile]=process.argv.slice(2).map(p=>resolve(p));
    for(const file of [configFile,approvalFile]){
        const rel=relative(resolve('.local'),file);if(!rel||rel.startsWith('..')||rel.includes(':'))throw Error('PRIVATE_LOCAL_FILE_REQUIRED');
        execFileSync('git',['check-ignore','-q','--',file],{stdio:'ignore'});
    }
    const manifest=JSON.parse(readFileSync('docs/integration/db04-group-deployment-manifest.json','utf8'));
    const approval=JSON.parse(readFileSync(approvalFile,'utf8'));
    if(approval.projectRef!=='zmtdozblpvtjniehwjrw'||approval.database!=='postgres'||approval.scope!=='GROUP_SYNTHETIC_BANK_LEDGER_ONLY'
        ||approval.approved!==true||typeof approval.ownerApprovalReference!=='string'||!approval.ownerApprovalReference.trim()
        ||JSON.stringify(approval.sql)!==JSON.stringify(manifest.sql))throw Error('EXACT_OWNER_TEST_APPROVAL_REQUIRED');
    for(const file of manifest.sql)if(createHash('sha256').update(readFileSync(file.file)).digest('hex')!==file.sha256)throw Error('SQL_CHECKSUM_MISMATCH');
    stage='PRIVATE_CONFIGURATION';process.loadEnvFile(configFile);
    registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&context.parentURL){const file=new URL(`${specifier}.ts`,context.parentURL);if(existsSync(file))return next(file.href,context);}return next(specifier,context);},
        load(url,context,next){if(url.endsWith('.ts'))return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(fileURLToPath(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText};return next(url,context);}});
    const {serverPoolConfig,transactionDatabase}=await import('../../lib/server/db/postgres.ts');
    const {assertGroupSyntheticTarget}=await import('../../lib/server/reconciliation/group-synthetic.ts');
    const {exerciseGroupSynthetic}=await import('../../lib/server/reconciliation/group-synthetic-scenario.ts');
    const {LocalE5Provider}=await import('../../lib/server/reconciliation/ai03/model-loader.ts');
    const ca=process.env.DB04_GROUP_CA_FILE?readFileSync(process.env.DB04_GROUP_CA_FILE,'utf8'):undefined;
    const financial=serverPoolConfig({SUPABASE_DATABASE_URL:process.env.DB04_GROUP_RUNTIME_URL,SUPABASE_DATABASE_CA_CERT:ca});
    const broker={...serverPoolConfig({SUPABASE_DATABASE_URL:process.env.DB04_GROUP_BROKER_URL,SUPABASE_DATABASE_CA_CERT:ca}),max:2};
    assertGroupSyntheticTarget(financial,'runtime');assertGroupSyntheticTarget(broker,'broker');
    const runtimeRoot=resolve(process.env.DB04_E5_RUNTIME??'../ai03-runtime'),modelRoot=resolve(process.env.DB04_E5_MODEL??'../ai03-models/761b726dd34fb83930e26aab4e9ac3899aa1fa78');
    if(!existsSync(resolve(runtimeRoot,'node_modules/@huggingface/transformers/package.json'))||!existsSync(resolve(modelRoot,'onnx/model.onnx')))throw Error('OFFLINE_E5_UNAVAILABLE');
    stage='RESTRICTED_PREFLIGHT_AND_SYNTHETIC_WORKFLOW';
    const result=await exerciseGroupSynthetic({environment:'GROUP_HOSTED',
        bank:readFileSync('tests/reconciliation-persistence/fixtures/bank.csv'),ledger:readFileSync('tests/reconciliation-persistence/fixtures/ledger.csv'),
        e5:new LocalE5Provider(runtimeRoot,modelRoot),open:()=>{
            const f=new Pool(financial),b=new Pool(broker);f.on('error',()=>{});b.on('error',()=>{});
            return {financial:transactionDatabase(f),broker:transactionDatabase(b)};
        }});
    mkdirSync('outputs/db04-ai06',{recursive:true});writeFileSync('outputs/db04-ai06/group-hosted-synthetic.json',JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
}catch(error){
    const code=typeof error?.code==='string'&&/^(?:[0-9A-Z]{5}|E[A-Z_]{2,40})$/.test(error.code)?error.code:undefined;
    const check=typeof error?.message==='string'&&/^SYNTHETIC_CHECK_FAILED:[A-Z_]+$/.test(error.message)?error.message.split(':')[1]:undefined;
    console.error(JSON.stringify({stage,category:'STOPPED_NO_AUTOMATIC_RETRY',...(code?{code}:{}),...(check?{check}:{}),
        financialOutcome:stage==='RESTRICTED_PREFLIGHT_AND_SYNTHETIC_WORKFLOW'?'INSPECT_ACKNOWLEDGED_OR_UNCERTAIN_COMMITS_BEFORE_RERUN':'PROCESSING_NOT_STARTED'}));
    process.exitCode=1;
}
