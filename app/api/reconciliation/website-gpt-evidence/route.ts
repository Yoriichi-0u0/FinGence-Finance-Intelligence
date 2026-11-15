import {readWebsiteJobSuggestions} from '@/lib/server/reconciliation/website-job-gpt';
import {websiteGPTStorage,websiteGPTStorageConfigured} from '@/lib/server/reconciliation/website-gpt-storage';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 return readWebsiteJobSuggestions(request,{store:websiteGPTStorageConfigured()?websiteGPTStorage:null});
}
