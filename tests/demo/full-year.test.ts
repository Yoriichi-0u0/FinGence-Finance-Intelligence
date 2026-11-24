import { beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({ usePathname: () => '/ai-report', useRouter: () => ({ push: () => undefined }) }));
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { processDocuments, type DocumentInput, type ProcessingContext } from '../../lib/demo/pipeline';
import { toCents } from '../../lib/poc-anomalies/source';
import { processingConfidence } from '../../lib/confidence';
import { comparisonFacts } from '../../lib/ai-report/sections';
import { groundingIndex } from '../../lib/grounded-qa/tools';
import { periodEnded, priorPeriod, reportKind } from '../../components/ai-report/ai-report';

// The public full-year sample (scripts/generate-full-year-documents.mjs): a third fictional business, twelve months in MYR.
const DIR = 'public/demo/full-year';
const BANK = 'demo-bank-statement-2025-fy-myr.csv', LEDGER = 'demo-general-ledger-2025-fy-myr.csv', HISTORY = 'demo-bank-history-2024-01-to-2025-12-myr.csv';
const bytes = (name: string) => readFileSync(join(DIR, name));
const doc = (name: string): DocumentInput => ({ name, bytes: new Uint8Array(bytes(name)), provenance: 'PUBLIC_SYNTHETIC_SAMPLE' });
const YEAR = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);

let c: ProcessingContext;
beforeAll(async () => { c = await processDocuments([doc(BANK), doc(LEDGER), doc(HISTORY)]); });

describe('full-year sample', () => {
    it('is exactly what its generator writes, and its manifest pins every file the Data page loads', () => {
        expect(execFileSync(process.execPath, ['scripts/generate-full-year-documents.mjs', '--check'], { encoding: 'utf8' })).toContain('current');
        const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as { origin: string; periods: string[]; currency: string; files: Record<string, { sha256: string; bytes: number }> };
        expect(manifest).toMatchObject({ origin: 'PUBLIC_FICTIONAL_SYNTHETIC', periods: YEAR, currency: 'MYR' });
        for (const name of [BANK, LEDGER, HISTORY]) expect(manifest.files[name]).toEqual({ sha256: createHash('sha256').update(bytes(name)).digest('hex'), bytes: bytes(name).byteLength });
        // Small enough for the hosted upload limit (about 4.3 MB of documents) with plenty of room.
        expect([BANK, LEDGER, HISTORY].reduce((n, name) => n + bytes(name).byteLength, 0)).toBeLessThan(1_000_000);
        const page = readFileSync('components/demo/data-workspace.tsx', 'utf8');
        for (const name of [BANK, LEDGER, HISTORY]) expect(page).toContain(`'full-year/${name}'`);
        expect(page).toContain("'full-year/'");
    });
    it('processes a whole financial year end to end and reconciles every month', () => {
        expect(c.stages.map(s => `${s.id}:${s.decision}`)).toEqual(['IDENTIFY:AUTO_ACCEPTED', 'EXTRACT:AUTO_ACCEPTED', 'INTERPRET:AUTO_ACCEPTED', 'VERIFY:AUTO_ACCEPTED', 'RECONCILE:AUTO_ACCEPTED', 'ANALYZE:AUTO_ACCEPTED', 'FORECAST:AUTO_ACCEPTED', 'REPORT:AUTO_ACCEPTED']);
        expect(c.stages.flatMap(s => s.checks).every(k => k.passed)).toBe(true);
        expect(c.scope).toEqual({ organizationId: 'synthetic-demo', businessId: 'DEMO-003', businessName: 'Rimba Demo Furniture (Synthetic)', period: '2025-01/2025-12', months: YEAR, currency: 'MYR' });
        expect(c.outputs.periods.map(p => p.period)).toEqual(YEAR);
        expect(c.outputs.notReconciled).toEqual([]);
        expect(c.outputs.reconciliation!.cashMovement.bank).toBe(c.outputs.totals!.net);
        expect(c.outputs.bankRows.every(r => r.currency === 'MYR')).toBe(true);
        // Quarter-end deposits and late-month cheques clear the next month; one deposit and one cheque are open at year end;
        // bank charges, interest and the two payments the books do not show become prepared correcting entries.
        expect(c.outputs.resolution!.totals.resolutions).toEqual({ MATCHED_LATE: 2, MATCHED_BY_AMOUNT: 0, TIMING_CLEARED: 12, TIMING_OPEN: 2, ENTRY_PREPARED: 18, UNEXPLAINED: 0 });
        expect(c.outputs.resolution!.summary).toMatch(/^January 2025 to December 2025: 609 transactions matched, 8 timing differences identified \(2 expected on the next statement\), 18 correcting entries prepared for your books\./);
        expect(c.outputs.resolution!.entries.every(e => e.debit.amount === e.credit.amount)).toBe(true);
    });
    it('confirms the year’s one-off payments against the books and flags only the unverified payee', () => {
        const a = c.outputs.anomalyResolution!;
        expect(a).toMatchObject({ corroborated: 3, flagged: 1 });
        expect(a.items.filter(i => i.resolution === 'CORROBORATED_BY_BOOKS').map(i => i.row.counterparty).sort()).toEqual(['Sinar Demo Office Fitouts', 'Staff Payroll', 'Teknik Demo CNC Machinery']);
        const flagged = a.items.filter(i => i.resolution === 'FLAGGED');
        expect(flagged.map(i => [i.row.counterparty, i.row.amount])).toEqual([['Kilat Demo Trading', '7450.00']]);
        expect(c.quarantine.map(q => q.kind)).toEqual(['ANOMALY_CANDIDATE']);
        expect(c.status).toBe('COMPLETED_WITH_EXCEPTIONS');
        const confidence = processingConfidence(c);
        if (confidence.status !== 'MEASURED') throw Error(confidence.reason);
        expect(confidence.band).toBe('HIGH');
    });
    it('has two years of history: an annual report compared with 2024, a seasonal year and a forecast for January 2026', () => {
        expect(c.outputs.history.months).toHaveLength(24);
        expect(reportKind(YEAR)).toBe('Annual report');
        expect(periodEnded(YEAR)).toBe('for the twelve months ended 31 December 2025');
        expect(priorPeriod({ outputs: c.outputs, scope: { months: YEAR } })?.months).toEqual(YEAR.map(m => m.replace('2025', '2024')));
        expect(comparisonFacts(groundingIndex(c)!)[0].label).toBe('Preceding period of the same length (2024-01/2024-12)');
        // Sales peak before Hari Raya (March) and at year end, and the new trade customer lifts the second half.
        const credits = (m: string) => c.outputs.bankRows.filter(r => r.period === m && r.direction === 'Credit').reduce((n, r) => n + toCents(r.amount), 0n);
        expect(credits('2025-03')).toBeGreaterThan(credits('2025-05'));
        expect(credits('2025-12')).toBeGreaterThan(credits('2025-06'));
        expect(c.outputs.forecast!.forecast).toMatchObject({ status: 'AVAILABLE', period: '2026-01' });
    });
});
