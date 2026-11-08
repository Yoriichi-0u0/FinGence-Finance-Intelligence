import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Use the configured Node 24 runtime.');
if(process.env.VERCEL||!/^[0-9a-f]{64}$/.test(process.env.FINGENCE_V2_I1_TOKEN??''))throw new Error('Set FINGENCE_V2_I1_TOKEN to a private local synthetic access code: 64 lowercase hexadecimal characters.');
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3171'],{stdio:'inherit',env:{...process.env,FINGENCE_AI_LOCAL:'1',FINGENCE_V2_I1_LOCAL:'1'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code??1;});
