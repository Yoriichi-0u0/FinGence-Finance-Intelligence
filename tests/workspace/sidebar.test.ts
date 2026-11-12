import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { clampWidth, ResizeHandle, SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN } from '../../components/sidebar-layout';

/** The desktop sidebar can be collapsed to an icon rail or resized; the width always stays within readable limits. */
describe('sidebar layout', () => {
    it('keeps the width between 200 and 320 px', () => {
        expect([clampWidth(120), clampWidth(SIDEBAR_DEFAULT), clampWidth(277.6), clampWidth(900)]).toEqual([SIDEBAR_MIN, SIDEBAR_DEFAULT, 278, SIDEBAR_MAX]);
    });
    it('the resize handle is a keyboard-reachable separator that reports its value', () => {
        const html = renderToStaticMarkup(createElement(ResizeHandle, { width: 260, onWidth: () => undefined }));
        for (const attr of ['role="separator"', 'aria-orientation="vertical"', 'aria-valuemin="200"', 'aria-valuemax="320"', 'aria-valuenow="260"', 'tabindex="0"', 'aria-label="Resize the sidebar"']) expect(html).toContain(attr);
    });
});

describe('when the browser will not store the layout', () => {
    it('collapsing and resizing still work for this page', async () => {
        const { vi } = await import('vitest');
        const store: Record<string, string> = {};
        vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => true });
        vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: () => { throw new Error('QuotaExceededError'); } });
        vi.resetModules();
        const layout = await import('../../components/sidebar-layout');
        layout.__write({ width: 290, collapsed: true });
        expect(layout.__read()).toBe('290:1');
        vi.unstubAllGlobals();
    });
});
