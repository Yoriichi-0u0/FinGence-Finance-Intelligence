import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MlResult } from '../../components/demo/ml-forecast';
import { ML_HORIZONS, ML_LIMITATIONS, scoreMl, type MlHorizon } from '../../lib/poc-forecast/ml';
import { baseline, worker } from './ml-fixtures';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const render = (initialHorizon: MlHorizon) => {
    const b = baseline();
    return renderToStaticMarkup(createElement(MlResult, { result: scoreMl(b, worker()), forecast: b, initialHorizon }));
};

describe('ML challenger panel at each horizon', () => {
    it('offers 1, 4 and 6 months and marks the chosen one as pressed', () => {
        for (const h of ML_HORIZONS) {
            const html = render(h);
            expect(html).toContain('aria-label="Forecast horizon"');
            for (const x of ML_HORIZONS) {
                const label = `${x} month${x === 1 ? '' : 's'}`;
                expect(html).toMatch(new RegExp(`aria-pressed="${x === h}"[^>]*>${label}<`));
            }
        }
    });
    it('shows the one-month forecast without a month-by-month table or an indicative warning', () => {
        const t = text(render(1));
        expect(t).toContain('April 2026 cash in');
        expect(t).toContain('Backtest: forecasting 1 month ahead');
        expect(t).not.toContain('Month by month');
        expect(t).not.toContain('Indicative only');
    });
    it('shows four months as totals plus a month-by-month table, tested on three months', () => {
        const t = text(render(4));
        expect(t).toContain('Cash in, April 2026 to July 2026');
        expect(t).toContain('Month by month: XGBoost against the baseline, 4 months ahead');
        for (const m of ['April 2026', 'May 2026', 'June 2026', 'July 2026']) expect(t).toContain(m);
        expect(t).not.toContain('August 2026');
        expect(t).toContain('Backtest: forecasting 4 months ahead');
        expect(t).toContain('280,600.00');                       // the exact four-month total of the fixture's forecast cash in
        expect(t).toContain('3 months of backtest at this horizon');
        expect(t).not.toContain('Indicative only');
        expect(t).toContain('can zigzag or flatten');
    });
    it('shows six months, and warns that a single test month is indicative, not evidence', () => {
        const t = text(render(6));
        expect(t).toContain('Cash in, April 2026 to September 2026');
        expect(t).toContain('September 2026');
        expect(t).toContain('Indicative only');
        expect(t).toContain('only 1 month of this history');
        expect(t).toContain('1 month of backtest at this horizon');
    });
    it('draws a chart whose label says how far ahead it looks', () => {
        expect(render(4)).toContain('4 months ahead');
        expect(render(6)).toContain('6 months ahead');
    });
    it('quotes in its limitations the same test-month counts that the scoring produces', () => {
        const b = baseline();
        expect(scoreMl(b, worker()).horizons.map(h => h.tests)).toEqual([6, 3, 1]);
        const limits = ML_LIMITATIONS.join(' ');
        expect(limits).toContain('1, 4 and 6 months ahead are tested on only 6, 3 and 1 month');
        expect(limits).toContain('errors compound');
    });
});
