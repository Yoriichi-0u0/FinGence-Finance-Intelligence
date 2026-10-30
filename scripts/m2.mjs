import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
if(process.env.VERCEL||process.env.NODE_ENV==='production'||Number(process.versions.node.split('.')[0])!==24)throw new Error('Local Node24 development only.');
Object.assign(process.env,{NODE_ENV:'development',FINGENCE_AI_LOCAL:'1',FINGENCE_V2_I1_LOCAL:'1',FINGENCE_M2_LOCAL:'1'});
if(existsSync('.venv-ai/bin/python'))process.env.FINGENCE_AI_PYTHON??='.venv-ai/bin/python';
if(process.argv[2]==='account'){
 await import('./ai-runtime-03.mjs');
 const {m2Runtime,closeM2Runtime}=await import('../lib/server/ai-ingestion/m2/runtime.ts');
 const {provisionM2Account}=await import('../lib/server/ai-ingestion/m2/identity.ts');
 try{await provisionM2Account((await m2Runtime()).database,{email:process.env.M2_LOCAL_EMAIL??'',password:process.env.M2_LOCAL_PASSWORD??'',organizationName:process.env.M2_LOCAL_ORGANIZATION??''});console.log('Local account provisioned. No hosted service was changed.');}finally{await closeM2Runtime();}
}else if(process.argv[2]==='serve'){
 const require=createRequire(import.meta.url);const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3182'],{stdio:'inherit',env:process.env});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>{process.exitCode=code??1;});
}else throw new Error('Use account or serve.');
