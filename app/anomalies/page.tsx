import {headers} from 'next/headers';
import {m5LocalEnabled,m5RequestAllowed} from '@/lib/server/tenant-admin-m5/flags';
import AnomalyWorkspace from '@/components/poc-anomalies/workspace';
import IllustrativePage from './illustrative';
/** Local M5 stack: real source-derived review candidates. Everywhere else the illustrative page is unchanged. */
export default async function Page(){
 if(m5LocalEnabled()){const h=await headers();let request:Request;try{request=new Request(`http://${h.get('host')??'invalid'}/anomalies`,{headers:h});}catch{return <IllustrativePage/>;}if(m5RequestAllowed(request))return <AnomalyWorkspace/>;}
 return <IllustrativePage/>;
}
