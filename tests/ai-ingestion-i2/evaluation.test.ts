import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
vi.mock('server-only', () => ({}));
import { extractSemanticEvidence } from '../../lib/ai-ingestion/increment-02/extract';
import { materializePlan, policyHash } from '../../lib/ai-ingestion/increment-03/plan';
import { verifySemanticBlueprint } from '../../lib/ai-ingestion/increment-02/verify';
import { scoreEvaluation, type GoldCase } from '../../lib/server/ai-ingestion/increment-i2/evaluation';

const bytes = Buffer.from('Transaction ID,Transaction Date,Amount,Currency,Reference\n000031,2026-10-29,9007199254740995.07,MYR,R-01\n');
const gold: GoldCase = { caseId:'i01', sourceSha256:createHash('sha256').update(bytes).digest('hex'), headers:['Transaction ID','Transaction Date','Amount','Currency','Reference'], roles:['transaction_id','transaction_date','amount','currency','reference'], rows:[['000031','2026-10-29','9007199254740995.07','MYR','R-01']], documentKind:'TRANSACTION_TABLE', conventions:{dateOrder:'ISO',numberFormat:'plain',dateBasis:'transaction_date',monetaryMode:'signed_amount'}, accepted:[{source_transaction_id:'000031',transaction_date:'2026-10-29',source_amount:'9007199254740995.07',currency:'MYR',reference:'R-01'}], prohibitedAcceptance:false, allowedAssumptions:[], context:null };
async function setup() {
 const evidence=await extractSemanticEvidence(bytes,'opaque.csv'); const ruleIds=['identity.transaction','date.transaction','money.amount','source.currency','identity.reference'];
 const proposal={version:'v2-plan-0.3',policyVersion:'experimental-financial-terminology-0.2',policyHash,documentKind:'TRANSACTION_TABLE',assumptions:[],conventions:gold.conventions,fields:evidence.tables[0].headerIds.map((id,n)=>({headerId:id,ruleId:ruleIds[n],reason:'recorded control'})),context:[]};
 const verification=verifySemanticBlueprint(evidence,materializePlan(evidence,proposal),'RECORDED_TEST'); return {evidence,proposal,verification};
}
describe('V2-I2 score boundary',()=>{
 it('scores exact source fields and accepted values without presenting controls as model accuracy',async()=>{const x=await setup();const r=scoreEvaluation(x.evidence,x.proposal,x.verification,gold,'RECORDED_TEST');expect(r.origin).toBe('RECORDED_TEST');expect(r.modelAccuracy).toBeNull();expect(r.extraction).toMatchObject({exactFields:5,expectedFields:5});expect(r.mappings).toMatchObject({correct:5,expected:5,proposed:5});expect(r.acceptance).toMatchObject({accepted:1,falseAccepted:0,exactAccepted:1});expect(r.provenance.invalidEvidenceReferences).toBe(0);});
 it('does not mark absence of a proposal as zero percent model accuracy',async()=>{const x=await setup();const r=scoreEvaluation(x.evidence,null,null,gold,'NOT_EXECUTED');expect(r.mappings).toBeNull();expect(r.modelAccuracy).toBeNull();expect(r.acceptance).toBeNull();});
 it('counts accepted records as unsafe for an explicitly prohibited case',async()=>{const x=await setup();const r=scoreEvaluation(x.evidence,x.proposal,x.verification,{...gold,prohibitedAcceptance:true,accepted:[]},'RECORDED_TEST');expect(r.acceptance?.falseAccepted).toBe(1);expect(r.acceptance?.prohibitedAccepted).toBe(1);});
 it('rejects labels bound to different source bytes',async()=>{const x=await setup();expect(()=>scoreEvaluation(x.evidence,x.proposal,x.verification,{...gold,sourceSha256:'0'.repeat(64)},'RECORDED_TEST')).toThrow('GOLD_SOURCE_MISMATCH');});
 it('flags unapproved assumptions without treating them as policy',async()=>{const x=await setup();const r=scoreEvaluation(x.evidence,{...x.proposal,assumptions:['bank debit means expense']},x.verification,gold,'RECORDED_TEST');expect(r.unsupportedAssumptions).toEqual(['bank debit means expense']);});
});
