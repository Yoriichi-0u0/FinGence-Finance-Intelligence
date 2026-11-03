import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {assertGroupSyntheticTarget,createGroupSyntheticAdmission,restrictedSyntheticBroker,GROUP_PROJECT} from '../../lib/server/reconciliation/group-synthetic';
import type {TransactionDatabase,SqlConnection} from '../../lib/server/db/postgres';
import {spawnSync} from 'node:child_process';
import {rootCertificates} from 'node:tls';
import {serverPoolConfig} from '../../lib/server/db/postgres';
const config={host:`db.${GROUP_PROJECT}.supabase.co`,port:5432,database:'postgres',user:'db04_group_test_runtime',ssl:{rejectUnauthorized:true,ca:rootCertificates[0]}};
it('binds synthetic runtime to exact group project/database/login and verified TLS',()=>{
    expect(()=>assertGroupSyntheticTarget(config,'runtime')).not.toThrow();
    for(const change of [{host:'db.fhipzomczevbpybezzxu.supabase.co'},{user:'postgres'},{user:'db04_catalog_inspector'},{database:'other'},{port:6543},{ssl:false},{ssl:{rejectUnauthorized:false}}])
        expect(()=>assertGroupSyntheticTarget({...config,...change},'runtime')).toThrow('APPROVED_GROUP_SYNTHETIC_TARGET_REQUIRED');
});
it.each(['runtime','broker'] as const)('accepts only the pinned Session pooler project and %s role',kind=>{
    const session={...config,host:'aws-0-ap-southeast-1.pooler.supabase.com',user:`db04_group_test_${kind}.${GROUP_PROJECT}`};
    expect(()=>assertGroupSyntheticTarget(session,kind)).not.toThrow();
    for(const change of [{host:'aws-1-ap-southeast-1.pooler.supabase.com'},{user:`db04_group_test_${kind}.wrongproject`},
        {user:'postgres.'+GROUP_PROJECT},{user:`db04_group_test_${kind}`},{port:6543},{port:5433},{database:'other'},
        {ssl:{rejectUnauthorized:true}},{ssl:{...config.ssl,ca:''}},{ssl:{...config.ssl,rejectUnauthorized:false}},
        {ssl:{...config.ssl,checkServerIdentity:()=>undefined}},{ssl:{...config.ssl,servername:'other.example'}}])
        expect(()=>assertGroupSyntheticTarget({...session,...change},kind)).toThrow('APPROVED_GROUP_SYNTHETIC_TARGET_REQUIRED');
});
it.each([undefined,'postgresql://user:secret@host/postgres?sslmode=disable',
    'postgresql://user:secret@host/postgres?sslmode=verify-full&options=unsafe',
    'postgresql://user:secret@host/postgres?sslmode=require&sslmode=verify-full'])('rejects missing URLs and unsupported parameters (%#)',value=>{
    expect(()=>serverPoolConfig({SUPABASE_DATABASE_URL:value})).toThrow();
});
it('cannot instantiate synthetic admission for normal deployed application execution',()=>{
    vi.stubEnv('NODE_ENV','production');
    try{expect(()=>createGroupSyntheticAdmission({} as TransactionDatabase)).toThrow('SYNTHETIC_DEMONSTRATION_ONLY');}finally{vi.unstubAllEnvs();}
});
it('rejects arbitrary broker queries without sending them to a database',async()=>{
    const query=vi.fn();const raw={close:vi.fn(),transaction:async(work:(tx:SqlConnection)=>Promise<unknown>)=>work({query})} as TransactionDatabase;
    await expect(restrictedSyntheticBroker(raw).transaction(tx=>tx.query('SELECT * FROM public.financial_records'))).rejects.toThrow('SYNTHETIC_BROKER_OPERATION_DENIED');
    expect(query).not.toHaveBeenCalled();
});
it('rejects the former caller-supplied expiry query before database dispatch',async()=>{
    const query=vi.fn();const raw={close:vi.fn(),transaction:async(work:(tx:SqlConnection)=>Promise<unknown>)=>work({query})} as TransactionDatabase;
    await expect(restrictedSyntheticBroker(raw).transaction(tx=>tx.query('SELECT * FROM fingence_db04_group_synthetic.issue_hosted_grant($1,$2,$3,$4,$5,$6)',[]))).rejects.toThrow('SYNTHETIC_BROKER_OPERATION_DENIED');
    expect(query).not.toHaveBeenCalled();
});
it('refuses hosted processing without private exact owner approval before loading credentials',()=>{
    const r=spawnSync(process.execPath,['--conditions=react-server','scripts/db04-group/hosted-synthetic.mjs'],{encoding:'utf8',windowsHide:true});
    expect(r.status).toBe(1);expect(JSON.parse(r.stderr)).toEqual({stage:'APPROVAL',category:'STOPPED_NO_AUTOMATIC_RETRY',financialOutcome:'PROCESSING_NOT_STARTED'});
    expect(r.stdout).toBe('');
});
