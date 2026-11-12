import { toCents } from '../poc-anomalies/source';
import type { ProcessedDocument, ProcessingContext } from '../demo/pipeline';

/**
 * Processing confidence: how much of this period's bank movement, by value, FinGence read reliably, checked and
 * explained. It is NOT a probability of being right; it is the share of the money FinGence can fully account for.
 *
 *   Read reliably  the record comes from a document read by a known layout, by an AI-proposed layout that passed every
 *                  gate, or by OCR at a mean confidence of at least 90% with its amounts confirmed by the arithmetic anchor.
 *   Checked        every stage that produces or checks the bank figures was verified (identify, extract, interpret,
 *                  verify, reconcile, analyse). If any was not, there is no percentage: the result is incomplete. The
 *                  forecast and report stages do not count: a forecast is legitimately unavailable without enough history.
 *   Explained      the record is matched to the books or resolved by a stated rule, against a ledger that was itself
 *                  read reliably, and it is not an unusual record the books could not settle.
 *
 * Bands: 98% and above High, 90% to 98% Check advised, below 90% Low. The thresholds are calibrated on the evaluation
 * corpus (docs/evaluation) and kept here, in one place.
 */
export const OCR_MIN_CONFIDENCE = 90;
export const BANDS = { HIGH: 98, CHECK: 90 } as const;
export type Band = 'HIGH' | 'CHECK' | 'LOW';
export type Shortfall = { cents: string; records: number; reasons: string[] };
export type Confidence =
    | { status: 'MEASURED'; percent: number; band: Band; currency: string; totalCents: string; countedCents: string; records: number; counted: number;
        read: Shortfall; explained: Shortfall; checks: { passed: number; total: number } }
    | { status: 'INCOMPLETE'; reason: string; checks: { passed: number; total: number } };

/** The stages that produce or check the bank figures; a forecast that cannot be made (too little history) is not a doubt about them. */
export const FIGURE_STAGES = new Set(['IDENTIFY', 'EXTRACT', 'INTERPRET', 'VERIFY', 'RECONCILE', 'ANALYZE']);
export const bandOf = (percent: number): Band => percent >= BANDS.HIGH ? 'HIGH' : percent >= BANDS.CHECK ? 'CHECK' : 'LOW';
const abs = (v: bigint) => v < 0n ? -v : v;
const money = (currency: string, cents: bigint) => `${currency} ${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Why a document's reading is not reliable, or null when it is. */
export function readingConcern(d: ProcessedDocument): string | null {
    if (d.decision !== 'AUTO_ACCEPTED') return `${d.name} was set aside`;
    if (d.interpretation && d.interpretation.decision !== 'AUTO_ACCEPTED') return `the AI's reading of ${d.name} did not pass its checks`;
    const s = d.source;
    if (s && s.kind === 'OCR') {
        if ((s.confidence ?? 0) < OCR_MIN_CONFIDENCE) return `${d.name} was read by OCR at ${s.confidence ?? 0}% confidence (below ${OCR_MIN_CONFIDENCE}%)`;
        const anchor = d.interpretation?.checks.find(c => c.id === 'anchor');
        if (d.interpretation && !anchor?.passed) return `the amounts read from ${d.name} by OCR could not be confirmed by its own arithmetic`;
    }
    return null;
}

