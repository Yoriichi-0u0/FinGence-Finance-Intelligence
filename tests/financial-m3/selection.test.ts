import { describe, it, expect } from 'vitest';
import { plotRatios, readSelection, saveSelection, validSelection, QuestionRequestFence } from '../../lib/financial-m3/selection';
const p = { userId: 'u', organizationId: 'o', role: 'Finance' as const, membershipVersion: 1 }, selection = { attemptId: '11111111-1111-4111-8111-111111111111', warningPolicy: 'exclude' as const };
describe('shared selected dataset hints and exact chart scale', () => {
    it('never converts money to floating point for pixel normalization', () => { expect(plotRatios(['9007199254740993.01', '-9007199254740993', '0.01'])).toEqual([1, -0.99999, 0]); expect(plotRatios(['0', '0.0'])).toEqual([0, 0]); expect(plotRatios(['0.1', '0.2'])).toEqual([0.5, 1]); expect(() => plotRatios(['NaN'])).toThrow(); });
    it('stores selection hints separately by server-resolved user and organization, never financial payloads', () => { const map = new Map<string, string>(), storage = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); } }; saveSelection(storage, p, selection); expect(readSelection(storage, p)).toEqual(selection); expect(readSelection(storage, { ...p, organizationId: 'another' })).toBeNull(); expect(readSelection(storage, { ...p, userId: 'another' })).toBeNull(); expect([...map.values()].join()).not.toContain('amount'); });
    it('rejects forged selection shapes and inaccessible storage without authorizing any record', () => { expect(validSelection({ attemptId: 'not-a-uuid', warningPolicy: 'include' })).toBe(false); expect(validSelection({ ...selection, warningPolicy: 'unknown' })).toBe(false); expect(readSelection({ getItem: () => { throw Error(); }, setItem: () => { }, removeItem: () => { } }, p)).toBeNull(); });
});


describe('question responses remain bound to the submitted question',()=>{
 it('keeps the newer record-count answer when the older source-total response arrives last',async()=>{
  const fence=new QuestionRequestFence();let shown='';let total!:(s:string)=>void,count!:(s:string)=>void;
  const first=fence.begin(),a=new Promise<string>(r=>total=r).then(value=>{if(fence.accepts(first))shown=value;});
  fence.invalidate();const second=fence.begin(),b=new Promise<string>(r=>count=r).then(value=>{if(fence.accepts(second))shown=value;});
  count('2 selected records');await b;total('105.5 MYR');await a;expect(shown).toBe('2 selected records');
 });
 it('editing a question without resubmitting invalidates a pending response',()=>{const fence=new QuestionRequestFence(),ticket=fence.begin();fence.invalidate();expect(fence.accepts(ticket)).toBe(false);});
 it('repeated explicit submissions of the same question still supersede earlier responses',()=>{const fence=new QuestionRequestFence(),a=fence.begin(),b=fence.begin();expect(fence.accepts(a)).toBe(false);expect(fence.accepts(b)).toBe(true);});
 it('access/selection invalidation also prevents late failures from clearing the newer result',()=>{const fence=new QuestionRequestFence(),old=fence.begin();fence.invalidate();const newer=fence.begin();let financialResult='newer authorized result';if(fence.accepts(old))financialResult='cleared by old failure';expect(financialResult).toBe('newer authorized result');expect(fence.accepts(newer)).toBe(true);});
});
