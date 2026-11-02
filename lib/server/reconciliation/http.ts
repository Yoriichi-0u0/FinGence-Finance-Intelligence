import 'server-only';
import type { createFinancialProcessingService } from './service';
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
