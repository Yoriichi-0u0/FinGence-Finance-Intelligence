import { describe,expect,it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThemeToggle,themeActionLabel } from '../../components/overview/theme';
import { OverviewHeader } from '../../components/overview/dashboard';
import { CompactDemoNotice } from '../../components/demo/banner';
import { visibleNavigation } from '../../components/navigation/routes';
import { readFileSync } from 'node:fs';
describe('final header and navigation presentation',()=>{
 it('renders an icon-only accessible theme action',()=>{const html=renderToStaticMarkup(createElement(ThemeToggle));expect(html).not.toContain('Appearance');expect(html).toContain('Switch to Dark Mode');expect(themeActionLabel('dark')).toBe('Switch to Light Mode');expect(themeActionLabel('light')).toBe('Switch to Dark Mode');});
 it('keeps the heading and guest controls without the removed notice',()=>{const html=renderToStaticMarkup(createElement(OverviewHeader,{notice:createElement(CompactDemoNotice,{context:null}),demoProfile:true}));expect(html).toContain('ov-heading-row');expect(html).not.toContain('Public demo notice');expect(html).not.toContain('Public Demo'); expect(html).toContain('Demo guest navigation');expect(html).toContain('Demo guest menu');});
 it('uses Dashboard labels while keeping routes and restrictions',()=>{const items=visibleNavigation({syntheticDemo:true});expect(items.find(x=>x.href==='/overview')?.label).toBe('Dashboard');expect(items.some(x=>x.label==='Overview'||x.label==='Back to Welcome')).toBe(false);});
 it('hides only the scroll-owner scrollbar and retains scrolling',()=>{const css=readFileSync('app/globals.css','utf8');expect(css).toMatch(/\.shell-navigation\s*\{[^}]*overflow-y:\s*auto/);expect(css).toMatch(/\.shell-navigation\s*\{[^}]*scrollbar-width:\s*none/);expect(css).toContain('.shell-navigation::-webkit-scrollbar');});
});
