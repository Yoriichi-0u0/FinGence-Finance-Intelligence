import 'server-only';
import { rpc, type Store } from './store';

/** Missing/unrecognized database contract fails closed; organization membership is not ownership. */
export async function ownsFinancialResource(tokenHash:string,kind:'JOB'|'SAVED_RUN',id:string,store:Store|null,transport:typeof fetch=fetch):Promise<'OWNED'|'DENIED'|'UNAVAILABLE'>{
 const result=await rpc<{version?:string;owned?:boolean}>('fingence_workspace_owns_resource',{
  p_token_hash:tokenHash,p_kind:kind,p_id:id,
 },store,transport);
 if(!result.ok||result.value?.version!=='owner-only/1'||typeof result.value.owned!=='boolean')return 'UNAVAILABLE';
 return result.value.owned?'OWNED':'DENIED';
}
