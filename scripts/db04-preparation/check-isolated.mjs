import {readFileSync} from 'node:fs';
import {RecoveryLab} from './recovery-lab.mjs';
const lab=new RecoveryLab();let success=false;
try{
 const cluster=await lab.createCluster('isolated'),p=await lab.pool(cluster);
 await p.query('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role');
 await p.query(readFileSync('supabase/sql/db04-development/install-review.sql','utf8'));
 await p.query(readFileSync('supabase/sql/db04-development/synthetic-seed-review.sql','utf8'));
 if((await p.query('SELECT count(*)::int n FROM fingence_db04_dev_identity.users')).rows[0].n!==2)throw Error('Synthetic seed incomplete');
 const n=(await p.query("SELECT count(*)::int n FROM pg_class WHERE relnamespace='fingence_reconciliation'::regnamespace AND relkind='r' AND relrowsecurity AND relforcerowsecurity")).rows[0].n;
 if(n!==11)throw Error('Expected eleven forced-RLS tables');
 const old=(await p.query("SELECT count(*)::int n FROM pg_namespace WHERE nspname IN ('fingence_m2','fingence_m3')")).rows[0].n;
 if(old!==0)throw Error('Production identity namespaces must remain absent');
 success=true;console.log(JSON.stringify({localSyntheticOnly:true,forcedRlsTables:n,productionIdentityNamespaces:old,hostedChanges:false}));
}finally{await lab.cleanup(success);}
