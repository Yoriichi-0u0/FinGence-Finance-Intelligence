import 'server-only';
import { m4Runtime } from '../ai-ingestion/m4/runtime';
import { m5LocalEnabled } from './flags';
import { installM5Schema } from './schema';
import { createTenantAdministration } from './service';
const initialized = new WeakMap<object, Promise<void>>();
export async function m5Runtime() {
    if (!m5LocalEnabled())
        throw new Error('LOCAL_ONLY');
    const base = await m4Runtime();
    let ready = initialized.get(base.database);
    if (!ready) {
        ready = installM5Schema(base.database);
        initialized.set(base.database, ready);
    }
    await ready;
    return { ...base, administration: createTenantAdministration(base.database) };
}
