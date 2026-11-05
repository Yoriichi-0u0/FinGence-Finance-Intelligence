import { describe,expect,it } from 'vitest';

import { createElement } from 'react';

import { renderToStaticMarkup } from 'react-dom/server';

import { readFileSync } from 'node:fs';

import { createHash } from 'node:crypto';

import { DemoVideo } from '../../components/overview/demo-video';

import { DemoProfile } from '../../components/overview/demo-profile';

describe('portable demo video preview',()=>{

 it('starts with a real poster and explicit play control without autoplay or media preloading',()=>{

  const html=renderToStaticMarkup(createElement(DemoVideo));

  expect(html).toContain('poster="/media/fingence-demo-poster.png"');expect(html).toContain('src="/media/fingence-demo.mp4"');expect(html).toContain('preload="none"');expect(html).toContain('Play FinGence demonstration');for(const text of ['fg-video-caption','FinGence 2.0 Demo','· 1:59.8','Watch FinGence in Action','Financial Processing · Reconciliation · Insights','Recorded product demonstration · fictional sample data'])expect(html).toContain(text);expect(html).not.toContain('autoPlay');expect(html).not.toContain('controls=""');expect(html).not.toContain('C:');expect(html).not.toContain('file:');

 });

 it('preserves the exact source recording and includes the exact lossless opening-frame poster',()=>{

  expect(createHash('sha256').update(readFileSync('public/media/fingence-demo.mp4')).digest('hex')).toBe('b1de4392336db4fc6835e06f453e28b9f4cee26527603e313b1275deb447d9c7');

  const poster=readFileSync('public/media/fingence-demo-poster.png');expect(poster.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');expect(createHash('sha256').update(poster).digest('hex')).toBe('533d333b3e0ba91e65547fffb535cb6ae3c8996e75073450e133808430067d95');expect(poster.length).toBeLessThan(350000);

 });

 it('labels the profile as a disabled visual placeholder without account behavior',()=>{

  const html=renderToStaticMarkup(createElement(DemoProfile));expect(html).toContain('Demo guest menu');expect(html).toContain('href="/sign-in"');expect(html).toContain('Public demo');

 });

});
