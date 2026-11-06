import { afterEach, describe, expect, it, vi } from 'vitest';
import { jobForm, submitServerJob } from '../../components/demo/server-jobs';

const doc = (name: string, size: number) => ({ name, provenance: 'USER_SUPPLIED' as const, bytes: new Uint8Array(size).fill(1) });
const never = () => undefined;

describe('server job submission from the browser', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('sends raw bytes in one multipart form: a manifest and one file part per document, in order', async () => {
        const form = jobForm([doc('a.pdf', 3), doc('b.jpg', 5)]);
        expect(JSON.parse(form.get('manifest') as string)).toEqual([{ name: 'a.pdf', provenance: 'USER_SUPPLIED' }, { name: 'b.jpg', provenance: 'USER_SUPPLIED' }]);
        const files = form.getAll('document') as File[];
        expect(files.map(f => [f.name, f.size])).toEqual([['a.pdf', 3], ['b.jpg', 5]]);
    });

    it('refuses a set over the server limit before sending anything, naming its size', async () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const out = await submitServerJob([doc('a.pdf', 2_500_000), doc('b.jpg', 2_000_000)], never, 4_400_000);
        expect(fetch).not.toHaveBeenCalled();
        expect('refusal' in out && out.refusal).toMatch(/total 4\.5 MB, more than the FinGence server accepts in one job \(4\.4 MB\)\. Nothing was processed/);
    });

    it('explains a refusal by the hosting platform itself (413 without a FinGence body) the same way', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('Request Entity Too Large', { status: 413 })));
        const out = await submitServerJob([doc('a.pdf', 1_000)], never);
        expect('refusal' in out && out.refusal).toMatch(/^These documents total 0\.0 MB, more than the FinGence server accepts in one job\. Nothing was processed/);
        vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'DOCUMENT_TOO_LARGE' }, { status: 413 })));
        expect(await submitServerJob([doc('a.pdf', 1_000)], never)).toEqual({ refusal: 'One of the documents is larger than 4 MB.' });
    });
});
