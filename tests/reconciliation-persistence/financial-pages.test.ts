import {it,expect,vi,afterEach} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({headers:vi.fn(async()=>{throw Error('Unexpected protected header access');})}));
import Analytics from '../../app/analytics/page';
import Forecasting from '../../app/forecasting/page';
import Reports from '../../app/reports/page';
import {DemoGate} from '../../components/demo/gate';
afterEach(()=>vi.unstubAllEnvs());
it.each([Analytics,Forecasting,Reports])('preserves the existing Production demo even with the local DB04 flag set',async page=>{
 vi.stubEnv('NODE_ENV','production');vi.stubEnv('FINGENCE_DB04_LOCAL','1');
 expect((await page()).type).toBe(DemoGate);
});
