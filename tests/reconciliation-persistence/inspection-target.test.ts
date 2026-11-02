import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {assertInspectionTarget} from '../../lib/server/reconciliation/inspection-target';
const ref='a'.repeat(20),config={host:`db.${ref}.supabase.co`,port:5432,user:'catalog_inspector',database:'postgres',ssl:{rejectUnauthorized:true}};
const env={DB04_INSPECTION_ROLE:'catalog_inspector',DB04_INSPECTION_DATABASE:'postgres',DB04_INSPECTION_PROJECT_REF:ref,DB04_INSPECTION_PROJECT_NAME:'FYP A',DB04_HOSTED_INSPECTION_AUTHORIZATION:'FYP_A_READ_ONLY'};
it('requires exact operator-declared FYP A inspection target and role',()=>{expect(assertInspectionTarget(config,env)).toMatchObject({environment:'HOSTED_READ_ONLY',projectRef:ref});});
it.each([{...env,DB04_HOSTED_INSPECTION_AUTHORIZATION:''},{...env,DB04_INSPECTION_PROJECT_NAME:'other'},{...env,DB04_INSPECTION_PROJECT_REF:'b'.repeat(20)},{...env,DB04_INSPECTION_ROLE:'postgres'}])('blocks unapproved or mismatched hosted inspection before connection',settings=>{expect(()=>assertInspectionTarget(config,settings)).toThrow();});
it('blocks unverified TLS and pooler aliases',()=>{
 expect(()=>assertInspectionTarget({...config,ssl:{rejectUnauthorized:false}},env)).toThrow();
 expect(()=>assertInspectionTarget({...config,host:'pooler.supabase.com'},env)).toThrow();
});
