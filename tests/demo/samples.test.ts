import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { CANONICAL_SAMPLES, UNFAMILIAR_SAMPLES, createSampleAction, loadSampleDocuments } from '../../lib/demo/samples';
import { processDocuments } from '../../lib/demo/pipeline';
import { readStored, restoreStored, toBase64, writeStored } from '../../lib/demo/session';

const assets = (path: string) => readFileSync(`public${path}`);
const request = vi.fn(async (url: string | URL | Request) => new Response(assets(String(url))));
const load = () => loadSampleDocuments(CANONICAL_SAMPLES, undefined, request as typeof fetch);

describe('shared verified sample loading', () => {
    it('loads only the canonical set, preserving original bytes, hashes and provenance', async () => {
        request.mockClear(); const phases: string[] = [];
        const files = await loadSampleDocuments(undefined, phase => phases.push(phase), request as typeof fetch);
        expect(files.map(f => f.name)).toEqual(CANONICAL_SAMPLES);
        expect(files.every(f => f.provenance === 'PUBLIC_SYNTHETIC_SAMPLE')).toBe(true);
        files.forEach(file => expect(Buffer.from(file.bytes)).toEqual(assets('/demo/'+file.name)));
        expect(phases).toEqual(['Loading sample documents','Verifying sample fingerprints']);
        expect(request.mock.calls.map(([url]) => url)).not.toContain('/demo/unfamiliar/manifest.json');
        const c = await processDocuments(files);
        expect(c.status).toBe('COMPLETED'); expect(c.outputs.resolution?.attention).toHaveLength(0); expect(c.outputs.resolution?.entries).toHaveLength(6); expect(c.outputs.history.months).toHaveLength(12);
        expect(c.outputs.totals?.net).toBe('28232.01'); expect(c.outputs.reconciliation?.counts.MATCH_EXACT).toBe(46);
    });
    it.each(['http','manifest-http','network','missing-hash','bad-hash','changed-bytes'] as const)('rejects %s without sending any inputs to processing', async mode => {
        const fake = vi.fn(async (input: string | URL | Request) => {
            const url=String(input), manifest=url.endsWith('manifest.json');
            if (mode==='network') throw Error('offline');
            if ((mode==='http' && !manifest) || (mode==='manifest-http' && manifest)) return new Response('Not found',{status:404});
            if (manifest && (mode==='missing-hash' || mode==='bad-hash')) {
                const data=JSON.parse(assets(url).toString());
                if(mode==='missing-hash') delete data.files[CANONICAL_SAMPLES[0]];
                else data.files[CANONICAL_SAMPLES[0]].sha256='0'.repeat(64);
                return Response.json(data);
            }
            return new Response(mode==='changed-bytes' && !manifest ? Buffer.concat([assets(url),Buffer.from('\n')]) : assets(url));
        });
        const process=vi.fn(), action=createSampleAction({allowed:()=>true,process,load:()=>loadSampleDocuments(undefined,undefined,fake as typeof fetch)});
        await expect(action()).rejects.toThrow(); expect(process).not.toHaveBeenCalled();
    });
    it('keeps unfamiliar layouts an explicit separate Data selection with both existing manifests', async () => {
        const calls: string[]=[];
        // Git stores the canonical LF assets; Windows may have CRLF unfamiliar worktree samples.
        const { execFileSync } = await import('node:child_process');
        const files=await loadSampleDocuments(UNFAMILIAR_SAMPLES,undefined,(async input=>{
            const url=String(input); calls.push(url);
            return new Response(execFileSync('git',['show','HEAD:public'+url]));
        }) as typeof fetch);
        expect(files.map(f=>f.name)).toEqual(['bank-statement-march-2026-export.csv','general-ledger-cash-march-2026.csv',CANONICAL_SAMPLES[2]]);
        expect(calls).toContain('/demo/unfamiliar/manifest.json'); expect(calls).toContain('/demo/manifest.json');
    });
});

describe('sample action coordination', () => {
    it('prevents overlapping loads and processes once despite duplicate clicks', async () => {
        const files=await load(); let release!: (value: typeof files) => void;
        const download=vi.fn(()=>new Promise<typeof files>(resolve=>{release=resolve;})), process=vi.fn(async()=>null), busy=vi.fn();
        const action=createSampleAction({allowed:()=>true,load:download,process,onBusy:busy});
        const first=action(), second=action(); expect(download).toHaveBeenCalledTimes(1);
        release(files); await Promise.all([first,second]); expect(process).toHaveBeenCalledExactlyOnceWith(files);
        expect(busy.mock.calls).toEqual([[true],[false]]);
    });
    it('does not start or replace an existing valid processing context', async () => {
        const process=vi.fn(), download=vi.fn();
        await createSampleAction({allowed:()=>false,load:download,process})();
        expect(download).not.toHaveBeenCalled(); expect(process).not.toHaveBeenCalled();
    });
    it('rechecks eligibility if another context is selected or the page unmounts during download', async () => {
        let allowed=true; const process=vi.fn();
        await createSampleAction({allowed:()=>allowed,process,load:async()=>{allowed=false; return load();}})();
        expect(process).not.toHaveBeenCalled();
    });
    it('releases its lock after failure so the same action can retry', async () => {
        const files=await load(), process=vi.fn(async()=>null), download=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(files);
        const action=createSampleAction({allowed:()=>true,process,load:download});
        await expect(action()).rejects.toThrow('offline'); await action();
        expect(download).toHaveBeenCalledTimes(2); expect(process).toHaveBeenCalledExactlyOnceWith(files);
    });
});

describe('existing browser session contract', () => {
    const memory = () => { const data=new Map<string,string>(); return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}}; };
    it('restores the same verified context by rerunning document verification, then clearing returns empty', async () => {
        const storage=memory(), files=await load(), initial=await processDocuments(files);
        const stored={processedAt:'2026-11-04T00:00:00Z',documents:files.map(f=>({name:f.name,provenance:f.provenance,base64:toBase64(f.bytes)})),interpretations:{}};
        expect(writeStored(stored,storage)).toBe(true); expect([...storage.data.keys()]).toEqual(['fingence-demo-documents-v1']);
        const restored=await restoreStored(readStored(storage)!);
        expect(restored.processingId).toBe(initial.processingId); expect(restored.outputs.totals).toEqual(initial.outputs.totals);
        expect(restored.documents.map(d=>d.sha256)).toEqual(initial.documents.map(d=>d.sha256));
        expect(writeStored(null,storage)).toBe(true); expect(readStored(storage)).toBeNull();
    });
    it('does not trust stored figures or turn corrupted document bytes into verified results', async () => {
        const files=await load(), storage=memory();
        writeStored({processedAt:'now',documents:[{name:files[0].name,provenance:files[0].provenance,base64:toBase64(new TextEncoder().encode('invalid document'))}]},storage);
        const restored=await restoreStored(readStored(storage)!);
        expect(restored.status).toBe('QUARANTINED'); expect(restored.outputs.totals).toBeNull();
    });
    it('handles unavailable or malformed storage without inventing a context', () => {
        expect(readStored({getItem:()=>'{broken'})).toBeNull();
        expect(readStored({getItem:()=>{throw Error('blocked');}})).toBeNull();
        expect(writeStored(null,{removeItem:()=>{throw Error('blocked');},setItem:()=>{}})).toBe(false);
    });
});
