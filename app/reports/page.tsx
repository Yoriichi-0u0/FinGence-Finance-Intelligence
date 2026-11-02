import {headers} from 'next/headers';
import {notFound} from 'next/navigation';
import DB04Workspace from '@/components/db04/workspace';
import {localFinancialReadAllowed} from '@/lib/server/reconciliation/http';
import {m3LocalEnabled,m3RequestAllowed} from '@/lib/server/financial-m3/runtime';
import {m5LocalEnabled} from '@/lib/server/tenant-admin-m5/flags';
import FinancialWorkspace from '@/components/financial-m3/workspace';
import ManagementReportLink from '@/components/poc-anomalies/report-link';
import IllustrativePage from './illustrative';
import { DemoGate } from '@/components/demo/gate';
export default async function Page(){
 if(process.env.NODE_ENV==='development'&&!process.env.VERCEL&&process.env.FINGENCE_DB04_LOCAL==='1'){const h=await headers();let request:Request;try{request=new Request(`http://${h.get('host')??'invalid'}/reports`,{headers:h});}catch{notFound();}if(!localFinancialReadAllowed(request))notFound();return <DB04Workspace view="reports"/>;}
 if(m3LocalEnabled()){const h=await headers();let request:Request;try{request=new Request(`http://${h.get('host')??'invalid'}/reports`,{headers:h});}catch{return <IllustrativePage/>;}if(m3RequestAllowed(request))return <><FinancialWorkspace view="reports" administration={m5LocalEnabled()}/>{m5LocalEnabled()?<ManagementReportLink/>:null}</>;}
 return <DemoGate view="reports" illustrative={<IllustrativePage />} />;
}
