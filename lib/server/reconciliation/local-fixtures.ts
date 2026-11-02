import 'server-only';
import { approvedPoCSourceHashes } from '../poc-reconciliation/service';
/** Exact bytes of committed synthetic fixtures; never caller-selected fingerprints. */
export function runtimeSyntheticRegistry(env:Readonly<Record<string,string|undefined>>=process.env) {
    if(env.FINGENCE_DB04_TEST_FIXTURES!=='1')return approvedPoCSourceHashes;
    if(env.NODE_ENV!=='development'||env.VERCEL||env.FINGENCE_DB04_LOCAL!=='1')throw Error('LOCAL_FIXTURES_ONLY');
    return Object.freeze({bank:'d496b00bcc826e6833770d373c8977fd4ff4163416e2c4e2e1c50938a9b9c2ec',ledger:'d71e68cb8aae56e87c86b9106fe8ff96f674d08f31111f79117640d1dbbf6be4'});
}
