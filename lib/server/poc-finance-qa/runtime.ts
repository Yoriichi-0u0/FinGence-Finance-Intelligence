import 'server-only';
import { pocLocalEnabled } from '../poc-reconciliation/runtime';
import { pocRuntime } from '../poc-anomalies/runtime';
import { createPocFinanceQa } from './service';
export async function financeQaRuntime() {
    if (!pocLocalEnabled()) throw Error('LOCAL_ONLY');
    const base = await pocRuntime();
    return { ...base, questions: createPocFinanceQa(base.database) };
}
