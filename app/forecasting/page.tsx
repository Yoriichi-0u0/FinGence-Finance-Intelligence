import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { pocLocalEnabled, pocRequestAllowed } from '@/lib/server/poc-reconciliation/runtime';
import ForecastWorkspace from '@/components/poc-forecast/workspace';
import IllustrativePage from './illustrative';
import { DemoGate } from '@/components/demo/gate';
import DB04Workspace from '@/components/db04/workspace';
import {localFinancialReadAllowed} from '@/lib/server/reconciliation/http';
/** Combined local PoC stack: source-derived, backtested cash baseline. Everywhere else the illustrative page is unchanged. */
export default async function Page() {
    if(process.env.NODE_ENV==='development'&&!process.env.VERCEL&&process.env.FINGENCE_DB04_LOCAL==='1'){const h=await headers();let request:Request;try{request=new Request(`http://${h.get('host')??'invalid'}/forecasting`,{headers:h});}catch{notFound();}if(!localFinancialReadAllowed(request))notFound();return <DB04Workspace view="forecasting"/>;}
    if (pocLocalEnabled()) {
        const h = await headers();
        let request: Request;
        try { request = new Request(`http://${h.get('host') ?? 'invalid'}/forecasting`, { headers: h }); } catch { notFound(); }
        if (!pocRequestAllowed(request)) notFound();
        return <ForecastWorkspace />;
    }
    return <DemoGate view="forecasting" illustrative={<IllustrativePage />} />;
}
