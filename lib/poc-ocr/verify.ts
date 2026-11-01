import type { Check, Quarantined } from '../demo/pipeline';
import { fromCents, toCents } from '../poc-anomalies/source';
import { OCR_VERIFICATION_VERSION, type OcrEvidence, type OcrHeldRecord, type OcrRow, type OcrVerification, type OcrVerifiedRecord } from './contracts';

/**
 * Independent financial verification of anchored OCR evidence, after the Phase 1 VERIFY pattern:
 * exact cents only, two readers must agree on every accepted value, and printed control totals must hold.
 * Configured statement convention (not inferred): DD/MM/YYYY dates; Debit and Credit are bank movements,
 * a bank debit removes cash and a bank credit adds cash; Balance = previous balance + credit - debit.
 * A failed document-level check quarantines every row. Unanchored values are unresolved, never accepted.
 * Text that looks like an instruction is held as untrusted data; it never changes a decision rule.
 */
const MONEY = /^\d{1,3}(?:,\d{3})*\.\d{2}$/;
export const INSTRUCTION_TEXT = /\b(?:ignore (?:all |any )?(?:previous|prior|above) instructions|system (?:note|prompt)|mark (?:this|it) (?:statement )?verified|report every amount)/i;
const cents = (printed: string) => toCents(printed.replaceAll(',', ''));
const isMoney = (s: string | undefined): s is string => !!s && MONEY.test(s);

