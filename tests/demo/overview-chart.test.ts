import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { availablePeriods, defaultPeriod, monthlyWindow, type VerifiedMonth } from '../../components/overview/chart-model';
import { CashHistory } from '../../components/overview/history';
import { FinancialChart, ReconciliationStatusChart, reportingRange } from '../../components/overview/financial-chart';
const month = (period: string, net = '50.00'): VerifiedMonth => ({ period, rows: 2, creditRows: 1, debitRows: 1, credits: net === '50.00' ? '150.00' : '100.00', debits: net.startsWith('-') ? '-150.00' : '-100.00', net });
const year = Array.from({ length: 12 }, (_, index) => month(`2026-${String(index + 1).padStart(2, '0')}`));
describe('verified monthly chart presentation', () => {
    it('formats reporting dates from the selected verified window across years', () => {
        const history = Array.from({ length: 12 }, (_, i) => month(`${i < 9 ? 2025 : 2026}-${String((i + 3) % 12 + 1).padStart(2, '0')}`));
        expect(reportingRange(monthlyWindow(history, 3))).toBe('Jan 2026 to Mar 2026');
        expect(reportingRange(monthlyWindow(history, 6))).toBe('Oct 2025 to Mar 2026');
        expect(reportingRange(monthlyWindow(history, 12))).toBe('Apr 2025 to Mar 2026');
        expect(reportingRange([])).toBe('History unavailable');
        const html = renderToStaticMarkup(createElement(FinancialChart, { months: history, currency: 'MYR', counts: null }));
        expect(html).toContain('aria-label="Reporting period"'); expect(html).toContain('Apr 2025 to Mar 2026');
        const explanation = html.match(/class="ov-chart-explanation"[^>]*>(.*?)<\/p>/)?.[1];
        expect(explanation).toContain('not revenue or expenses'); expect(explanation).not.toContain('2025-04');
    });
    it.each([3, 6, 12] as const)('filters %s trailing calendar months in chronological order without changing the input', period => {
        const input = [...year].reverse(), before = JSON.stringify(input), result = monthlyWindow(input, period);
        expect(result).toEqual(year.slice(-period)); expect(JSON.stringify(input)).toBe(before);
    });
    it('chooses the largest supported default and disables unsupported periods', () => {
        expect(availablePeriods(year)).toEqual([3, 6, 12]); expect(defaultPeriod(year)).toBe(12);
        expect(availablePeriods(year.slice(0, 8))).toEqual([3, 6]); expect(defaultPeriod(year.slice(0, 5))).toBe(3);
        expect(defaultPeriod(year.slice(0, 2))).toBeNull(); expect(defaultPeriod([])).toBeNull();
    });
    it('does not substitute observations from before a gap or invent missing months', () => {
        const result = monthlyWindow([month('2026-01'), month('2026-03'), month('2026-04')], 3);
        expect(result.map(m => m.period)).toEqual(['2026-03', '2026-04']);
        expect(availablePeriods(result)).toEqual([]);
    });
    it('renders exact signed monthly net values and a zero reference for negative movement', () => {
        const months = [month('2026-01', '-50.00'), month('2026-02', '50.00')];
        const html = renderToStaticMarkup(createElement(CashHistory, { months, currency: 'MYR', mode: 'net' }));
        expect(html).toContain('2026-01: Net Cash Movement RM -50.00'); expect(html).toContain('Zero cash movement');
        expect(html).toContain('Verified monthly Net Cash Movement'); expect(html).not.toContain('stroke-dasharray="6 6"');
        expect(html).not.toContain('NaN');
    });
    it('keeps real zero-valued observations distinct from missing history', () => {
        const html = renderToStaticMarkup(createElement(CashHistory, { months: [month('2026-01', '0.00'), month('2026-02', '0.00')], currency: 'MYR', mode: 'net' }));
        expect(html).toContain('Net Cash Movement RM 0.00'); expect(html).not.toContain('NaN');
        const empty = renderToStaticMarkup(createElement(CashHistory, { months: [], currency: 'MYR' }));
        expect(empty).toContain('Monthly history unavailable'); expect(empty).not.toContain('<svg');
    });
    it('shows accessible view/period controls and honest insufficient-history guidance', () => {
        const html = renderToStaticMarkup(createElement(FinancialChart, { months: year.slice(0, 2), currency: 'MYR', counts: null }));
        expect(html).toContain('Chart View'); expect(html).toContain('Time Period'); expect(html).toContain('Net Cash Movement'); expect(html).toContain('Reconciliation Status');
        expect(html).toContain('Insufficient verified history'); expect(html).toContain('0 monthly observations displayed'); expect(html).not.toContain('NaN');
    });
    it('keeps coverage inspectable without a primary chart header badge', () => {
        const html = renderToStaticMarkup(createElement(FinancialChart, { months: year, currency: 'MYR', counts: null }));
        expect(html).not.toContain('class="ov-tag"'); expect(html).not.toContain('displayed ·');
        expect(html).toContain('Source coverage'); expect(html).toContain('12 monthly observations displayed from 12 verified observations');
        expect(html).toContain('2026-01 to 2026-12'); expect(html).toContain('aria-label="Time Period"');
    });
    it('displays category counts and total directly, with no currency or monthly trend', () => {
        const html = renderToStaticMarkup(createElement(ReconciliationStatusChart, { counts: { exact: 2, shifted: 1, unresolved: 3, total: 6 } }));
        expect(html).toContain('Exact matches: 2 outcomes'); expect(html).toContain('Date shift matches: 1 outcomes'); expect(html).toContain('Matcher exceptions: 3 outcomes');
        expect(html).toContain('6 total outcomes'); expect(html).not.toContain('RM'); expect(html).not.toContain('2026-');
    });
    it('does not replace unavailable reconciliation with zero counts', () => {
        const html = renderToStaticMarkup(createElement(ReconciliationStatusChart, { counts: null }));
        expect(html).toContain('Reconciliation unavailable'); expect(html).not.toContain('0 outcomes');
        const empty = renderToStaticMarkup(createElement(ReconciliationStatusChart, { counts: { exact: 0, shifted: 0, unresolved: 0, total: 0 } }));
        expect(empty).toContain('0 total outcomes'); expect(empty).not.toContain('Reconciliation unavailable'); expect(empty).not.toContain('NaN');
    });
});
