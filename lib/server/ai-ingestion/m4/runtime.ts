import 'server-only';
import { m3LocalEnabled, m3Runtime } from '../../financial-m3/runtime';
import { createM4Pipeline, installM4Schema } from './adapter';
export function m4LocalEnabled() { return m3LocalEnabled() && process.env.FINGENCE_M4_LOCAL === '1'; }
const ready = new WeakMap<object, Promise<void>>();
export async function m4Runtime() {
    if (!m4LocalEnabled())
        throw Error('LOCAL_ONLY');
    const base = await m3Runtime();
    let initialized = ready.get(base.database);
    if (!initialized) {
        initialized = installM4Schema(base.database);
        ready.set(base.database, initialized);
    }
    await initialized;
    // HTTP never constructs the live factory, even if credentials/dispatch flags exist in the environment.
    return { ...base, pipeline: createM4Pipeline(base.database, { origin: 'RECORDED_TEST' }) };
}
