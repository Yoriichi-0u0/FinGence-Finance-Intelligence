import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type { useDemoProcessing } from '../../components/demo/context';


const state=vi.hoisted(()=>({value:null as unknown as ReturnType<typeof useDemoProcessing>}));
vi.mock('../../components/demo/context',()=>({useDemoProcessing:()=>state.value}));
vi.mock('next/navigation',()=>({usePathname:()=>'/',useSearchParams:()=>new URLSearchParams(),useRouter:()=>({replace:vi.fn()})}));
const { OverviewWelcome }=await import('../../components/overview/welcome');
const render=()=>renderToStaticMarkup(createElement(OverviewWelcome));
beforeEach(()=>{state.value={enabled:true,status:'empty',context:null,liveStages:[],processedAt:null,persisted:true,error:null,process:vi.fn(),clear:vi.fn(),ai:null};});
describe('public welcome entry',()=>{
 it('links Sign Up to workspace without processing or account creation',()=>{
  const html=render(); expect(html).toContain('href="/sign-up"');expect(html).toContain('href="/sign-in"');expect(html).toContain('Sign Up');
  expect(html).not.toContain('Try Demo');expect(html).not.toContain('Coming Soon');expect(html).not.toContain('Financial summary');
  expect(state.value.process).not.toHaveBeenCalled();expect(state.value.clear).not.toHaveBeenCalled();
 });
 it('preserves branding, showcase and actual video without the removed notice',()=>{
  const html=render();for(const text of ['FinGence 2.0','/branding/FinGence_Logo_96.png','Understand Your Finances.','Reconcile with Confidence.','href="#demo-video"','/media/fingence-demo.mp4','preload="none"','How FinGence Works'])expect(html).toContain(text);
  expect(html).not.toContain('Public demo notice');expect(html).not.toContain('Public Demo');expect(html.match(/Illustrative interface preview/g)).toHaveLength(6);expect(html).not.toContain('Search navigation');
 });
 it('keeps the final CTA on the welcome page and targets its top',()=>{
  const html=render(),cta=html.match(/<section class="fg-final">([\s\S]*?)<\/section>/)?.[1];
  expect(html).toContain('id="welcome-top"');expect(cta).toContain('href="#welcome-top"');expect(cta).toContain('Try Now');expect(cta).not.toContain('href="/data"');expect(cta).not.toContain('href="/overview"');
 });
});
