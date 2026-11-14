import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeadlineBand, NeedsYou, RoutineLine, type NeedsItem } from '../../components/demo/signal';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('Signal ledger: three levels of loudness', () => {
    it('draws nothing when nothing needs a person', () => {
        expect(renderToStaticMarkup(createElement(NeedsYou, { items: [] }))).toBe('');
    });

    it('puts the most serious items first, each with its count, a verb and where to go', () => {
        const items: NeedsItem[] = [
            { level: 'caution', count: '2', title: 'reconciliation items not explained', detail: 'MYR 1,240.50 in total.', href: '/reconciliation', verb: 'Review' },
            { level: 'attention', count: '3', title: 'unusual bank records flagged', detail: 'Your books could not settle them.', href: '/anomalies', verb: 'Review' },
        ];
        const html = renderToStaticMarkup(createElement(NeedsYou, { items })), page = text(html);
        expect(page).toContain('Needs you · 2');
        expect(page.indexOf('3 unusual bank records flagged')).toBeLessThan(page.indexOf('2 reconciliation items not explained'));
        expect(html).toContain('href="/anomalies"');
        expect(html).toContain('bg-[var(--attention)]');
        expect(html).toContain('bg-[var(--caution)]');
    });

    it('shows each headline figure after its label, the reconciled share as a clamped bar, and the report link', () => {
        const html = renderToStaticMarkup(createElement(HeadlineBand, {
            figures: [{ label: 'Cash in', value: 'MYR 10.00' }],
            reconciled: { label: 'Reconciled automatically', percent: 140, detail: '1 of 1 records matched' },
            report: { href: '/reports?print=1', detail: 'The report is ready.' },
        }));
        expect(text(html)).toContain('Cash in MYR 10.00');
        expect(text(html)).toContain('Reconciled automatically 100%');
        expect(html).toContain('width:100%');
        expect(html).toContain('href="/reports?print=1"');
    });

    it('keeps routine information to one quiet line with a tick each', () => {
        const page = text(renderToStaticMarkup(createElement(RoutineLine, { label: 'All clear', items: ['28 of 28 checks passed', 'No documents set aside'] })));
        expect(page).toBe('28 of 28 checks passed No documents set aside');
    });
});
