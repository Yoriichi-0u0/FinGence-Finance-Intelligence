import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ProposalEvidence from '../../components/db04/proposal-evidence';
it('distinguishes fuzzy/E5 rankings, financial eligibility and unresolved conflict evidence',()=>{
 const html=renderToStaticMarkup(createElement(ProposalEvidence,{context:{version:'db04-processing-read/1',processingId:'synthetic',job:{},sources:[],transactions:[],proposals:[],cases:[],rankings:[{version:'db04-fuzzy-proposals/1',evidence:[{bankRecordId:'B',ledgerRecordId:'L'}]}],proposalVerifications:[{policy_version:'db04-independent-proposals/1',snapshot_sha256:'snapshot',evidence:[{bankRecordId:'B',ledgerRecordId:'L',financialEligible:true,outcome:'UNRESOLVED',reasons:['CONFLICT_competingBank']}]}]}}));
 expect(html).toContain('Fuzzy ranking proposals');expect(html).toContain('E5 ranking proposals');expect(html).toContain('passed (not approved)');expect(html).toContain('UNRESOLVED');expect(html).toContain('CONFLICT_competingBank');
});
