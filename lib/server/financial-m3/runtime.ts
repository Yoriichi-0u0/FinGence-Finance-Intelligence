import 'server-only';
import { m2Runtime, m2LocalEnabled } from '../ai-ingestion/m2/runtime';
import { localAccessAllowed } from '../ai-ingestion/service';
import { installM3Schema, createManagementService } from './management';
import { createFinancialConsumers } from './consumers';
export function m3LocalEnabled() { return m2LocalEnabled() && process.env.FINGENCE_M3_LOCAL === '1'; }
export function m3RequestAllowed(request: Request) { return m3LocalEnabled() && localAccessAllowed(request); }
const initialized = new WeakMap<object, Promise<void>>();
export async function m3Runtime() {
    if (!m3LocalEnabled())
        throw new Error('LOCAL_ONLY');
    const base = await m2Runtime();
    let ready = initialized.get(base.database);
    if (!ready) {
        ready = installM3Schema(base.database);
        initialized.set(base.database, ready);
    }
    await ready;
    return { ...base, consumers: createFinancialConsumers(base.database), management: createManagementService(base.database) };
}
