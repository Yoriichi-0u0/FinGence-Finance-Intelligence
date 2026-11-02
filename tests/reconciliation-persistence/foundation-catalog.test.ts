import {it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {assessFoundationCompatibility} from '../../lib/server/reconciliation/foundation-catalog';
const metadata=()=>({tables:[{name:'financial_records'}],columns:[{relation:'financial_records',name:'source_amount',type:'numeric(20,2)'}],constraints:[],triggers:[{name:'issue_00_warning_mutation_fence',enabled:'D'}],functions:[{name:'serialize_warning_issue_mutation'}],indexes:[],policies:[]});
it('distinguishes a present but disabled DB02 fence from active enforcement',()=>{
 const result=assessFoundationCompatibility(metadata());expect(result.warningFenceMarkers).toEqual({trigger:true,function:true});expect(result.warningFenceEnabled).toBe(false);
});
it('preserves numeric precision metadata without claiming restore or classification proof',()=>{
 const result=assessFoundationCompatibility(metadata());expect(result.numericDeclarations).toEqual([{name:'source_amount',type:'numeric(20,2)'}]);expect(result.c1ToDb04.supported).toBe(false);expect(result.db03Recovery).toContain('NOT_PROVEN_BY_CATALOGS');expect(result.hostedWritesAuthorized).toBe(false);
});