export function processingConfidence(c: ProcessingContext): Confidence {
    const figureStages = c.stages.filter(s => FIGURE_STAGES.has(s.id)), stageChecks = figureStages.flatMap(s => s.checks), checks = { passed: stageChecks.filter(k => k.passed).length, total: stageChecks.length };
    if (!c.scope || !c.outputs.reconciliation || c.status === 'QUARANTINED') return { status: 'INCOMPLETE', reason: 'The documents were set aside, so there are no figures to measure.', checks };
    const failedStage = figureStages.find(s => s.decision !== 'AUTO_ACCEPTED');
    if (failedStage) return { status: 'INCOMPLETE', reason: `The stage "${failedStage.title}" did not pass all its checks, so FinGence gives no confidence figure.`, checks };

    const o = c.outputs, reconciliation = o.reconciliation, currency = c.scope.currency, rows = o.bankRows;
    if (!rows.length) return { status: 'INCOMPLETE', reason: 'There are no bank records to measure.', checks };

    // Which document each bank record was read from (one statement in the usual case).
    const statements = c.documents.filter(d => d.role === 'BANK_STATEMENT'), ledgers = c.documents.filter(d => d.role === 'GENERAL_LEDGER');
    const docOf = new Map<string, ProcessedDocument>();
    for (const d of statements) for (const r of d.reading?.records ?? []) docOf.set(r.id, d);
    const statementOf = (rowId: string) => docOf.get(rowId) ?? (statements.length === 1 ? statements[0] : undefined);
    const ledgerConcerns = ledgers.map(readingConcern).filter((x): x is string => !!x);

    // Every bank record's reconciliation outcome, across all months.
    const results = o.periods.length ? o.periods.flatMap(p => p.snapshot.results) : reconciliation?.results ?? [];
    const matched = new Set(results.filter(r => r.bankRecordId && (r.status === 'MATCH_EXACT' || r.status === 'MATCH_DATE_SHIFT')).map(r => r.bankRecordId!));
    const resolved = new Set<string>(), unexplained = new Set<string>();
    for (const p of o.resolution?.periods ?? []) for (const i of p.items) if (i.bankRecordId) (i.resolution === 'UNEXPLAINED' ? unexplained : resolved).add(i.bankRecordId);
    const flagged = new Set((o.anomalyResolution?.items ?? []).filter(a => a.resolution === 'FLAGGED').map(a => a.row.rowId));

    let total = 0n, counted = 0n, readShort = 0n, explainShort = 0n, readRecords = 0, explainRecords = 0, countedRecords = 0, notMatched = 0n, notMatchedRecords = 0, flaggedCents = 0n;
    const readReasons = new Set<string>();
    for (const row of rows) {
        const cents = abs(toCents(row.signedAmount)); total += cents;
        const doc = statementOf(row.rowId), concern = doc ? readingConcern(doc) : 'a bank record could not be traced to its document';
        if (concern) { readShort += cents; readRecords++; readReasons.add(concern); }
        const settled = (matched.has(row.rowId) || resolved.has(row.rowId)) && !unexplained.has(row.rowId);
        const isFlagged = flagged.has(row.rowId), explained = settled && !isFlagged && !ledgerConcerns.length;
        if (!explained) { explainShort += cents; explainRecords++; }
        if (!settled) { notMatched += cents; notMatchedRecords++; }
        if (isFlagged) flaggedCents += cents;
        if (!concern && explained) { counted += cents; countedRecords++; }
    }
    if (total === 0n) return { status: 'INCOMPLETE', reason: 'The bank records add up to no movement, so there is nothing to measure.', checks };

    const explainReasons = [
        ...(notMatchedRecords ? [`${money(currency, notMatched)} across ${notMatchedRecords} record${notMatchedRecords === 1 ? '' : 's'} not matched or explained by the books`] : []),
        ...(flagged.size ? [`${flagged.size} unusual record${flagged.size === 1 ? '' : 's'} (${money(currency, flaggedCents)}) the books could not settle`] : []),
        ...ledgerConcerns.map(x => `the ledger is not reliable: ${x}`),
    ];
    // Rounded down to one decimal, so 99.96% never shows as 100%.
    const percent = Math.floor(Number((counted * 1000n) / total)) / 10;
    return {
        status: 'MEASURED', percent, band: bandOf(percent), currency, totalCents: total.toString(), countedCents: counted.toString(), records: rows.length, counted: countedRecords,
        read: { cents: readShort.toString(), records: readRecords, reasons: [...readReasons] },
        explained: { cents: explainShort.toString(), records: explainRecords, reasons: explainReasons },
        checks,
    };
}
