import { createHmac } from 'node:crypto';
import { localTenant } from '../../../../lib/server/ai-ingestion/v2-i1/local-auth';
import { localAccessAllowed } from '../../../../lib/server/ai-ingestion/service';
import { syntheticBrowserRuntime } from '../../../../lib/server/integration/synthetic-browser';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const cookieName='fingence_demo_session';
const unavailable=()=>Response.json({error:'Unavailable'},{status:404,headers});
function tenantConfiguration(request:Request) {
 if(process.env.NODE_ENV!=='development'||process.env.VERCEL||process.env.FINGENCE_V2_I1_LOCAL!=='1'||!localAccessAllowed(request))return null;
 const secret=process.env.FINGENCE_V2_I1_TOKEN;if(!secret||!/^[0-9a-f]{64}$/.test(secret))return null;
 const d=createHmac('sha256',Buffer.from(secret,'hex')).update('synthetic-v2-i1-tenant').digest('hex').slice(0,32);
 return `${d.slice(0,8)}-${d.slice(8,12)}-${d.slice(12,16)}-${d.slice(16,20)}-${d.slice(20)}`;
}
function session(request:Request){const value=request.headers.get('cookie')?.split(';').map(p=>p.trim()).find(p=>p.startsWith(cookieName+'='))?.slice(cookieName.length+1);return value&&/^[A-Za-z0-9_-]{43}$/.test(value)?value:null;}
function sessionCookie(value:string,maxAge:number){return `${cookieName}=${value}; Path=/api/ai-ingestion/synthetic-financial; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;}
export async function GET(request:Request) {
 const tenant=tenantConfiguration(request), token=session(request);if(!tenant)return unavailable();
 if(!token)return new URL(request.url).searchParams.get('action')==='session'?Response.json({active:false},{headers}):unavailable();
 try {
  const url=new URL(request.url), db=await syntheticBrowserRuntime(tenant);await db.checkSession(token);
  if(url.searchParams.get('action')==='session')return Response.json({active:true,generation:db.generation,batches:await db.listBatches(token)},{headers});
  if(url.searchParams.get('action')==='events') {
   let cleanup=()=>{};
   const stream=new ReadableStream({start(controller){
    let closed=false;const encoder=new TextEncoder();let unwatch=()=>{};
    const end=()=>{if(closed)return;closed=true;unwatch();clearInterval(timer);request.signal.removeEventListener('abort',cleanup);try{controller.enqueue(encoder.encode('event: revoked\ndata: {}\n\n'));controller.close();}catch{}};
    cleanup=end;unwatch=db.watch(token,end);
    let checking=false;
    const heartbeat=async()=>{if(checking||closed)return;checking=true;try{await db.checkSession(token);if(!closed)controller.enqueue(encoder.encode('event: active\ndata: {}\n\n'));}catch{end();}finally{checking=false;}};
    const timer=setInterval(()=>{void heartbeat();},1000);timer.unref();request.signal.addEventListener('abort',cleanup,{once:true});if(request.signal.aborted)end();else void heartbeat();
   },cancel(){cleanup();}});
   return new Response(stream,{headers:{...headers,'Content-Type':'text/event-stream','X-Accel-Buffering':'no'}});
  }
  const operation=url.searchParams.get('operation');if(operation)return Response.json(await db.lookup(operation,token,url.searchParams.get('generation')),{headers});
  const batch=url.searchParams.get('batch');if(!batch)return unavailable();return Response.json(await db.result(batch,token),{headers});
 }catch{return new URL(request.url).searchParams.get('action')==='session'?Response.json({active:false},{headers}):unavailable();}
}
export async function POST(request:Request) {
 const tenant=tenantConfiguration(request);if(!tenant)return unavailable();
 // Cookie-authenticated mutations require the exact browser origin, in addition to the loopback gate.
 const url=new URL(request.url);const actualOrigin=`${url.protocol}//${request.headers.get('host')??url.host}`;
 if(request.headers.get('origin')!==actualOrigin)return unavailable();
 try {
  const action=url.searchParams.get('action');if(action==='login'&&localTenant(request)!==tenant)return unavailable();
  const db=await syntheticBrowserRuntime(tenant);
  if(action==='login'){
   if(localTenant(request)!==tenant)return unavailable();const created=await db.createSession();
   return Response.json({active:true,generation:db.generation,expiresAt:created.expiresAt,batches:await db.listBatches(created.token)},{headers:{...headers,'Set-Cookie':sessionCookie(created.token,1800)}});
  }
  const token=session(request);if(!token)return unavailable();
  if(action==='logout'){await db.revoke(token);return Response.json({active:false},{headers:{...headers,'Set-Cookie':sessionCookie('',0)}});}
  try{await db.checkSession(token);}catch{return unavailable();}
  const id=request.headers.get('x-fingence-operation');if(!id)return unavailable();
  const generation=request.headers.get('x-fingence-generation');if(generation!==db.generation)return unavailable();
  if(action==='retire')return Response.json(await db.retire(id,token,request.headers.get('x-fingence-operation-generation'),generation),{headers});
  const reader=request.body?.getReader();if(!reader)return unavailable();const parts:Uint8Array[]=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>200000){await reader.cancel();return unavailable();}parts.push(next.value);}
  const form=await new Response(Buffer.concat(parts),{headers:{'Content-Type':request.headers.get('content-type')??''}}).formData(), file=form.get('file');
  if(!(file instanceof File)||file.size>100000||form.getAll('file').length!==1||[...form.keys()].some(key=>key!=='file'))return unavailable();
  return Response.json(await db.upload(new Uint8Array(await file.arrayBuffer()),id,token,generation),{headers});
 }catch(error){
  if(error instanceof Error&&error.message==='SYNTHETIC_SAMPLE_REQUIRED')return Response.json({code:'SYNTHETIC_SAMPLE_REQUIRED'},{status:422,headers});
  return Response.json({error:'Processing was not confirmed. Check the operation before another attempt.'},{status:503,headers});
 }
}
