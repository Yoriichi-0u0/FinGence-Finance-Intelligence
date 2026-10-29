import { localTenant } from '../../../../lib/server/ai-ingestion/v2-i1/local-auth';
import { syntheticBrowserRuntime } from '../../../../lib/server/integration/synthetic-browser';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const unavailable=()=>Response.json({error:'Unavailable'},{status:404,headers});
export async function GET(request:Request) {
 const tenant=localTenant(request); if(!tenant)return unavailable();
 try {
  const url=new URL(request.url), db=await syntheticBrowserRuntime(tenant);
  const operation=url.searchParams.get('operation');
  if(operation)return Response.json(await db.lookup(operation),{headers});
  const batch=url.searchParams.get('batch'); if(!batch)return unavailable();
  return Response.json(await db.result(batch),{headers});
 } catch {return unavailable();}
}
export async function POST(request:Request) {
 const tenant=localTenant(request); if(!tenant)return unavailable();
 const id=request.headers.get('x-fingence-operation'); if(!id)return unavailable();
 try {
  const reader=request.body?.getReader(); if(!reader)return unavailable();
  const parts:Uint8Array[]=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>200000){await reader.cancel();return unavailable();}parts.push(next.value);}
  const form=await new Response(Buffer.concat(parts),{headers:{'Content-Type':request.headers.get('content-type')??''}}).formData(), file=form.get('file');
  if(!(file instanceof File)||file.size>100000||form.getAll('file').length!==1||[...form.keys()].some(key=>key!=='file'))return unavailable();
  const result=await (await syntheticBrowserRuntime(tenant)).upload(new Uint8Array(await file.arrayBuffer()),id);
  return Response.json(result,{headers});
 } catch(error) {
  if(error instanceof Error&&error.message==='SYNTHETIC_SAMPLE_REQUIRED')return Response.json({code:'SYNTHETIC_SAMPLE_REQUIRED'},{status:422,headers});
  return Response.json({error:'Processing was not confirmed. Check the operation before another attempt.'},{status:503,headers});
 }
}
