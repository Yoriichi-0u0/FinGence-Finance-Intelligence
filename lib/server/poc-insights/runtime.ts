import 'server-only';
import { pocLocalEnabled } from '../poc-reconciliation/runtime';
import { pocRuntime } from '../poc-anomalies/runtime';
import { createPocInsights } from './service';
export async function insightsRuntime() {
    if (!pocLocalEnabled()) throw Error('LOCAL_ONLY');
    const base = await pocRuntime();
    return { ...base, insights: createPocInsights(base.database) };
}
