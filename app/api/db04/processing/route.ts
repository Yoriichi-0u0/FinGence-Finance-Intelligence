import { createPostgresDatabase, serverPoolConfig } from '@/lib/server/db/postgres';
import { createFinancialProcessingService } from '@/lib/server/reconciliation/service';
import { createProcessingReadHandler, createProcessingUploadHandler, localFinancialReadAllowed } from '@/lib/server/reconciliation/http';
export const runtime = 'nodejs';
async function handle(request: Request, upload: boolean) {
    if (!localFinancialReadAllowed(request)) return Response.json({error:'Not found'},{status:404});
    const config = serverPoolConfig();
    // This local route must never connect to a hosted target, even with a dev flag.
    if (!['localhost','127.0.0.1','::1'].includes(config.host ?? '')) return Response.json({error:'Not found'},{status:404});
    const db = createPostgresDatabase();
    try {
        const safe = await db.transaction(async tx => (await tx.query<{allowed:boolean}>(`SELECT
            NOT r.rolsuper AND NOT r.rolbypassrls
            AND pg_has_role(current_user,'fingence_reconciliation_runtime','member')
            AND n.nspowner<>r.oid AS allowed FROM pg_roles r
            JOIN pg_namespace n ON n.nspname='fingence_reconciliation' WHERE r.rolname=current_user`)).rows[0]?.allowed);
        if (!safe) return Response.json({error:'Access denied'},{status:403});
        const service=createFinancialProcessingService(db);
        return await (upload?createProcessingUploadHandler(service):createProcessingReadHandler(service))(request);
    } catch { return Response.json({error:'Access denied'},{status:403}); }
    finally { await db.close(); }
}
export const GET=(request:Request)=>handle(request,false);
export const POST=(request:Request)=>handle(request,true);
