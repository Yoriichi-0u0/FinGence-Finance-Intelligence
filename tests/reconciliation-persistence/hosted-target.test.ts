import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {assertHostedDevelopmentTarget} from '../../lib/server/reconciliation/hosted-target';
const target={projectRef:'a'.repeat(20),productionProjectRef:'b'.repeat(20),isolation:'ISOLATED_BRANCH' as const,approvalReference:'synthetic-test-only',database:'postgres',runtimeRole:'reconciliation_test'};
const config={host:`db.${target.projectRef}.supabase.co`,port:5432,database:'postgres',user:target.runtimeRole,ssl:{rejectUnauthorized:true}};
it('accepts explicitly approved direct development configuration without granting database access',()=>{
 expect(()=>assertHostedDevelopmentTarget(config,target)).not.toThrow();
});
it.each([
 {...config,host:`db.${target.productionProjectRef}.supabase.co`},
 {...config,user:'postgres'}, {...config,ssl:{rejectUnauthorized:false}},
 {...config,host:'aws.pooler.supabase.com'}, {...config,database:'other'},
])('rejects mismatched or unsafe target configuration',input=>{
 expect(()=>assertHostedDevelopmentTarget(input,target)).toThrow('APPROVED_ISOLATED_TARGET_REQUIRED');
});
it('rejects same-project production identity and missing approval',()=>{
 expect(()=>assertHostedDevelopmentTarget(config,{...target,productionProjectRef:target.projectRef})).toThrow();
 expect(()=>assertHostedDevelopmentTarget(config,{...target,approvalReference:''})).toThrow();
});
