import {createGPTWebsiteHandler,gptWebsiteRuntime} from '@/lib/server/reconciliation/gpt-website';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(request:Request){return createGPTWebsiteHandler(gptWebsiteRuntime())(request);}
