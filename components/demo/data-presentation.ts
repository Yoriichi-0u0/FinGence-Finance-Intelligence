import type { DemoStatus } from './context';
import { STAGE_TITLES, type ProcessingContext, type Stage } from '@/lib/demo/pipeline';
type Tone = 'neutral'|'info'|'success'|'warning'|'danger';
export type DataBadge = {label:string;tone:Tone};
/** Display state only. No processing, validation, elapsed-time estimates or inferred success. */
export function dataStatus(status:DemoStatus,context:ProcessingContext|null,selected:number,loadingSample=false):DataBadge {
 if(loadingSample)return{label:'Loading sample documents',tone:'info'};
 if(status==='loading')return{label:'Restoring session',tone:'info'};
 if(status==='processing')return{label:'Processing',tone:'info'};
 if(status==='failed')return{label:'Failed',tone:'danger'};
 if(status==='ready'&&context)return context.status==='COMPLETED'?{label:'Completed',tone:'success'}:{label:'Completed with issues',tone:'warning'};
 return selected?{label:'Ready to process',tone:'info'}:{label:'No documents selected',tone:'neutral'};
}
export function stagePresentation(stage:Stage|undefined,ended=false):DataBadge {
 if(!stage)return{label:ended?'Not run':'Waiting',tone:'neutral'};
 if(stage.decision==='QUARANTINED')return{label:'Needs review · Quarantined',tone:'warning'};
 if(stage.decision==='UNAVAILABLE')return{label:'Unavailable',tone:'neutral'};
 if(stage.id==='VERIFY'&&stage.checks.length>0&&stage.checks.every(c=>c.passed))return{label:'Verified',tone:'success'};
 return{label:'Auto-accepted',tone:'success'};
}
export function reportedProgress(stages:Stage[]) {
 const known=Object.keys(STAGE_TITLES),reported=new Set(stages.filter(s=>known.includes(s.id)).map(s=>s.id)).size;
 return{reported,total:known.length};
}
