import 'server-only';
import { m5Runtime } from '../tenant-admin-m5/runtime';
import { m5LocalEnabled } from '../tenant-admin-m5/flags';
import { localAccessAllowed } from '../ai-ingestion/service';
import { installReconciliationSchema, createReconciliationService } from './service';
export const pocLocalEnabled = () => m5LocalEnabled() && process.env.FINGENCE_POC_LOCAL === '1';
export const pocRequestAllowed = (request: Request) => pocLocalEnabled() && localAccessAllowed(request);
const ready = new WeakMap<object, Promise<void>>();
export async function reconciliationRuntime() {
    if (!pocLocalEnabled()) throw Error('LOCAL_ONLY');
    const base = await m5Runtime(); let installed = ready.get(base.database);
    if (!installed) { installed = installReconciliationSchema(base.database); ready.set(base.database, installed); }
    await installed; return { ...base, reconciliation: createReconciliationService(base.database) };
}
