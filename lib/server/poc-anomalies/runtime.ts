import 'server-only';
import { m5LocalEnabled } from '../tenant-admin-m5/flags';
import { m5Runtime } from '../tenant-admin-m5/runtime';
import { installPocAnomalySchema } from './schema';
import { createPocAnomalies } from './service';
const initialized = new WeakMap<object, Promise<void>>();
/** The PoC anomaly review rides on the local M5 stack; it has no flag of its own and never runs hosted. */
export async function pocRuntime() {
    if (!m5LocalEnabled())
        throw new Error('LOCAL_ONLY');
    const base = await m5Runtime();
    let ready = initialized.get(base.database);
    if (!ready) {
        ready = installPocAnomalySchema(base.database);
        initialized.set(base.database, ready);
    }
    await ready;
    // No reconciliation reader is wired until Codex's FinancePoCReconciliationV1 producer lands (issue #30).
    return { ...base, anomalies: createPocAnomalies(base.database) };
}
