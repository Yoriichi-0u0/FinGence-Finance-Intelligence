import {websiteGPTReview} from '@/lib/server/reconciliation/website-gpt-review';
import {websiteGPTStorage} from '@/lib/server/reconciliation/website-gpt-storage';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>websiteGPTReview(request,{store:websiteGPTStorage});
export const POST=(request:Request)=>websiteGPTReview(request,{store:websiteGPTStorage});
