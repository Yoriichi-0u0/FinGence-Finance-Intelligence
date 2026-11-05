import { describe, expect, it } from 'vitest';
import { usesFinancialWorkspaceBackground } from '../../components/navigation/routes';
describe('financial canvas presentation boundary', () => {
 it.each(['/overview','/data','/transactions','/reconciliation','/analytics','/forecasting','/anomalies','/reports','/ask','/finance-questions'])('includes financial page %s', path => {
  expect(usesFinancialWorkspaceBackground(path)).toBe(true);
 });
 it.each(['/','/admin','/enroll','/login','/data/c1','/ai-ingestion','/ai-ingestion/live','/ask-other','/reports/private'])('excludes Welcome and special layout %s', path => {
  expect(usesFinancialWorkspaceBackground(path)).toBe(false);
 });
});
