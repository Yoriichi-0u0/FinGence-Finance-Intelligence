import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Waiting, patience } from '../../components/waiting';

/** Every page-level wait shares one pattern: a plain status line, honest reassurance over time, and a decorative outline. */
describe('Waiting', () => {
    it('says nothing extra at first, then that it is still loading, then what you can do', () => {
        expect([0, 3].map(patience)).toEqual([null, null]);
        expect(patience(4)).toBe('Still loading. The database can take a moment.');
        expect(patience(12)).toMatch(/longer than usual.*reload the page/);
        // Nothing claims to know how far along it is.
        for (const s of [4, 12, 30]) expect(patience(s)).not.toMatch(/\d|%|almost|nearly/i);
    });
    it('announces what is loading once, and keeps the mascot, dots and outline away from screen readers', () => {
        const html = renderToStaticMarkup(createElement(Waiting, { what: 'Loading your saved runs', shape: 'rows', count: 3 }));
        expect(html).toContain('aria-busy="true"');
        expect(html.match(/role="status"/g)).toHaveLength(1);
        expect(html).toMatch(/role="status" aria-live="polite"[^>]*>.*Loading your saved runs/);
        expect(html.match(/class="skeleton/g)?.length).toBeGreaterThanOrEqual(3);
        expect(html).toContain('<ul aria-hidden="true"');
        expect(html).toContain('class="wait-dots');
    });
    it('draws cards, a page or nothing, as asked', () => {
        const cards = renderToStaticMarkup(createElement(Waiting, { what: 'Loading your dashboard', shape: 'cards', count: 6 }));
        expect(cards.match(/rounded-3xl bg-\[var\(--surface\)\] p-5/g)).toHaveLength(6);
        expect(renderToStaticMarkup(createElement(Waiting, { what: 'Drawing the document', shape: 'page' }))).toContain('max-w-md');
        expect(renderToStaticMarkup(createElement(Waiting, { what: 'Checking your sign-in', shape: 'none' }))).not.toContain('skeleton');
    });
});
