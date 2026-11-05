import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { processDocuments } from '../../lib/demo/pipeline';
import { reconciliationStatuses } from '../../lib/poc-reconciliation/contracts';
import { evidenceRecords, isMatched, outcomeHeading, outcomeKey, outcomeTypes, reconciliationContextKey, reconciliationPage, selectedOutcome, selectOutcomes } from '../../components/demo/reconciliation-presentation';
import Reconciliation, { EvidenceSide } from '../../components/demo/reconciliation';
import { DemoBanner, CompactDemoNotice } from '../../components/demo/banner';

const c=await processDocuments(['demo-bank-statement-2026-03.csv','demo-general-ledger-2026-03.csv'].map(name=>({name,bytes:new Uint8Array(readFileSync('public/demo/'+name)),provenance:'PUBLIC_SYNTHETIC_SAMPLE' as const})));
const r=c.outputs.reconciliation!;
describe('Reconciliation presentation preserves verified outcomes',()=>{
 it('retains exact, date-shift and exception outcome counts without changing financial metrics',()=>{
  expect(r.counts.MATCH_EXACT).toBe(46);expect(r.counts.MATCH_DATE_SHIFT).toBe(4);expect(selectOutcomes(r,'EXCEPTIONS','ALL')).toHaveLength(9);expect(selectOutcomes(r,'ALL','ALL')).toHaveLength(59);
  const before=JSON.stringify(c);for(const view of ['EXCEPTIONS','ALL'] as const)for(const f of ['ALL',...reconciliationStatuses] as const) selectOutcomes(r,view,f);
  expect(JSON.stringify(c)).toBe(before);expect(r.cashMovement).toEqual({bank:'28232.01',ledger:'30924.93',signedDifference:'-2692.92'});
 });
 it('filters each outcome type within its result view and excludes matches from exceptions',()=>{
  expect(outcomeTypes('EXCEPTIONS')).toHaveLength(5);expect(outcomeTypes('ALL')).toHaveLength(7);
  for(const status of reconciliationStatuses){const all=selectOutcomes(r,'ALL',status);expect(all).toEqual(r.results.filter(x=>x.status===status));expect(all).toHaveLength(r.counts[status]);expect(selectOutcomes(r,'EXCEPTIONS',status)).toEqual(isMatched(status)?[]:all);}
  expect(selectOutcomes(r,'EXCEPTIONS','ALL').every(x=>!isMatched(x.status))).toBe(true);
 });
 it('uses clear headings and bounded twenty-row pagination with filtered counts',()=>{
  expect(outcomeHeading('EXCEPTIONS','ALL',9)).toBe('All Quarantined Exceptions (9)');expect(outcomeHeading('ALL','ALL',59)).toBe('All Reconciliation Outcomes (59)');expect(outcomeHeading('EXCEPTIONS','BANK_ONLY',2)).toBe('Bank only exceptions (2)');
  expect(reconciliationPage(2,59)).toEqual({page:2,pages:3});expect(reconciliationPage(2,1)).toEqual({page:0,pages:1});expect(reconciliationPage(8,0)).toEqual({page:0,pages:1});
 });
 it('selects exact outcomes using context and source-scoped contents rather than visible row position',()=>{
  const chosen=r.results.find(x=>x.status==='LEDGER_ONLY')!,key=outcomeKey(c,chosen);
  expect(selectedOutcome(c,key)).toBe(chosen);expect(selectedOutcome({...c,outputs:{...c.outputs,reconciliation:{...r,results:[...r.results].reverse()}}},key)).toBe(chosen);
  expect(selectedOutcome({...c,processingId:'other-context'},key)).toBeNull();expect(selectedOutcome({...c,outputs:{...c.outputs,reconciliation:null}},key)).toBeNull();
  const otherPair={...c,outputs:{...c.outputs,reconciliation:{...r,sources:{...r.sources,bank:{...r.sources.bank,sourceId:'another-bank'}}}}};expect(reconciliationContextKey(otherPair)).not.toBe(reconciliationContextKey(c));expect(selectedOutcome(otherPair,key)).toBeNull();
  expect(new Set(r.results.map(x=>outcomeKey(c,x))).size).toBe(r.results.length);
 });
 it('retains all evidence fields and literal values, source row and identity',()=>{
  for(const result of r.results)for(const side of ['bank','ledger'] as const){const groups=evidenceRecords(r,result,side),ids=side==='bank'?result.bankEvidenceIds:result.ledgerEvidenceIds;
   expect(groups.unavailable).toEqual([]);expect(groups.records.flatMap(g=>g.fields.map(f=>f.id))).toEqual(ids);
   for(const group of groups.records)for(const field of group.fields){expect(field.literal).toBe(r.evidence[field.id].literal);expect(group.sourceId).toBe(r.evidence[field.id].sourceId);expect(group.row).toBe(r.evidence[field.id].row);}
  }
 });
 it('shows accurate missing sides and every ambiguous candidate',()=>{
  for(const [status,side] of [['LEDGER_ONLY','bank'],['BANK_ONLY','ledger']] as const){const outcome=r.results.find(x=>x.status===status)!;expect(evidenceRecords(r,outcome,side).empty).toBe(true);const html=renderToStaticMarkup(createElement(EvidenceSide,{c,outcome,side}));expect(html).toContain(`No ${side} record on this side.`);expect(html).not.toContain('0.00');}
  const ambiguous=r.results.find(x=>x.status==='AMBIGUOUS_DUPLICATE_LEDGER')!;const groups=evidenceRecords(r,ambiguous,'ledger');expect(groups.records.map(g=>g.recordId).sort()).toEqual([...ambiguous.ledgerRecordIds].sort());expect(groups.records.length).toBeGreaterThan(1);
 });
 it('reports unavailable evidence honestly rather than replacing it with zero',()=>{
  const outcome={...r.results[0],bankEvidenceIds:['missing-source-field']};expect(evidenceRecords(r,outcome,'bank')).toEqual({records:[],unavailable:['missing-source-field'],empty:false});
  const html=renderToStaticMarkup(createElement(EvidenceSide,{c,outcome,side:'bank'}));expect(html).toContain('Evidence unavailable for missing-source-field');
 });
 it('renders distinct static statistics, result tabs, selected filter state and a read-only modal drawer',()=>{
  const html=renderToStaticMarkup(createElement(Reconciliation,{c}));expect(html).toContain('Review verified matches and unresolved exceptions.');expect(html).toContain('28,232.01');expect(html).toContain('-2,692.92');expect(html).toContain('Matching Overview');expect(html).toContain('Filter by Outcome');expect(html).toContain('aria-pressed="true"');expect(html).toContain('aria-controls="reconciliation-outcomes"');expect(html).toContain('All Quarantined Exceptions (9)');expect(html).toContain('<dialog');expect(html).toContain('aria-labelledby="source-evidence-title"');expect(html).toContain('authenticated local workflow only');expect(html).not.toMatch(/>Approve<|>Reject<|>Force Match<|>Clear Exception</);
  expect(html.match(/>Inspect<span/g)).toHaveLength(9);expect(html).not.toContain('Evidence is unavailable in the current processing context.</p></div></section>');
 });
 it('does not claim verification for quarantined or cleared processing',()=>{
  expect(renderToStaticMarkup(createElement(Reconciliation,{c:{...c,status:'QUARANTINED'}}))).toContain('Reconciliation unavailable');expect(renderToStaticMarkup(createElement(Reconciliation,{c:{...c,outputs:{...c.outputs,reconciliation:null}}}))).not.toContain('Processing verified');
 });
 it('keeps both retired global and compact notice strips absent',()=>{
  expect(renderToStaticMarkup(createElement(DemoBanner))).toBe('');const html=renderToStaticMarkup(createElement(CompactDemoNotice,{context:c}));expect(html).toBe('');
 });
});
