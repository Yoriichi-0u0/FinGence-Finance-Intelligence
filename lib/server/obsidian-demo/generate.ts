import 'server-only';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ProcessingContext } from '../../demo/pipeline';
import { processDocuments } from '../../demo/pipeline';
import { cashTotals } from '../../poc-insights/model';
import { writeSyntheticSummaryNote, type GeneratedVaultNote } from './vault';

const SAMPLE_FILES = [
    { name: 'demo-bank-statement-2026-03.csv', relative: 'public/demo/demo-bank-statement-2026-03.csv' },
    { name: 'demo-general-ledger-2026-03.csv', relative: 'public/demo/demo-general-ledger-2026-03.csv' },
    { name: 'demo-bank-history-2025-04-to-2026-03.csv', relative: 'public/demo/demo-bank-history-2025-04-to-2026-03.csv' },
] as const;

function requireVerifiedContext(context: ProcessingContext): asserts context is ProcessingContext & {
    scope: NonNullable<ProcessingContext['scope']>;
    outputs: ProcessingContext['outputs'] & {
        totals: NonNullable<ProcessingContext['outputs']['totals']>;
        reconciliation: NonNullable<ProcessingContext['outputs']['reconciliation']>;
        report: NonNullable<ProcessingContext['outputs']['report']>;
    };
} {
    if (!context.scope || !context.outputs.totals || !context.outputs.reconciliation || !context.outputs.report
        || context.documents.length !== SAMPLE_FILES.length
        || context.documents.some(d => d.decision !== 'AUTO_ACCEPTED' || !d.role || !/^[a-f0-9]{64}$/.test(d.sha256))) {
        throw new Error('OBSIDIAN_SYNTHETIC_PIPELINE_NOT_VERIFIED');
    }
}

function periodLabel(period: string): string {
    const range = /^([0-9]{4})-([0-9]{2})$/.exec(period);
    if (!range) return period;
    return new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}-01T00:00:00.000Z`));
}

function outflowMagnitude(signedOutflow: string): string {
    return signedOutflow.startsWith('-') ? signedOutflow.slice(1) : signedOutflow;
}

function markdownFor(context: ProcessingContext): { markdown: string; metadata: Omit<GeneratedVaultNote, 'noteTitle' | 'relativePath'> } {
    requireVerifiedContext(context);
    const scope = context.scope, totals = context.outputs.totals, reconciliation = context.outputs.reconciliation;
    const sourceHashes = context.documents.map(d => `${d.role!.toLowerCase()}: ${d.sha256}`);
    const period = scope.period, month = periodLabel(period), currency = scope.currency;
    const historyRows = context.outputs.history.accepted ? context.outputs.history.rows : context.outputs.bankRows;
    const historyMonths = context.outputs.history.accepted ? context.outputs.history.months : [...new Set(context.outputs.bankRows.map(r => r.period))].sort();
    const history = historyMonths.map(p => {
        const t = cashTotals(historyRows.filter(r => r.period === p));
        return `- ${p}: cash in ${currency} ${t.credits}; cash out ${currency} ${outflowMagnitude(t.debits)}; net cash movement ${currency} ${t.net}.`;
    }).join('\n');
    const anomaly = context.outputs.anomalyResolution;
    const candidateCount = context.outputs.anomalies.length;
    const confirmedCount = anomaly?.corroborated ?? 0;
    const flaggedCount = anomaly?.flagged ?? 0;
    const forecast = context.outputs.forecast?.forecast;
    const forecastText = forecast?.status === 'AVAILABLE'
        ? `- Next-month baseline period: ${forecast.period}.\n- Cash in: ${currency} ${forecast.credits}; cash out: ${currency} ${forecast.debits}; net cash movement: ${currency} ${forecast.net}.\n- Basis: mean of ${forecast.basis.months} months from ${forecast.basis.first} through ${forecast.basis.last}; this is a baseline, not a prediction of specific transactions.`
        : `- Unavailable: ${forecast?.detail ?? 'No verified forecast output was produced.'}`;
    const counts = Object.entries(reconciliation.counts).map(([name, count]) => `- ${name}: ${count}`).join('\n');
    const noteTitle = `FinGence Synthetic Finance Summary - ${period.replace(/[^0-9-]/g, '-')}`;
    const markdown = `---
processing_id: ${context.processingId}
source_hashes:
${sourceHashes.map(value => `  - ${value}`).join('\n')}
period: ${period}
currency: ${currency}
data_classification: synthetic
---
# ${noteTitle}

Processing ID: ${context.processingId}  
Source hashes: ${context.documents.map(d => d.sha256).join(', ')}  
Period: ${period} (${month})  
Currency: ${currency}

All figures below are **CASH MOVEMENT** from synthetic demo documents. They are not profit, loss, revenue, income, or accounting expenses.

## Cash movement — ${month}

- Total cash in (bank credits): ${currency} ${totals.credits} across ${totals.creditRows} records.
- Total cash out (bank debits): ${currency} ${outflowMagnitude(totals.debits)} across ${totals.debitRows} records.
- Net signed cash movement (net cash in minus cash out): ${currency} ${totals.net} across ${totals.rows} records. This is net cash movement, not profit, loss, or income.

## Reconciliation — ${month}

- Reconciled bank cash movement: ${currency} ${reconciliation.cashMovement.bank}.
- Reconciled ledger cash movement: ${currency} ${reconciliation.cashMovement.ledger}.
- Signed bank-minus-ledger difference: ${currency} ${reconciliation.cashMovement.signedDifference}.
- Outcome counts:
${counts}

## Anomaly review — ${month}

- Rule-based candidates: ${candidateCount}.
- Confirmed by the books: ${confirmedCount}.
- Flagged for technical review: ${flaggedCount}.
- A candidate is a reason to review, not a finding of fraud or misconduct.

## Monthly history

${history || '- No verified monthly history is available.'}

## Next-month cash baseline

${forecastText}
`;
    return { markdown, metadata: { processingId: context.processingId, period, currency, sourceHashes: context.documents.map(d => d.sha256) } };
}

/** Uses the actual server-side document pipeline on repository-owned synthetic fixtures. */
export async function generateSyntheticObsidianVault(request: Request): Promise<GeneratedVaultNote> {
    const inputs = await Promise.all(SAMPLE_FILES.map(async file => ({
        name: file.name,
        bytes: new Uint8Array(await readFile(resolve(file.relative))),
        provenance: 'PUBLIC_SYNTHETIC_SAMPLE' as const,
    })));
    const context = await processDocuments(inputs);
    const { markdown, metadata } = markdownFor(context);
    return writeSyntheticSummaryNote(request, markdown, metadata);
}

export { markdownFor as syntheticSummaryMarkdown };
