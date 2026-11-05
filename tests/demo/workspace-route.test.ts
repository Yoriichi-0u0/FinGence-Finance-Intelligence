import { describe,expect,it,vi } from 'vitest';
const state=vi.hoisted(()=>({publicDemo:true}));
vi.mock('next/server',()=>({connection:vi.fn(async()=>{})}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND');}}));
vi.mock('../../lib/server/demo/mode',()=>({syntheticDemoEnabled:()=>state.publicDemo}));
vi.mock('../../components/demo/gate',()=>({DemoGate:()=>null}));
vi.mock('../../components/overview/theme',()=>({OverviewTheme:()=>null}));
const {default:Page}=await import('../../app/overview/page');
describe('public Overview route boundary',()=>{
 it('renders workspace only in the public browser demo',async()=>{state.publicDemo=true;expect(await Page()).toBeTruthy();});
 it('returns not found in authenticated runtime modes rather than exposing a second workspace',async()=>{state.publicDemo=false;await expect(Page()).rejects.toThrow('NOT_FOUND');});
});
