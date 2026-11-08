import {headers} from 'next/headers';
import {notFound} from 'next/navigation';
import {pocLocalEnabled,pocRequestAllowed} from '@/lib/server/poc-reconciliation/runtime';
import PocInsightsWorkspace from '@/components/poc-insights/workspace';
import {m3LocalEnabled,m3RequestAllowed} from '@/lib/server/financial-m3/runtime';
import {m5LocalEnabled} from '@/lib/server/tenant-admin-m5/flags';
import FinancialWorkspace from '@/components/financial-m3/workspace';
import IllustrativePage from './illustrative';
import { DemoGate } from '@/components/demo/gate';
export default async function Page(){
 if(pocLocalEnabled()){const h=await headers();let request:Request;try{request=new Request(`http://${h.get('host')??'invalid'}/analytics`,{headers:h});}catch{notFound();}if(!pocRequestAllowed(request))notFound();return <PocInsightsWorkspace view="analytics"/>;}
 if(m3LocalEnabled()){const h=await headers();let request:Request;try{request=new Request(`http://${h.get('host')??'invalid'}/analytics`,{headers:h});}catch{return <IllustrativePage/>;}if(m3RequestAllowed(request))return <FinancialWorkspace view="analytics" administration={m5LocalEnabled()}/>;}
 return <DemoGate view="analytics" illustrative={<IllustrativePage />} />;
}
