import { readFileSync } from 'node:fs';
import { processDocuments, type ProcessingContext } from '../../lib/demo/pipeline';

const doc = (name: string) => ({ name, bytes: new Uint8Array(readFileSync(`public/demo/${name}`)), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' as const });
/** The public fictional Phase 1 processing (bank statement, cash-account ledger and twelve-month history). */
export function phase1(): Promise<ProcessingContext> {
    return processDocuments([doc('demo-bank-statement-2026-03.csv'), doc('demo-general-ledger-2026-03.csv'), doc('demo-bank-history-2025-04-to-2026-03.csv')]);
}
export { doc };
