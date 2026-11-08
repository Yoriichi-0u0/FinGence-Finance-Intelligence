import 'server-only';
import { m5LocalEnabled } from '../tenant-admin-m5/flags';
import { m5Runtime } from '../tenant-admin-m5/runtime';
import { installPocAnomalySchema } from './schema';
import { createPocAnomalies } from './service';
import { installReconciliationSchema, readScopedReconciliation } from '../poc-reconciliation/service';
const initialized = new WeakMap<object, Promise<void>>();
/** The PoC anomaly review rides on the local M5 stack; it has no flag of its own and never runs hosted. */
export async function pocRuntime() {
    if (!m5LocalEnabled())
        throw new Error('LOCAL_ONLY');
    const base = await m5Runtime();
    let ready = initialized.get(base.database);
    if (!ready) {
        ready = (async () => {
            await installReconciliationSchema(base.database);
            await installPocAnomalySchema(base.database);
        })();
        initialized.set(base.database, ready);
    }
    await ready;
    return { ...base, anomalies: createPocAnomalies(base.database, { reconciliation: readScopedReconciliation }) };
}
