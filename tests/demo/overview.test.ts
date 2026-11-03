import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { processDocuments } from '../../lib/demo/pipeline';
import { DemoModule, isReady } from '../../components/demo/modules';
import { OverviewDashboard, workspaceDescription } from '../../components/overview/dashboard';
import { CompactDemoNotice } from '../../components/demo/banner';
const doc = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(`public/demo/${name}`)), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' as const });
const pair = () => [doc('demo-bank-statement-2026-03.csv'), doc('demo-general-ledger-2026-03.csv')];
const history = () => doc('demo-bank-history-2025-04-to-2026-03.csv');
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
describe('source-backed Overview', () => {
 it('renders actual pipeline totals and keeps exception and anomaly counts separate', async () => {
  const c = await processDocuments([...pair(), history()]);
  expect(isReady(c)).toBe(true); if (!isReady(c)) throw Error('Not ready');
  const html = renderToStaticMarkup(createElement(DemoModule, { view: 'overview', context: c }));
  const page = text(html);
  expect(page).toContain('Welcome to FinGence 2.0'); expect(page).toContain('Your financial workspace at a glance.');
  expect(page).toContain('Rimba Demo Kitchen (Synthetic) · 2026-03 · MYR'); expect(page).not.toContain('John Doe');
  const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  expect(header).not.toContain('>OVERVIEW<');
  expect(header).toContain('Public Demo'); expect(header).toContain('No sign-in');
  expect(header).toContain('rule-based processing in your browser, not live AI');
  expect(header).toContain('do not use confidential or real financial documents');
  expect(header.indexOf('Public demo notice')).toBeLessThan(header.indexOf('ov-processing-menu'));
  expect(header).not.toContain('ov-workspace-description'); expect(header).not.toContain('Verified browser processing');
  expect(header).toContain('Processing Details'); expect(header).toContain('ov-processing-popover');
  expect(html).not.toContain('These outcomes were not automatically matched and require further inspection.');
  expect(html.indexOf('ov-right-stack')).toBeLessThan(html.indexOf('ov-reconciliation-summary'));
  expect(html.indexOf('ov-needs-attention')).toBeLessThan(html.indexOf('ov-review-queue'));
  expect(html).toContain('Exceptions require review');
  expect(page).toContain('RM 28,232.01'); expect(page).toContain('RM 30,924.93'); expect(page).toContain('RM -2,692.92');
  expect(page).toContain('9 exceptions need review'); expect(html).toContain('Review in Reconciliation');
  expect(page).toContain('50 / 59'); expect(page).toContain('Unresolved exceptions 9');
  expect(page).toContain('Anomaly candidates Separate rule findings · may overlap 6');
  expect(page).toContain('Exact matches 46'); expect(page).toContain('Date shift matches 4');
  expect(html).toContain('Cash Out'); expect(html).toContain('stroke-dasharray="6 6"');
  expect(html).toContain('View exact monthly values'); expect(html).toContain('2025-04');
  expect(html).toContain('/ask'); expect(html).not.toContain('/finance-questions');
  expect(html).toContain('aria-label="Search navigation"');
  expect(html).toContain('Source evidence'); expect(html).not.toContain('<details open');
  expect(html).toContain(c.processingId);
  for (const document of c.documents.filter(d => d.decision === 'AUTO_ACCEPTED')) expect(html).toContain(document.sha256);
  expect(page).not.toContain('248,420'); expect(page).not.toContain('Revenue vs Expenses');
 });
 it('withholds monthly trends for a statement-only processing', async () => {
  const c = await processDocuments(pair()); if (!isReady(c)) throw Error('Not ready');
  const html = renderToStaticMarkup(createElement(DemoModule, { view: 'overview', context: c }));
  expect(text(html)).toContain('Monthly history unavailable'); expect(html).not.toContain('Verified monthly Cash In vs Cash Out');
 });
 it('never replaces unavailable local reconciliation with zero counts or demo figures', () => {
  const html = renderToStaticMarkup(createElement(OverviewDashboard, { local: true, description: 'Selected local source', currency: 'MYR', bank: '100.00', reconciliation: null, months: [], anomalies: 2, selection: 'source=abc' }));
  expect(text(html)).toContain('Reconciliation unavailable'); expect(text(html)).toContain('Ledger cash movement Unavailable');
  expect(html).toContain('/finance-questions?source=abc'); expect(html).not.toContain('50 / 59');
  expect(html).not.toContain('Public Demo'); expect(html).not.toContain('Public demo notice');
 });
 it('shows a no-pending-review state for an outcome set with no unresolved exceptions', async () => {
  const c = await processDocuments(pair()); if (!isReady(c)) throw Error('Not ready');
  const reconciliation = { ...c.outputs.reconciliation, results: c.outputs.reconciliation.results.filter(x => x.status === 'MATCH_EXACT' || x.status === 'MATCH_DATE_SHIFT'), counts: { ...c.outputs.reconciliation.counts, BANK_ONLY: 0, LEDGER_ONLY: 0, AMOUNT_MISMATCH_REVIEW: 0, AMBIGUOUS_DUPLICATE_LEDGER: 0, REFERENCE_MISMATCH_REVIEW: 0 } };
  const html = renderToStaticMarkup(createElement(OverviewDashboard, { currency: 'MYR', description: 'UI complete-state fixture', bank: c.outputs.totals.net, reconciliation, months: [], anomalies: 0 }));
  expect(text(html)).toContain('No pending exception review'); expect(text(html)).toContain('50 / 50'); expect(html).not.toContain('Review in Reconciliation');
  expect(html).toContain('No unresolved exceptions');
 });

 it('withholds reconciliation metrics when a category count is missing', async () => {
  const c = await processDocuments(pair()); if (!isReady(c)) throw Error('Not ready');
  const reconciliation = { ...c.outputs.reconciliation, counts: { ...c.outputs.reconciliation.counts, MATCH_EXACT: undefined } };
  const html = renderToStaticMarkup(createElement(OverviewDashboard, { currency: 'MYR', description: 'Partial UI fixture', bank: c.outputs.totals.net, reconciliation, months: [], anomalies: 0 }));
  expect(text(html)).toContain('Reconciliation unavailable'); expect(text(html)).toContain('Automatically matched Unavailable');
  expect(html).not.toContain('9 exceptions need review');
 });

 it('formats the reporting month while preserving the business name as a business', () => {
  expect(workspaceDescription('Rimba Demo Kitchen (Synthetic)', '2026-03')).toBe('Rimba Demo Kitchen (Synthetic) · March 2026');
  expect(workspaceDescription('Business', 'unavailable')).toBe('Business · unavailable');
 });

 it('keeps the compact public safety notice visible before any documents are processed', () => {
  const html = renderToStaticMarkup(createElement(CompactDemoNotice, { context: null }));
  expect(html).toContain('Public Demo'); expect(html).toContain('No sign-in');
  expect(html).toContain('rule-based processing in your browser, not live AI');
  expect(html).toContain('do not use confidential or real financial documents');
  expect(html).not.toContain('<details'); expect(html).not.toContain('title=');
 });

});
