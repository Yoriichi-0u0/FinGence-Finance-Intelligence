import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { pocLocalEnabled, pocRequestAllowed } from '@/lib/server/poc-reconciliation/runtime';
import ReconciliationWorkspace from '@/components/poc-reconciliation/workspace';
import IllustrativePage from './illustrative';
import { DemoGate } from '@/components/demo/gate';
import DB04Workspace from '@/components/db04/workspace';
import {localFinancialReadAllowed} from '@/lib/server/reconciliation/http';
export default async function Page() {
    if(process.env.NODE_ENV==='development'&&!process.env.VERCEL&&process.env.FINGENCE_DB04_LOCAL==='1'){const h=await headers();let request:Request;try{request=new Request(`http://${h.get('host')??'invalid'}/reconciliation`,{headers:h});}catch{notFound();}if(!localFinancialReadAllowed(request))notFound();return <DB04Workspace view="reconciliation"/>;}
    if (pocLocalEnabled()) {
        const h = await headers();
        let request: Request;
        try { request = new Request(`http://${h.get('host') ?? 'invalid'}/reconciliation`, { headers: h }); } catch { notFound(); }
        if (!pocRequestAllowed(request)) notFound();
        return <ReconciliationWorkspace />;
    }
    return <DemoGate view="reconciliation" illustrative={<IllustrativePage />} />;
}
