import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDocuments, type DocumentInput } from '../../lib/demo/pipeline';
import { attentionCounts } from '../../lib/demo/attention';

const doc = (path: string): DocumentInput => ({ name: path.split('/').at(-1)!, bytes: new Uint8Array(readFileSync(join('public/demo', path))), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });

describe('what needs a person, counted once for the Overview and the navigation badges', () => {
    it('counts nothing before anything is processed', () => {
        expect(attentionCounts(null)).toEqual({ anomalies: 0, reconciliation: 0, documents: 0 });
    });

    it('counts the anomalies the books could not settle and the differences no rule explained', async () => {
        const c = await processDocuments([doc('demo-bank-statement-2026-03.csv'), doc('demo-general-ledger-2026-03.csv')]);
        expect(attentionCounts(c)).toEqual({
            anomalies: c.outputs.anomalyResolution!.flagged,
            reconciliation: c.outputs.resolution!.attention.length,
            documents: 0,
        });
    });
});
