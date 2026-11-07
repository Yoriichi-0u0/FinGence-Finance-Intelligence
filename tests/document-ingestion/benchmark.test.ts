/**
 * LIVE ingestion-layer benchmark (opt-in, billable): FINGENCE_INGESTION_BENCHMARK=1 with GROQ_API_KEY (and optionally
 * GROQ_API_KEY2). Every document of the corpus goes through `ingestDocuments` with the ingestion scope (any months,
 * any stated currency) and the live layout interpreter; each accepted document's canonical rows are compared, in
 * order, with its ground truth (date and signed amount of every transaction). A false acceptance is an accepted
 * document whose rows differ. Corpus:
 *  - FinGence public samples in every format (CSV, XLSX, text PDF, scanned PDF, JPEG), ground truth = Phase 1 canonical files;
 *  - adversarial fixtures (expected quarantined, a few acceptable);
 *  - AgamiAI/Indian-Bank-Statements (Apache-2.0, synthetic), digital and scanned PDFs with JSON ground truth, from
 *    FINGENCE_BENCH_AGAMI_DIR (default .local/datasets/agami; not committed);
 *  - the generated development corpus (FINGENCE_BENCH_CORPUS_DIR) and the HELD-OUT corpus (FINGENCE_BENCH_HELDOUT_DIR,
 *    `generate-statement-corpus.mjs --held-out`): layouts never used while FinGence was developed, for the evaluation,
 *    and held-out set B (FINGENCE_BENCH_HELDOUT_B_DIR, `--held-out-b`), fixed after run 5 to re-test its fixes.
 * Each result also records the role and currency FinGence decided, against the truth, and the accepted records
 * (date, signed cents, description) for the manual verification sample (scripts/evaluate-ingestion.mjs).
 * FINGENCE_BENCH_OUT (JSON path; a .md summary is written next to it), FINGENCE_BENCH_ONLY (substring filter),
 * FINGENCE_BENCH_CORPUS (comma-separated corpus names, e.g. FINGENCE,ADVERSARIAL, to run a regression part on its own),
 * FINGENCE_BENCH_IDS (a file of document ids, one per line, to rerun only the documents a run left RATE_LIMITED).
 */
import { describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Papa from 'papaparse';
vi.mock('server-only', () => ({}));
import { ingestDocuments, INGESTION_SCOPE, type DocumentInput } from '../../lib/document-ingestion/ingest';
import { InterpreterUnavailable, parseProposal, type LayoutInterpreter } from '../../lib/interpretation/contracts';
import { readTable } from '../../lib/interpretation/evidence';
import { parseAmount, parseDate } from '../../lib/interpretation/formats';
import { proposeLayout } from '../../lib/server/ai/groq-interpreter';
import { stopOcr } from '../../lib/interpretation/ocr';

const LIVE = process.env.FINGENCE_INGESTION_BENCHMARK === '1' && !!process.env.GROQ_API_KEY;
const AGAMI = process.env.FINGENCE_BENCH_AGAMI_DIR ?? '.local/datasets/agami';
const CORPUS = process.env.FINGENCE_BENCH_CORPUS_DIR ?? '.local/benchmark/corpus';
const HELDOUT = process.env.FINGENCE_BENCH_HELDOUT_DIR ?? '.local/benchmark/heldout';
const HELDOUT_B = process.env.FINGENCE_BENCH_HELDOUT_B_DIR ?? '.local/benchmark/heldout-b';
// External documents made by others (Bankstatemently, Synthetic Indonesian Bank Statements; not committed): a manifest whose
// truth is read with an independent PDF reader and checked against each statement's own arithmetic, expectations fixed in it.
const EXTERNAL = process.env.FINGENCE_BENCH_EXTERNAL_DIR ?? '.local/datasets/external';
const only = process.env.FINGENCE_BENCH_ONLY;
const corpora = process.env.FINGENCE_BENCH_CORPUS?.split(',').map(c => c.trim()).filter(Boolean);
// A result id may carry a worksheet ("book.xlsx › Sheet"); the case is the file, so only the part before " › " counts.
const ids = process.env.FINGENCE_BENCH_IDS ? new Set(readFileSync(process.env.FINGENCE_BENCH_IDS, 'utf8').split('\n').map(l => l.split(' › ')[0].trim()).filter(Boolean)) : null;
type Truth = { date: string; cents: bigint }[];
/**
 * Reading accuracy, independent of acceptance: the rows the model's proposed layout reads from the document's table
 * (every line under the header with a date in the date column), compared with the truth. Used to report how well a
 * quarantined document was READ when the quarantine is the document's own fault (an inconsistent running balance).
 */
function readUnderProposal(tableBytes: Uint8Array, proposal: unknown): Truth {
    const parsed = parseProposal(proposal), table = readTable(tableBytes);
    if (!parsed.success || !table || parsed.data.role === 'UNSUPPORTED') return [];
    const p = parsed.data, c = p.columns, cell = (r: string[], i: number | null) => i === null ? '' : (r[i] ?? '').trim();
    const inflow = p.directionTokens.inflow.map(t => t.toUpperCase()), out: Truth = [];
    for (const row of table.rows.slice(p.headerLine + 1)) {
        const date = parseDate(cell(row, c.date), p.dateFormat!);
        if (!date) continue;
        const amount = (i: number | null) => parseAmount(cell(row, i), p.numberFormat!) ?? 0n;
        const v = p.representation === 'SIGNED_AMOUNT' ? amount(c.amount) : p.representation === 'AMOUNT_AND_DIRECTION' ? (inflow.includes(cell(row, c.direction).toUpperCase()) ? 1n : -1n) * amount(c.amount)
            : p.representation === 'SPLIT_IN_OUT' ? amount(c.moneyIn) - amount(c.moneyOut) : amount(c.debit) - amount(c.credit);
        out.push({ date, cents: v });
    }
    return out;
}
/** Breaks in the truth's own running balance (an error in the source document, not in FinGence's reading). */
function truthBalanceBreaks(json: string) {
    const d = JSON.parse(readFileSync(json, 'utf8')) as { transactions: Record<string, unknown>[] }, tx = d.transactions;
    const bal = (t: Record<string, unknown>) => cents((t.balance ?? t.available_balance) as number);
    const truth = agamiTruth(json);
    return tx.slice(1).filter((t, i) => bal(t) - bal(tx[i]) !== truth[i + 1].cents).length;
}
type Expect = 'ACCEPT' | 'QUARANTINE' | 'EXACT_OR_QUARANTINE';
type Meta = { role: string; currency: string };
type Case = { id: string; format: string; corpus: 'FINGENCE' | 'ADVERSARIAL' | 'AGAMI' | 'GENERATED' | 'HELD_OUT' | 'HELD_OUT_B' | 'EXTERNAL'; file: string; expect: Expect; truth: (name: string) => Truth | null; meta?: (name: string) => Meta };

const cents = (v: string | number) => { const [w, f = ''] = String(typeof v === 'number' ? v.toFixed(2) : v).replace(/,/g, '').split('.'); const n = BigInt(w.replace('-', '')) * 100n + BigInt((f + '00').slice(0, 2)); return String(v).trim().startsWith('-') ? -n : n; };
const csvRows = (path: string) => Papa.parse<Record<string, string>>(readFileSync(path, 'utf8'), { header: true, skipEmptyLines: true }).data;
const bankTruth: Truth = csvRows('public/demo/demo-bank-statement-2026-03.csv').map(r => ({ date: r.ValueDate, cents: cents(r.SignedCashMovementMYR) }));
const ledgerTruth: Truth = csvRows('public/demo/demo-general-ledger-2026-03.csv').map(r => ({ date: r.PostingDate, cents: cents(r.SignedCashMovementMYR) }));
const byRole = (name: string) => /ledger|Cash ledger/i.test(name) ? ledgerTruth : bankTruth;
const fingenceMeta = (name: string): Meta => ({ role: /ledger|Cash ledger/i.test(name) ? 'GENERAL_LEDGER' : 'BANK_STATEMENT', currency: 'MYR' });
const iso = (d: string) => /^\d{2}\/\d{2}\/\d{4}/.test(d) ? `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}` : d.slice(0, 10);
function agamiTruth(json: string): Truth {
    const d = JSON.parse(readFileSync(json, 'utf8')) as { transactions: Record<string, unknown>[] };
    return d.transactions.map(t => ({
        date: iso(String(t.value_date ?? t.date)),
        cents: 'transaction_amount' in t ? (t.cr_dr === 'CR' ? 1n : -1n) * cents(t.transaction_amount as number) : cents((t.credit as number | null) ?? 0) - cents((t.debit as number | null) ?? 0),
    }));
}

const U = 'public/demo/unfamiliar', F = 'tests/fixtures/interpretation';
const cases: Case[] = [
    ...['bank-statement-march-2026-export.csv', 'general-ledger-cash-march-2026.csv', 'penyata-bank-mac-2026.csv', 'ledger-signed-march-2026.csv'].map(f => ({ id: f, format: 'CSV', corpus: 'FINGENCE' as const, file: join(U, f), expect: 'ACCEPT' as const, truth: byRole, meta: fingenceMeta })),
    { id: 'rimba-demo-kitchen-march-2026.xlsx', format: 'XLSX', corpus: 'FINGENCE', file: join(U, 'rimba-demo-kitchen-march-2026.xlsx'), expect: 'ACCEPT', truth: byRole, meta: fingenceMeta },
    ...['bank-statement-march-2026.pdf', 'general-ledger-cash-march-2026.pdf'].map(f => ({ id: f, format: 'PDF (text)', corpus: 'FINGENCE' as const, file: join(U, f), expect: 'ACCEPT' as const, truth: byRole, meta: fingenceMeta })),
    ...['bank-statement-march-2026-scan.pdf', 'general-ledger-cash-march-2026-scan.jpg'].map(f => ({ id: f, format: f.endsWith('.pdf') ? 'PDF (scanned)' : 'Image (JPEG)', corpus: 'FINGENCE' as const, file: join(U, f), expect: 'ACCEPT' as const, truth: byRole, meta: fingenceMeta })),
    ...([['bank-debit-credit-no-balance.csv', 'ACCEPT'], ['bank-dr-cr-no-balance.csv', 'ACCEPT'], ['prompt-injection-in-cell.csv', 'EXACT_OR_QUARANTINE'],
        ...['opaque-headings-no-balance.csv', 'corrupted-running-balance.csv', 'mislabelled-withdrawal-deposit.csv', 'usd-statement.csv', 'staff-roster.csv', 'signed-amount-reversed-no-balance.csv', 'ledger-signed-opaque-no-balance.csv', 'ledger-multiple-accounts.csv', 'ledger-sales-account.csv', 'ledger-bank-loan-account.csv', 'ledger-no-account-evidence.csv', 'bank-ambiguous-debit-credit.csv'].map(f => [f, 'QUARANTINE'])] as [string, Expect][])
        .map(([f, expect]) => ({ id: f, format: 'CSV', corpus: 'ADVERSARIAL' as const, file: join(F, f), expect, truth: () => bankTruth })),
    // The generated corpora (scripts/generate-statement-corpus.mjs): every document is valid and must be read exactly.
    ...[[CORPUS, 'corpus', 'GENERATED'], [HELDOUT, 'heldout', 'HELD_OUT'], [HELDOUT_B, 'heldout-b', 'HELD_OUT_B'], [EXTERNAL, 'external', 'EXTERNAL']].flatMap(([dir, prefix, corpus]) => existsSync(join(dir, 'manifest.json')) ? (JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { documents: { file: string; format: string; truth: string; expect?: Expect }[] }).documents.map(d => {
        const truth = () => JSON.parse(readFileSync(join(dir, d.truth), 'utf8')) as Meta & { transactions: { date: string; cents: string }[] };
        return { id: `${prefix}/${d.file}`, format: d.format, corpus: corpus as Case['corpus'], file: join(dir, d.file), expect: d.expect ?? 'ACCEPT' as Expect,
            truth: () => truth().transactions.map(t => ({ date: t.date, cents: BigInt(t.cents) })), meta: () => ({ role: truth().role, currency: truth().currency }) };
    }) : []),
    ...(existsSync(AGAMI) ? readdirSync(AGAMI).flatMap(type => readdirSync(join(AGAMI, type)).filter(f => f.endsWith('.pdf')).map(f => ({
        id: `agami/${type}/${f}`, format: /Scanned/.test(type) ? 'PDF (scanned)' : 'PDF (text)', corpus: 'AGAMI' as const, file: join(AGAMI, type, f), expect: 'ACCEPT' as const,
        truth: () => agamiTruth(join(AGAMI, type, f.replace(/\.pdf$/, '.json'))), meta: () => ({ role: 'BANK_STATEMENT', currency: 'INR' }),
    }))) : []),
];
// The USD fixture is a valid statement in another currency: under the ingestion scope it is acceptable, exactly.
for (const c of cases) if (c.id === 'usd-statement.csv') c.expect = 'EXACT_OR_QUARANTINE';
// Protocol amendment for run 6 (fixed before it, see docs/evaluation): held-out set A's signed USD ledger never states
// which sign is cash in and has no running balance, so refusing it is the correct outcome, not a miss.
for (const c of cases) if (c.id.startsWith('heldout/ledger-usd-signed-')) c.expect = 'QUARANTINE';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
/** The live interpreter; a 429 (refused, never billed) is waited out and asked again, as many times as needed. */
const live: LayoutInterpreter = {
    async propose(evidence) {
        for (let attempt = 0; ; attempt++) {
            try { return await proposeLayout(evidence); }
            catch (error) {
                // A long Retry-After is a daily cap: give up on this document rather than stall the run.
                if (!(error instanceof InterpreterUnavailable) || error.code !== 'RATE_LIMITED' || attempt > 20 || (error.retryAfterSeconds ?? 0) > 150) throw error;
                await sleep(((error.retryAfterSeconds ?? 20) + 1) * 1000);
            }
        }
    },
};

describe.skipIf(!LIVE)('live ingestion-layer benchmark', () => {
    it('ingests every format; zero false acceptances', async () => {
        const results: Record<string, unknown>[] = [];
        const out = process.env.FINGENCE_BENCH_OUT ?? `.local/benchmark/ingestion-${new Date().toISOString().slice(0, 10)}.json`;
        const save = (complete: boolean) => { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), complete, results }, null, 2)); };
        for (const c of cases.filter(x => (!only || x.id.includes(only)) && (!corpora?.length || corpora.includes(x.corpus)) && (!ids || ids.has(x.id)))) {
            const started = Date.now(), input: DocumentInput = { name: basename(c.file), bytes: new Uint8Array(readFileSync(c.file)), provenance: 'USER_SUPPLIED' };
            // The evidence the interpreter is shown carries the table it was read from; keep the tables, in order, for reading accuracy.
            const tables: Uint8Array[] = [];
            const capturing: LayoutInterpreter = { async propose(e) { tables.push(lastTable!); return live.propose(e); } };
            let lastTable: Uint8Array | null = null;
            const { documents, effective } = await ingestDocuments([input], { interpreter: capturing, scope: INGESTION_SCOPE, onTable: t => { lastTable = t; } });
            let interpreted = 0;
            const tableOf = (i: number) => documents[i].interpretation ? tables[interpreted++] ?? new Uint8Array() : new Uint8Array();
            documents.forEach((d, i) => {
                const accepted = d.decision === 'AUTO_ACCEPTED' && !!d.interpretation;
                const rows = accepted ? Papa.parse<Record<string, string>>(new TextDecoder().decode(effective[i]), { header: true, skipEmptyLines: true }).data : [];
                const got = rows.map(r => ({ date: r.ValueDate ?? r.PostingDate, cents: cents(r.SignedCashMovementMYR) }));
                const truth = c.truth(d.name);
                const mismatches = truth ? got.map((g, k) => truth[k] && g.date === truth[k].date && g.cents === truth[k].cents ? null : k).filter(k => k !== null) : [];
                const exact = accepted && !!truth && got.length === truth.length && !mismatches.length;
                const outcome = !accepted ? 'QUARANTINED' : exact ? 'ACCEPTED_EXACT' : 'FALSE_ACCEPTANCE';
                const meets = c.expect === 'ACCEPT' ? outcome === 'ACCEPTED_EXACT' : c.expect === 'QUARANTINE' ? outcome === 'QUARANTINED' : outcome !== 'FALSE_ACCEPTANCE';
                // How well the document was READ, whatever the gates decided (the input table is the extracted one, before canonical form).
                const reading = d.interpretation?.proposal && truth ? readUnderProposal(tableOf(i), d.interpretation.proposal) : [];
                const readExact = reading.filter((g, k) => truth?.[k] && g.date === truth[k].date && g.cents === truth[k].cents).length;
                const sourceBreaks = c.corpus === 'AGAMI' ? truthBalanceBreaks(c.file.replace(/\.pdf$/, '.json')) : null;
                const r = d.interpretation?.receipt, meta = c.meta?.(d.name) ?? null;
                // Field by field, for every accepted row that has a truth row at its position.
                const paired = truth ? got.map((g, k) => [g, truth[k]] as const).filter(([, t]) => !!t) : [];
                const row = {
                    id: documents.length > 1 ? `${c.id} › ${d.source && 'sheet' in d.source ? d.source.sheet : i}` : c.id, corpus: c.corpus, format: c.format, expect: c.expect, outcome, meets,
                    rows: got.length, truthRows: truth?.length ?? null, firstMismatch: mismatches[0] ?? null,
                    datesExact: paired.filter(([g, t]) => g.date === t.date).length, amountsExact: paired.filter(([g, t]) => g.cents === t.cents).length, fieldsCompared: paired.length,
                    role: d.role, truthRole: meta?.role ?? null, truthCurrency: meta?.currency ?? null,
                    records: rows.map(x => ({ date: x.ValueDate ?? x.PostingDate, cents: String(cents(x.SignedCashMovementMYR)), description: x.BankDescription ?? x.LedgerMemo ?? '' })),
                    readRows: reading.length, readExact, sourceBalanceBreaks: sourceBreaks,
                    months: accepted ? [...new Set(got.map(g => g.date.slice(0, 7)))].length : null, currency: rows[0]?.Currency ?? null,
                    source: d.source && 'kind' in d.source ? d.source.kind : null, ocrConfidence: d.source && 'confidence' in d.source ? d.source.confidence : null,
                    ocrResolved: d.interpretation?.checks.find(k => k.id === 'ocr-readings')?.detail ?? null,
                    failedGates: d.interpretation?.checks.filter(k => !k.passed).map(k => `${k.id}: ${k.detail}`) ?? [], reason: d.reason,
                    model: r?.model ?? null, latencyMs: r?.latencyMs ?? null, inputTokens: r ? (r.inputTokens ?? 0) + (d.interpretation?.firstAttempt?.receipt.inputTokens ?? 0) : null, outputTokens: r ? (r.outputTokens ?? 0) + (d.interpretation?.firstAttempt?.receipt.outputTokens ?? 0) : null, usd: r ? (r.estimatedUsd ?? 0) + (d.interpretation?.firstAttempt?.receipt.estimatedUsd ?? 0) : null, retried: d.interpretation?.firstAttempt?.check ?? null, seconds: Math.round((Date.now() - started) / 100) / 10,
                };
                results.push(row);
                console.log(JSON.stringify({ id: row.id, outcome, meets, rows: row.rows, truth: row.truthRows, failed: row.failedGates.slice(0, 2), seconds: row.seconds }));
            });
            save(false);
        }
        save(true);
        await stopOcr();
        // Markdown summary by corpus and format.
        const groups = new Map<string, Record<string, unknown>[]>();
        for (const r of results) groups.set(`${r.corpus} · ${r.format}`, [...(groups.get(`${r.corpus} · ${r.format}`) ?? []), r]);
        const md = ['# FinGence ingestion-layer benchmark', '', `Run ${new Date().toISOString()} · model ${results.find(r => r.model)?.model ?? '—'} · ${results.length} documents`, '',
            '| Corpus · format | Documents | Accepted exact | Quarantined | False acceptances | Meets expectation | Rows read exactly |', '| --- | --- | --- | --- | --- | --- | --- |',
            ...[...groups].map(([g, rs]) => `| ${g} | ${rs.length} | ${rs.filter(r => r.outcome === 'ACCEPTED_EXACT').length} | ${rs.filter(r => r.outcome === 'QUARANTINED').length} | ${rs.filter(r => r.outcome === 'FALSE_ACCEPTANCE').length} | ${rs.filter(r => r.meets).length} | ${rs.reduce((n, r) => n + (r.readExact as number), 0)} / ${rs.reduce((n, r) => n + ((r.truthRows as number | null) ?? 0), 0)} |`),
            '', '| Document | Expect | Outcome | Rows (truth) | Read exactly | Source balance errors | Months | Currency | Source | Seconds | Why quarantined |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
            ...results.map(r => `| ${r.id} | ${r.expect} | ${r.outcome} | ${r.rows} (${r.truthRows ?? '—'}) | ${r.readExact}/${r.truthRows ?? '—'} | ${r.sourceBalanceBreaks ?? '—'} | ${r.months ?? '—'} | ${r.currency ?? '—'} | ${r.source ?? 'table'}${r.ocrConfidence ? ` ${r.ocrConfidence}%` : ''} | ${r.seconds} | ${r.outcome === 'QUARANTINED' ? String((r.failedGates as string[])[0] ?? r.reason).replace(/\|/g, '/').slice(0, 140) : ''} |`)];
        writeFileSync(out.replace(/\.json$/, '.md'), md.join('\n') + '\n');
        expect(results.filter(r => r.outcome === 'FALSE_ACCEPTANCE')).toEqual([]);
    }, 7_200_000);
});
