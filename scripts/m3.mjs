import{spawn}from'node:child_process';
import{createRequire}from'node:module';
import{existsSync}from'node:fs';
if(process.env.VERCEL||process.env.NODE_ENV==='production'||!process.versions.node.startsWith('24.'))throw new Error('Local Node 24 only.');
Object.assign(process.env,{NODE_ENV:'development',FINGENCE_AI_LOCAL:'1',FINGENCE_V2_I1_LOCAL:'1',FINGENCE_M2_LOCAL:'1',FINGENCE_M3_LOCAL:'1'});
if(existsSync('.venv-ai/bin/python'))process.env.FINGENCE_AI_PYTHON??='.venv-ai/bin/python';
if(process.argv[2]==='serve'){
 const require=createRequire(import.meta.url),child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3183'],{env:process.env,stdio:'inherit'});
 for(const signal of['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));child.on('exit',code=>{process.exitCode=code??1;});
}else{
 await import('./ai-runtime-03.mjs');const{m3Runtime}=await import('../lib/server/financial-m3/runtime.ts');const{closeM2Runtime}=await import('../lib/server/ai-ingestion/m2/runtime.ts');const{provisionM3Account,setLocalOrganizationActive}=await import('../lib/server/financial-m3/management.ts');
 try{const{database}=await m3Runtime();if(process.argv[2]==='account'){
 const result=await provisionM3Account(database,{email:process.env.M2_LOCAL_EMAIL??'',password:process.env.M2_LOCAL_PASSWORD??'',organizationName:process.env.M2_LOCAL_ORGANIZATION,organizationId:process.env.M3_LOCAL_ORGANIZATION_ID,role:process.env.M3_LOCAL_ROLE??'Finance'});console.log(JSON.stringify({userId:result.userId,organizationId:result.organizationId,membershipActive:result.active}));
 }else if(process.argv[2]==='organization'&&['activate','deactivate'].includes(process.argv[3])){await setLocalOrganizationActive(database,process.env.M3_LOCAL_ORGANIZATION_ID??'',process.argv[3]==='activate');console.log('Local organization lifecycle updated. Memberships/sessions were not automatically reinstated.');}else throw new Error('Use serve, account or organization activate/deactivate.');
 }finally{await closeM2Runtime();}
}
