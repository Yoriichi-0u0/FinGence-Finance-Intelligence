import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = { expect: 'ACCEPT', meets: true, failedGates: [], reason: '', readRows: 2, readExact: 2, truthRows: 2, rows: 2, fieldsCompared: 2, datesExact: 2, amountsExact: 2, seconds: 3, usd: 0.001, role: 'BANK_STATEMENT', truthRole: 'BANK_STATEMENT', currency: 'MYR', truthCurrency: 'MYR', records: [{ date: '2026-03-01', cents: '-1050', description: 'Rent' }, { date: '2026-03-02', cents: '2000', description: 'Sale' }] };
const run = (results: Record<string, unknown>[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'fg-eval-')), path = join(dir, 'run.json'), sheet = join(dir, 'sheet.csv');
    writeFileSync(path, JSON.stringify({ date: '2026-11-06T00:00:00Z', complete: true, results }));
    const md = execFileSync(process.execPath, ['scripts/evaluate-ingestion.mjs', path, '--sheet', sheet, '--sample', '3'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { md, sheet: readFileSync(sheet, 'utf8') };
};

describe('ingestion evaluation scoring', () => {
    it('scores the protocol metrics with Wilson intervals, and excludes only daily-allowance refusals', () => {
        const { md, sheet } = run([
            { ...base, id: 'heldout/a.csv', corpus: 'HELD_OUT', format: 'CSV', outcome: 'ACCEPTED_EXACT' },
            { ...base, id: 'heldout/b.csv', corpus: 'HELD_OUT', format: 'CSV', outcome: 'QUARANTINED', rows: 0, fieldsCompared: 0, datesExact: 0, amountsExact: 0, reason: 'AI interpretation unavailable (PROVIDER_HTTP_400_JSON_VALIDATE_FAILED).' },
            { ...base, id: 'heldout/c.csv', corpus: 'HELD_OUT', format: 'CSV', outcome: 'QUARANTINED', reason: 'AI interpretation unavailable (RATE_LIMITED).' },
            { ...base, id: 'bad.csv', corpus: 'ADVERSARIAL', format: 'CSV', expect: 'QUARANTINE', outcome: 'QUARANTINED', rows: 0, fieldsCompared: 0 },
        ]);
        expect(md).toContain('Documents scored: 3. Excluded for the provider\'s daily token allowance (RATE_LIMITED), not scored: 1 (heldout/c.csv)');
        expect(md).toMatch(/\| M1 \| False acceptances \| \*\*0\*\* of 1 accepted documents .* \| \*\*Met\*\* \|/);
        // A malformed model reply is the system's failure, so it counts: 1 of 2 held-out documents, under 80%.
        expect(md).toMatch(/\| M3h \| Straight-through, held-out digital \| 1 \/ 2 = \*\*50\.0%\*\* \(95% CI 9\.5%–90\.5%\) \| ≥ 80% \| \*\*Not met\*\* \|/);
        expect(md).toMatch(/\| M4 \| Invalid documents refused \| 1 \/ 1 = \*\*100\.0%\*\*/);
        expect(sheet.split('\n')[0]).toBe('document,set,format,record,date,signed_amount,description,matches_document (Y/N),note');
        expect(sheet).toContain('heldout/a.csv,HELD_OUT,CSV,1,2026-03-01,-10.50,Rent,,');
    });

    it('fails the evaluation on any false acceptance', () => {
        const { md } = run([{ ...base, id: 'x.csv', corpus: 'GENERATED', format: 'CSV', outcome: 'FALSE_ACCEPTANCE', amountsExact: 1 }]);
        expect(md).toMatch(/\| M1 \| False acceptances \| \*\*1\*\* of 1 .* \| \*\*Not met\*\* \|/);
        expect(md).toMatch(/signed amounts 1 \/ 2 = \*\*50\.0%\*\*/);
    });
});
