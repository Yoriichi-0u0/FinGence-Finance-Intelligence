import {headers} from 'next/headers';
import {m3LocalEnabled,m3RequestAllowed} from '@/lib/server/financial-m3/runtime';
import FinancialWorkspace from '@/components/financial-m3/workspace';
import IllustrativePage from './illustrative';
export default async function Page(){
 if(m3LocalEnabled()){const h=await headers();let request:Request;try{request=new Request(`http://${h.get('host')??'invalid'}/transactions`,{headers:h});}catch{return <IllustrativePage/>;}if(m3RequestAllowed(request))return <FinancialWorkspace view="transactions"/>;}
 return <IllustrativePage/>;
}
