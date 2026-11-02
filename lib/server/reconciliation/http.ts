import 'server-only';
import type { createFinancialProcessingService } from './service';
import { digest, type RegisteredPair } from './processing';
import { approvedPoCSourceHashes } from '../poc-reconciliation/service';
export const UPLOAD_LIMIT = 1_050_000;
export function createProcessingUploadHandler(service: Pick<ReturnType<typeof createFinancialProcessingService>,'persist'>, registry: RegisteredPair = approvedPoCSourceHashes) {
    return async (request: Request) => {
        const headers = {'cache-control':'no-store'};
        if (!localFinancialReadAllowed(request)) return Response.json({error:'Not found'},{status:404,headers});
        const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
        if (!token) return Response.json({error:'Access denied'},{status:403,headers});
        if (!request.headers.get('content-type')?.startsWith('multipart/form-data;') || new URL(request.url).search)
            return Response.json({error:'Invalid upload'},{status:400,headers});
        if (Number(request.headers.get('content-length')) > UPLOAD_LIMIT) return Response.json({error:'Upload too large'},{status:413,headers});
        try {
            const reader=request.body?.getReader(); if (!reader) throw Error();
            const chunks:Uint8Array[]=[]; let total=0;
            while(true) {const part=await reader.read(); if(part.done) break; total+=part.value.length;
                if(total>UPLOAD_LIMIT){await reader.cancel();return Response.json({error:'Upload too large'},{status:413,headers});} chunks.push(part.value);}
            const bytes=new Uint8Array(total);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
            const form=await new Response(bytes,{headers:{'content-type':request.headers.get('content-type')!}}).formData();
            if([...form.keys()].some(k=>k!=='documents') || form.getAll('documents').length!==2) throw Error();
            const sources:Partial<Record<'bank'|'ledger',{bytes:Uint8Array;filename:string}>>={};
            for(const file of form.getAll('documents')) {
                if(typeof file==='string'||!file.name.toLowerCase().endsWith('.csv')||!['text/csv','application/octet-stream',''].includes(file.type)||file.size<1||file.size>512000) throw Error();
                const content=new Uint8Array(await file.arrayBuffer()),sha=digest(content);
                const role=sha===registry.bank?'bank':sha===registry.ledger?'ledger':null;
                if(!role||sources[role])throw Error();sources[role]={bytes:content,filename:file.name};
            }
            if(!sources.bank||!sources.ledger)throw Error();
            const receipt=await service.persist(token,sources.bank,sources.ledger);
            return Response.json({version:'db04-upload/1',...receipt},{headers});
        } catch(error) {
            const code=error&&typeof error==='object'&&'code' in error?error.code:null;
            if(code==='COMMIT_OUTCOME_UNKNOWN'||code==='ROLLBACK_UNCONFIRMED')return Response.json({error:'Persistence outcome uncertain; do not retry',code},{status:409,headers});
            return Response.json({error:'Upload denied or invalid'},{status:400,headers});
        }
    };
}
export function localFinancialReadAllowed(request: Request, env: Readonly<Record<string,string|undefined>> = process.env) {
    if (env.NODE_ENV !== 'development' || env.VERCEL || env.FINGENCE_DB04_LOCAL !== '1') return false;
    const url = new URL(request.url);
    return ['localhost','127.0.0.1','[::1]'].includes(url.hostname)
        && request.headers.get('host') === url.host
        && !request.headers.has('x-forwarded-host')
        && (!request.headers.has('origin') || request.headers.get('origin') === url.origin);
}
/** One authenticated, audited context for Transactions and Reconciliation consumers. */
export function createProcessingReadHandler(service: Pick<ReturnType<typeof createFinancialProcessingService>,'get'>) {
    return async (request: Request) => {
        const headers = {'cache-control':'no-store', 'vary':'Authorization', 'x-content-type-options':'nosniff'};
        if (!localFinancialReadAllowed(request)) return Response.json({error:'Not found'},{status:404,headers});
        const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization') ?? '')?.[1];
        const url = new URL(request.url), id = url.searchParams.get('processingId');
        if (!token || !id || !/^[a-f0-9]{64}$/.test(id) || [...url.searchParams.keys()].some(k=>k!=='processingId') || url.searchParams.getAll('processingId').length!==1)
            return Response.json({error:'Access denied'},{status:403,headers});
        try {
            const result = await service.get(token,id);
            return Response.json({version:'db04-processing-read/1',processingId:id,...result},{headers});
        } catch { return Response.json({error:'Access denied'},{status:403,headers}); }
    };
}
