import { notFound } from 'next/navigation';
import { SyntheticFinancialDemo } from '@/components/ai-ingestion-v2-i1/synthetic-financial';
export const dynamic='force-dynamic';
export default function Page(){
 if(process.env.NODE_ENV!=='development'||process.env.VERCEL||process.env.FINGENCE_AI_LOCAL!=='1'||process.env.FINGENCE_V2_I1_LOCAL!=='1')notFound();
 return <SyntheticFinancialDemo/>;
}
