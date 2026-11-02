import 'server-only';
import type {PoolConfig} from 'pg';
/** Future operator approval declaration. This task does not authorize or execute hosted inspection. */
export function assertInspectionTarget(config:PoolConfig,env:Readonly<Record<string,string|undefined>>) {
 const role=env.DB04_INSPECTION_ROLE,database=env.DB04_INSPECTION_DATABASE;
 if(!role||!database||config.user!==role||config.database!==database||['postgres','supabase_admin','service_role'].includes(role))throw Error('DEDICATED_INSPECTION_IDENTITY_REQUIRED');
 if(['localhost','127.0.0.1','::1'].includes(config.host??''))return {environment:'LOCAL' as const,database,role};
 const ref=env.DB04_INSPECTION_PROJECT_REF;
 if(env.DB04_HOSTED_INSPECTION_AUTHORIZATION!=='FYP_A_READ_ONLY'||env.DB04_INSPECTION_PROJECT_NAME!=='FYP A'||!ref||!/^[a-z0-9]{20}$/.test(ref)||config.host!==`db.${ref}.supabase.co`||config.port!==5432||typeof config.ssl!=='object'||config.ssl===null||config.ssl.rejectUnauthorized!==true)throw Error('EXPLICIT_FYP_A_READ_ONLY_APPROVAL_REQUIRED');
 return {environment:'HOSTED_READ_ONLY' as const,projectName:'FYP A',projectRef:ref,database,role};
}
