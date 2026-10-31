import 'server-only';
import { pocLocalEnabled } from '../poc-reconciliation/runtime';
import { pocRuntime } from '../poc-anomalies/runtime';
import { createPocForecast } from './service';
/** Rides on the combined local PoC stack (`pnpm poc:dev`) and its single database owner; never hosted. */
export async function forecastRuntime() {
    if (!pocLocalEnabled())
        throw new Error('LOCAL_ONLY');
    const base = await pocRuntime();
    return { forecast: createPocForecast(base.database) };
}
