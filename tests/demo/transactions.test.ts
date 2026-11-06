import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processDocuments } from '../../lib/demo/pipeline';
import { cashTotals } from '../../lib/poc-insights/model';
import { toCents } from '../../lib/poc-anomalies/source';
import { defaultFilters, dateFilterError, exploreRecords, recordMatches, signedDisplay, transactionPage, transactionRecords } from '../../components/demo/transaction-explorer';
import Transactions from '../../components/demo/transactions';

const c = await processDocuments(['demo-bank-statement-2026-03.csv','demo-general-ledger-2026-03.csv'].map(name => ({ name, bytes:new Uint8Array(readFileSync('public/demo/'+name)), provenance:'PUBLIC_SYNTHETIC_SAMPLE' as const })));
const bank = transactionRecords(c,'bank'), ledger=transactionRecords(c,'ledger');
describe('read-only transaction exploration',()=>{
 it('preserves every source record, amount, description and evidence without mixing roles',()=>{
  const before=JSON.stringify(c);
  expect(bank).toHaveLength(c.outputs.bankRows.length);expect(ledger).toHaveLength(c.outputs.ledger!.rows.length);
  for(const r of bank){const raw=c.outputs.bankRows.find(x=>x.rowId===r.id)!;expect(r.signedAmount).toBe(raw.signedAmount);expect(r.description).toBe(raw.description);expect(r.source).toBe('bank');expect(r.fingerprint).toBe(c.outputs.bank!.sha256);expect(r.sourceRow).not.toBeNull();}
  for(const r of ledger){const raw=c.outputs.ledger!.rows.find(x=>x.recordId===r.id)!;expect(toCents(r.signedAmount)).toBe(BigInt(raw.signedCents));expect(r.description).toBe(raw.description);expect(r.counterparty).toBeNull();expect(r.source).toBe('ledger');expect(r.evidenceIds).toEqual(raw.evidenceIds);}
  expect(bank.every(b=>ledger.every(l=>l.key!==b.key))).toBe(true);exploreRecords(bank,{...defaultFilters,sort:'highest'});expect(JSON.stringify(c)).toBe(before);
 });
 it('searches references, full descriptions and counterparties case insensitively within the selected source',()=>{
  for(const rows of [bank,ledger])for(const field of ['id','description','reference'] as const){const value=rows[0][field];expect(exploreRecords(rows,{...defaultFilters,search:value.toUpperCase()}).some(r=>r.key===rows[0].key)).toBe(true);}
  expect(exploreRecords(bank,{...defaultFilters,search:bank[0].counterparty!.toUpperCase()}).some(r=>r.key===bank[0].key)).toBe(true);
  expect(exploreRecords(bank,{...defaultFilters,search:'no-such-record-unique'})).toEqual([]);
 });
 it('keeps actual direction, including zero bank debit convention, and signed amount sorting',()=>{
  for(const rows of [bank,ledger]){expect(exploreRecords(rows,{...defaultFilters,direction:'Debit'}).every(r=>r.direction==='Debit')).toBe(true);for(const sort of ['highest','lowest'] as const){const values=exploreRecords(rows,{...defaultFilters,sort}).map(r=>toCents(r.signedAmount));expect(values.every((v,i)=>i===0||(sort==='highest'?values[i-1]>=v:values[i-1]<=v))).toBe(true);}}
  expect(recordMatches({...bank[0],direction:'Debit',signedAmount:'0.00'},{...defaultFilters,direction:'Debit'})).toBe(true);
  expect(signedDisplay('12.01')).toBe('+12.01');expect(signedDisplay('-12.01')).toBe('-12.01');
 });
 it('uses inclusive dates, rejects invalid ranges, sorts deterministically and leaves input order unchanged',()=>{
  const date=bank[0].date, original=bank.map(r=>r.key);expect(exploreRecords(bank,{...defaultFilters,from:date,to:date}).every(r=>r.date===date)).toBe(true);
  expect(dateFilterError({...defaultFilters,from:'2026-03-20',to:'2026-03-01'})).toContain('Start date');expect(dateFilterError({...defaultFilters,from:'2026-02-30'})).not.toBeNull();
  expect(exploreRecords(bank,{...defaultFilters,from:'2026-03-20',to:'2026-03-01'})).toEqual([]);
  const oldest=exploreRecords(bank,{...defaultFilters,sort:'oldest'});expect(oldest.map(r=>r.date)).toEqual(oldest.map(r=>r.date).sort());expect(exploreRecords([...bank].reverse(),defaultFilters)).toEqual(exploreRecords(bank,defaultFilters));expect(bank.map(r=>r.key)).toEqual(original);
 });
 it('bounds twenty-row pagination after filtering',()=>{expect(transactionPage(20,0)).toEqual({page:0,pages:1});expect(transactionPage(2,21)).toEqual({page:1,pages:2});expect(transactionPage(-1,57)).toEqual({page:0,pages:3});});
 it('preserves bank summary definitions and scope',()=>{
  const totals=cashTotals(c.outputs.bankRows.filter(r=>recordMatches({...r,id:r.rowId},defaultFilters)));expect(totals).toEqual(c.outputs.totals);
  const html=renderToStaticMarkup(createElement(Transactions,{c}));expect(html).toContain('Bank source only');expect(html).toContain('28,232.01');expect(html).toContain('Bank Statement');expect(html).toContain('General Ledger');
  expect(html.match(/View Details<\/button>/g)).toHaveLength(20);expect(html).toContain('<dialog');expect(html).toContain('aria-labelledby="transaction-detail-title"');expect(html).toContain('Full processing ID');
 });
 it('handles missing source fields and empty datasets without fabricated rows',()=>{const empty={...c,outputs:{...c.outputs,bankRows:[],ledger:null}};expect(transactionRecords(empty,'bank')).toEqual([]);expect(transactionRecords(empty,'ledger')).toEqual([]);expect(renderToStaticMarkup(createElement(Transactions,{c:empty}))).toContain('No BANK records available');});
 it('scopes identities to the processing context so replacements cannot reuse stale details',()=>{const other={...c,processingId:'different-processing'};expect(transactionRecords(other,'bank').every(r=>!bank.some(b=>b.key===r.key))).toBe(true);});
});