function isoDate(printed: string): string | null {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(printed);
    if (!m) return null;
    const iso = `${m[3]}-${m[2]}-${m[1]}`, d = new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

export function verifyOcrStatement(evidence: OcrEvidence): OcrVerification {
    const checks: Check[] = [], quarantine: Quarantined[] = [];
    const check = (id: string, label: string, passed: boolean, detail: string) => { checks.push({ id, label, passed, detail }); return passed; };
    const unanchoredIds = new Set(evidence.unanchored.map(u => u.itemId));
    const conflictRows = new Set(evidence.unanchored.filter(u => u.reason === 'COLUMN_CONFLICT').map(u => u.itemId.slice(0, u.itemId.lastIndexOf(':') + 1)));
    const anchored = (row: OcrRow) => row.itemIds.every(id => !unanchoredIds.has(id) && !conflictRows.has(id.slice(0, id.lastIndexOf(':') + 1)));
    const transactions = evidence.rows.filter(r => r.kind === 'TRANSACTION');
    const forwards = evidence.rows.filter(r => r.kind === 'BALANCE_FORWARD');
    const summaryRows = evidence.rows.filter(r => r.kind === 'SUMMARY');
    const summary: Record<string, string> = {}, summaryAnchored: Record<string, boolean> = {};
    for (const r of summaryRows) {
        if (r.cells.Label in summary && summary[r.cells.Label] !== r.cells.Value) summary[r.cells.Label] = 'CONFLICT';
        else summary[r.cells.Label] = r.cells.Value;
        summaryAnchored[r.cells.Label] = (summaryAnchored[r.cells.Label] ?? false) || anchored(r);
    }
    const columns = new Set(evidence.rows.filter(r => r.kind === 'HEADER').flatMap(r => Object.keys(r.cells)));
    const signed = columns.has('Debit') && columns.has('Credit') && columns.has('Balance');

    // Document-level gates.
    const truncated = evidence.warnings.filter(w => /token limit/.test(w));
    check('complete-output', 'Model output is complete on every page', !truncated.length, truncated.length ? truncated.join(' ') : `${new Set(evidence.items.map(i => i.page)).size} pages`);
    check('structure', 'Transaction table with Date, Reference, Debit, Credit and Balance columns', signed && transactions.length > 0, `${[...columns].join(', ') || 'no header'}; ${transactions.length} transaction rows`);
    const omitted = evidence.unclaimed.filter(u => MONEY.test(u.text));
    check('no-omitted-amounts', 'Every amount the independent reader found is claimed by the transcription', omitted.length === 0, omitted.length ? omitted.slice(0, 5).map(u => `p${u.page} ${u.text}`).join(', ') : `${evidence.unclaimed.length} unclaimed non-amount regions`);
    // Instructions are searched in the model text and in content only the independent reader saw.
    const instruction = [...evidence.items.map(i => i.text), ...evidence.texts.map(t => t.text), ...evidence.unclaimed.map(u => u.text)].filter(t => INSTRUCTION_TEXT.test(t));
    for (const text of new Set(instruction)) quarantine.push({ kind: 'DOCUMENT', reference: evidence.filename, status: 'UNTRUSTED_INSTRUCTION_TEXT', reason: `Document text held as untrusted data, not followed: "${text.slice(0, 120)}"` });
    const needed = ['Opening balance', 'Total debits', 'Total credits', 'Closing balance', 'Number of transactions'];
    const summaryOk = needed.every(l => l in summary && summary[l] !== 'CONFLICT' && summaryAnchored[l]);
    check('summary-anchored', 'Printed control totals present and confirmed by the independent reader', summaryOk, needed.map(l => `${l}: ${summary[l] ?? 'missing'}${summaryAnchored[l] ? '' : ' (unanchored)'}`).join('; '));
    const money = (l: string) => isMoney(summary[l]) ? cents(summary[l]) : null;
    const opening = money('Opening balance'), closing = money('Closing balance');
    let debits = 0n, credits = 0n, totalsComplete = signed;
    for (const r of transactions) {
        if (r.cells.Debit && isMoney(r.cells.Debit)) debits += cents(r.cells.Debit); else if (r.cells.Debit) totalsComplete = false;
        if (r.cells.Credit && isMoney(r.cells.Credit)) credits += cents(r.cells.Credit); else if (r.cells.Credit) totalsComplete = false;
    }
    check('row-count', 'Transaction rows equal the printed number of transactions', String(transactions.length) === summary['Number of transactions'], `${transactions.length} rows vs printed ${summary['Number of transactions'] ?? 'missing'}`);
    check('total-debits', 'Sum of debits equals printed total debits (exact cents)', totalsComplete && money('Total debits') === debits, `${fromCents(debits)} vs printed ${summary['Total debits'] ?? 'missing'}`);
    check('total-credits', 'Sum of credits equals printed total credits (exact cents)', totalsComplete && money('Total credits') === credits, `${fromCents(credits)} vs printed ${summary['Total credits'] ?? 'missing'}`);
    const lastBalance = transactions.at(-1)?.cells.Balance;
    check('closing-balance', 'Opening + credits - debits equals printed closing and the last running balance', opening !== null && closing !== null && opening + credits - debits === closing && isMoney(lastBalance) && cents(lastBalance) === closing, `${opening === null ? '?' : fromCents(opening)} + ${fromCents(credits)} - ${fromCents(debits)} vs closing ${summary['Closing balance'] ?? 'missing'}, last row ${lastBalance ?? 'missing'}`);
    const pages = [...new Set(transactions.map(r => r.page))].sort((a, b) => a - b);
    const continuity = pages.map(page => {
        const forward = forwards.find(r => r.page === page), prior = transactions.filter(r => r.page < page).at(-1);
        const expected = prior ? prior.cells.Balance : summary['Opening balance'];
        return { page, ok: !!forward && anchored(forward) && forward.cells.Balance === expected, detail: `p${page} forward ${forward?.cells.Balance ?? 'missing'} vs ${expected ?? 'missing'}` };
    });
    check('page-continuity', 'Each page starts from the previous verified balance', continuity.length > 0 && continuity.every(c => c.ok), continuity.map(c => c.detail).join('; '));
    const documentOk = checks.every(c => c.passed);

    // Row-level gates, in printed order along the running-balance chain.
    const accepted: OcrVerifiedRecord[] = [], quarantined: OcrHeldRecord[] = [], unresolved: OcrHeldRecord[] = [];
    let previous: { balance: string | undefined; anchored: boolean } = { balance: summary['Opening balance'], anchored: !!summaryAnchored['Opening balance'] };
    let currentPage = 0;
    for (const r of transactions) {
        if (r.page !== currentPage) {
            const forward = forwards.find(f => f.page === r.page);
            if (forward) previous = { balance: forward.cells.Balance, anchored: anchored(forward) };
            currentPage = r.page;
        }
        const id = `${evidence.sourceSha256}:ocr0:${r.page}:${r.table}:${r.index}`;
        const unresolvedReasons: string[] = [], failed: string[] = [];
        if (!signed) unresolvedReasons.push('UNRESOLVED_DIRECTION');
        if (!anchored(r)) unresolvedReasons.push('UNANCHORED_EVIDENCE');
        const iso = isoDate(r.cells.Date ?? '');
        if (!iso) failed.push('INVALID_DATE');
        const debit = r.cells.Debit, credit = r.cells.Credit;
        if (signed && !((isMoney(debit) && !credit) || (isMoney(credit) && !debit))) failed.push('SIGN_NOT_ESTABLISHED');
        if (signed && !isMoney(r.cells.Balance)) failed.push('INVALID_BALANCE');
        if (signed && !failed.length) {
            if (!isMoney(previous.balance) || !previous.anchored) unresolvedReasons.push('BALANCE_CHAIN_UNANCHORED');
            else if (cents(previous.balance) + (credit ? cents(credit) : 0n) - (debit ? cents(debit) : 0n) !== cents(r.cells.Balance!)) failed.push('RUNNING_BALANCE_MISMATCH');
        }
        if (r.itemIds.some(i => INSTRUCTION_TEXT.test(evidence.items.find(x => x.id === i)?.text ?? ''))) failed.push('UNTRUSTED_INSTRUCTION_TEXT');
        previous = { balance: r.cells.Balance, anchored: anchored(r) };
        const held: OcrHeldRecord = { id, page: r.page, reference: r.cells.Reference ?? null, reasons: [...failed, ...unresolvedReasons], evidenceIds: r.itemIds };
        if (failed.length) quarantined.push(held);
        else if (unresolvedReasons.length) unresolved.push(held);
        else if (!documentOk) quarantined.push({ ...held, reasons: ['DOCUMENT_CHECKS_FAILED'] });
        else accepted.push({
            id, page: r.page, printedDate: r.cells.Date!, isoDate: iso!, reference: r.cells.Reference!, description: r.cells.Description ?? '',
            direction: debit ? 'BANK_DEBIT' : 'BANK_CREDIT', amount: fromCents(cents((debit || credit)!)), balance: fromCents(cents(r.cells.Balance!)), evidenceIds: r.itemIds,
        });
    }
    if (!documentOk) quarantine.push({ kind: 'DOCUMENT', reference: evidence.filename, status: 'VERIFICATION_FAILED', reason: checks.filter(c => !c.passed).map(c => c.label).join('; ') });
    for (const h of [...quarantined, ...unresolved]) quarantine.push({ kind: 'DOCUMENT', reference: `${evidence.filename} p${h.page} ${h.reference ?? ''}`.trim(), status: h.reasons[0], reason: h.reasons.join(', ') });
    return {
        version: OCR_VERIFICATION_VERSION, proposalMode: evidence.receipt.mode, anchorReaders: evidence.anchorReaders,
        decision: accepted.length === transactions.length && transactions.length > 0 ? 'VERIFIED' : accepted.length ? 'PARTIAL' : 'QUARANTINED',
        checks, accepted, quarantined, unresolved, quarantine,
        controlTotals: { printed: summary, computed: { 'Total debits': fromCents(debits), 'Total credits': fromCents(credits), 'Number of transactions': String(transactions.length) } },
    };
}
