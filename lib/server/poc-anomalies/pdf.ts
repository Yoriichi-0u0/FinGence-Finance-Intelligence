import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { RECONCILIATION_STATUSES } from '../../poc-anomalies/reconciliation';
import { groupDigits } from '../../poc-anomalies/format';
import type { PocReport } from './service';

/** Fixed-layout A4 management report. Every figure is copied from the report model, never recomputed. */
const A4: [number, number] = [595.28, 841.89], margin = 48, width = A4[0] - margin * 2;
const ink = rgb(0.09, 0.13, 0.18), muted = rgb(0.38, 0.43, 0.5), teal = rgb(0.07, 0.37, 0.35), amber = rgb(0.6, 0.35, 0.02), line = rgb(0.85, 0.87, 0.9);
// Standard PDF fonts are WinAnsi only; anything else is replaced visibly rather than dropped.
const safe = (value: string) => value.replace(/[^\x20-\x7e -ÿ]/g, '?');
const rows = (n: number) => `${n} row${n === 1 ? '' : 's'}`;
const statusTitle = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

export async function renderManagementReport(report: PocReport): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    pdf.setTitle(`FinGence PoC management report ${report.selection.businessId} ${report.selection.period}`);
    pdf.setSubject('Synthetic PoC data - not financial-publication eligible');
    pdf.setProducer('FinGence PoC (pdf-lib)');
    pdf.setCreator('FinGence');
    pdf.setCreationDate(new Date(report.generatedAt));
    pdf.setModificationDate(new Date(report.generatedAt));
    const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    let page: PDFPage = pdf.addPage(A4), y = A4[1] - margin;
    const room = (needed: number) => { if (y - needed < margin + 24) { page = pdf.addPage(A4); y = A4[1] - margin; } };
    const wrap = (text: string, font: PDFFont, size: number, max: number) => {
        const lines: string[] = [];
        for (const paragraph of safe(text).split('\n')) {
            let current = '';
            for (const word of paragraph.split(' ')) {
                const next = current ? `${current} ${word}` : word;
                if (font.widthOfTextAtSize(next, size) <= max) { current = next; continue; }
                if (current) lines.push(current);
                current = word;
                while (font.widthOfTextAtSize(current, size) > max) {
                    let cut = current.length - 1;
                    while (cut > 1 && font.widthOfTextAtSize(current.slice(0, cut), size) > max) cut--;
                    lines.push(current.slice(0, cut)); current = current.slice(cut);
                }
            }
            lines.push(current);
        }
        return lines;
    };
    const text = (value: string, options: { size?: number; font?: PDFFont; color?: typeof ink; x?: number; max?: number; gap?: number } = {}) => {
        const size = options.size ?? 9.5, font = options.font ?? regular, x = options.x ?? margin;
        for (const l of wrap(value, font, size, options.max ?? width - (x - margin))) {
            room(size + 4);
            page.drawText(l, { x, y: y - size, size, font, color: options.color ?? ink });
            y -= size + (options.gap ?? 3.5);
        }
    };
    const heading = (value: string) => { y -= 10; room(72); text(value, { size: 12.5, font: bold, color: teal }); page.drawLine({ start: { x: margin, y: y + 1 }, end: { x: margin + width, y: y + 1 }, thickness: 0.6, color: line }); y -= 6; };
    const pairs = (rows: [string, string][], labelWidth = 150) => {
        for (const [label, value] of rows) {
            const lines = wrap(value, regular, 9.5, width - labelWidth);
            room(lines.length * 13);
            page.drawText(safe(label), { x: margin, y: y - 9.5, size: 9.5, font: bold, color: muted });
            lines.forEach((l, i) => page.drawText(l, { x: margin + labelWidth, y: y - 9.5 - i * 13, size: 9.5, font: regular, color: ink }));
            y -= lines.length * 13 + 1.5;
        }
    };
    const s = report.selection, c = report.cashMovement, money = (v: string) => `${s.currency} ${groupDigits(v)}`;

    text('FinGence management report', { size: 20, font: bold });
    text(`${s.businessName} (${s.businessId}) - ${s.period}`, { size: 12, color: muted, gap: 8 });
    room(26);
    page.drawRectangle({ x: margin, y: y - 22, width, height: 22, color: rgb(1, 0.96, 0.88) });
    page.drawText('SYNTHETIC PoC DATA - NOT FOR FINANCIAL PUBLICATION - NOT FRAUD FINDINGS', { x: margin + 8, y: y - 15, size: 9, font: bold, color: amber });
    y -= 30;
    pairs([
        ['Business', `${s.businessName} (${s.businessId})`], ['Period', s.period], ['Currency', s.currency],
        ['Source file', report.source.fileName], ['Source SHA-256', report.source.sha256], ['Source rows', `${report.source.rowCount} in file; ${c.rows} in this business and period`],
        ['Uploaded', report.source.uploadedAt], ['Generated', report.generatedAt], ['Prepared for', `Finance user ${report.scope.userId}, organization ${report.scope.organizationId}`],
        ['Detector', report.detectorVersion], ['Report hash', report.reportHash],
    ], 110);

    heading('Bank signed cash movement (source)');
    pairs([
        ['Credits (cash in)', `${money(c.credits)} (${rows(c.creditRows)})`], ['Debits (cash out)', `${money(c.debits)} (${rows(c.debitRows)})`],
        ['Net signed movement', money(c.net)], ['Basis', c.basis],
    ]);
    text('Signed cash movement is not revenue, profit or a cash flow statement.', { size: 8.5, color: muted });

    heading('Bank and general ledger reconciliation');
    if (report.reconciliation.status === 'AVAILABLE') {
        const r = report.reconciliation.snapshot;
        pairs([
            ['Bank movement', money(r.cashMovement.bank)], ['Ledger movement', money(r.cashMovement.ledger)], ['Signed difference', money(r.cashMovement.signedDifference)],
            ['Bank source', `${r.sources.bank.sourceId} (${r.sources.bank.sha256.slice(0, 16)}...)`], ['Ledger source', `${r.sources.ledger.sourceId} (${r.sources.ledger.sha256.slice(0, 16)}...)`],
            ['Cross-check', r.cashMovement.bank === c.net ? 'Reconciliation bank movement equals the anomaly source net movement.' : `Reconciliation bank movement differs from the anomaly source net movement (${money(c.net)}).`],
            ...RECONCILIATION_STATUSES.map(k => [statusTitle(k), String(r.counts[k] ?? 0)] as [string, string]),
        ]);
        text(`Origin ${r.origin}; produced by the reconciliation feature (FinancePoCReconciliationV1). Review outcomes are listed as supplied and are not cleared here.`, { size: 8.5, color: muted });
        for (const limitation of r.limitations) text(`- ${limitation}`, { size: 8.5, color: muted });
    } else {
        text(`Reconciliation unavailable. ${report.reconciliation.reason}`, { font: bold });
        text('No ledger movement, matching status or reconciliation difference is reported.', { size: 8.5, color: muted });
    }

    // Separate from the anomaly review summary below: these are reviewer annotations on reconciliation outcomes.
    y -= 8; room(60);
    text('Human reconciliation review (annotations, not cleared transactions)', { size: 10.5, font: bold, color: teal, gap: 5 });
    const h = report.reconciliationHumanReview;
    if (h.status === 'AVAILABLE') {
        const eligible = Object.entries(h.eligibleByStatus).map(([k, n]) => `${n} ${statusTitle(k).toLowerCase()}`).join(', ');
        pairs([
            ['Original review-eligible', `${h.originalEligible} outcomes (${eligible}); unchanged by review`],
            ['Reviewer: Open', String(h.states.OPEN)], ['Reviewer: Investigating', String(h.states.INVESTIGATING)],
            ['Reviewer: Explained', String(h.states.EXPLAINED)], ['Reviewer: Escalated', String(h.states.ESCALATED)],
        ]);
        text('Explained does not mean matched, reconciled, cleared or settled. The original outcomes and the signed difference above are unchanged.', { size: 8.5, font: bold, color: amber });
        text(h.basis, { size: 8.5, color: muted });
    } else {
        text(`Human review summary unavailable. ${h.reason}`, { font: bold });
        text('No reviewer decision counts are reported.', { size: 8.5, color: muted });
    }

    heading('Anomaly review summary');
    const k = report.counts;
    pairs([
        ['Review candidates', `${k.candidates} (${k.high} high, ${k.medium} medium)`],
        ['Review state', `${k.byReview.OPEN} open, ${k.byReview.EXPLAINED} explained, ${k.byReview.ESCALATED} escalated`],
        ...report.rules.map(r => [r.title, `${k.byRule[r.id]} - ${r.basis}`] as [string, string]),
        ['Baseline', report.baseline],
    ]);
    if (report.evaluation) {
        const e = report.evaluation;
        text(`Offline evaluation (${e.label}): precision ${e.precision}, recall ${e.recall} over ${e.rows} rows (TP ${e.truePositives}, FP ${e.falsePositives}, FN ${e.falseNegatives}, TN ${e.trueNegatives}). Dataset-specific; not a live model metric.`, { size: 8.5, color: muted });
    }

    heading(`Exceptions requiring review (${report.candidates.length})`);
    if (!report.candidates.length) text('No rule produced a review candidate for this business and period.');
    for (const item of report.candidates) {
        room(48);
        y -= 4;
        text(`${item.date}  ${item.rowId}  ${money(item.signedAmount)}  ${item.severity}  ${item.review.state}`, { font: bold, size: 9.5 });
        text(`Ref ${item.reference} - ${item.counterparty} - ${item.description}${item.sourceTransactionId ? ` - source ${item.sourceTransactionId}` : ''}`, { size: 8.5, color: muted });
        for (const f of item.findings) text(`${f.title}: ${f.rationale}`, { size: 8.5, x: margin + 10 });
    }

    heading('Limitations');
    for (const limitation of report.limitations) text(`- ${limitation}`, { size: 9 });

    const pages = pdf.getPages();
    pages.forEach((p, i) => p.drawText(safe(`FinGence PoC - synthetic data - report ${report.reportHash.slice(0, 12)} - page ${i + 1} of ${pages.length}`), { x: margin, y: 24, size: 7.5, font: regular, color: muted }));
    return pdf.save();
}
