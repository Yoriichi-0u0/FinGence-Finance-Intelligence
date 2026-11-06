import { describe,expect,it } from 'vitest';
import { Bot } from 'lucide-react';
import { visibleNavigation } from '../../components/navigation/routes';
import { readFileSync } from 'node:fs';
describe('small icon and document scrollbar refinement',()=>{
 it('uses Bot for public and authorized local Q&A without changing routes or permissions',()=>{
  const publicItem=visibleNavigation({syntheticDemo:true}).find(x=>x.href==='/ask');expect(publicItem?.label).toBe('Finance Q&A');expect(publicItem?.icon).toBe(Bot);
  const localItem=visibleNavigation({localReconciliation:true,role:'Finance'}).find(x=>x.href==='/finance-questions');expect(localItem?.label).toBe('Finance Questions');expect(localItem?.icon).toBe(Bot);
  expect(visibleNavigation({localReconciliation:true,role:'Admin'}).some(x=>x.href==='/finance-questions')).toBe(false);
 });
 it('fixes only inherited SVG margin while preserving the circle and video lifecycle',()=>{
  const css=readFileSync('app/globals.css','utf8');expect(css).toMatch(/\.fg-video \.fg-video-play > svg\s*\{\s*margin:0;/);
  expect(css).toContain('width:82px; height:82px;');expect(css).toContain('transform:translateX(2px)');
 });
 it('scopes scrollbar hiding to the document and preserves an accessibility fallback',()=>{
  const css=readFileSync('app/globals.css','utf8');expect(css).toContain('html:has(.app-layout) { scrollbar-width:none;');expect(css).toContain('@media(forced-colors:active)');
  expect(css).not.toMatch(/html:has\(\.app-layout\)\s*\{[^}]*overflow:\s*hidden/);expect(css).toContain('.nav-search [role="listbox"] { max-height: 340px; overflow-y: auto;');
 });
});
