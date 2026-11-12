#!/usr/bin/env node
// Scores an ingestion benchmark run (tests/document-ingestion/benchmark.test.ts) against the evaluation protocol in
// docs/evaluation/automated-ingestion-evaluation.md, and writes the manual verification sheet.
//
// Usage: node scripts/evaluate-ingestion.mjs <run.json> [more runs...] [--out results.md] [--sheet sheet.csv] [--sample 200]
// Later runs replace earlier results for the same document, so a document refused only for RATE_LIMITED (the free-tier
// token allowance, not the system's behaviour) can be rerun on another day and merged in. Those are the only results
// excluded; any other provider failure (for example a malformed model reply) counts as a quarantine.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const out = opt('--out', null), sheet = opt('--sheet', null), sampleSize = Number(opt('--sample', '200'));
if (!args.length) { console.error('usage: evaluate-ingestion.mjs <run.json>... [--out md] [--sheet csv] [--sample n]'); process.exit(2); }

const byId = new Map(), runs = [];
for (const path of args) {
    const run = JSON.parse(readFileSync(path, 'utf8'));
    runs.push({ path, date: run.date, complete: run.complete, documents: run.results.length });
    for (const r of run.results) byId.set(r.id, r);
}
const all = [...byId.values()];
const rateLimited = r => /AI interpretation unavailable \(RATE_LIMITED\)/.test(r.reason ?? '');
const results = all.filter(r => !rateLimited(r)), excluded = all.filter(rateLimited);

// ---- Statistics.
/** Wilson score interval, 95%. */
function wilson(k, n) {
    if (!n) return [null, null];
    const z = 1.959964, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
}
const pct = v => v === null ? '—' : `${(100 * v).toFixed(1)}%`;
const rate = (k, n) => { const [lo, hi] = wilson(k, n); return n ? `${k} / ${n} = **${pct(k / n)}** (95% CI ${pct(lo)}–${pct(hi)})` : '—'; };
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const sum = (xs, f) => xs.reduce((n, x) => n + (f(x) ?? 0), 0);

// ---- Sets.
const DIGITAL = new Set(['CSV', 'XLSX', 'PDF (text)']), SCAN = new Set(['PDF (scanned)', 'Image (JPEG)']);
const valid = results.filter(r => r.expect === 'ACCEPT' && ['FINGENCE', 'GENERATED', 'HELD_OUT', 'HELD_OUT_B'].includes(r.corpus));
const accepted = results.filter(r => r.outcome !== 'QUARANTINED');
const exact = rs => rs.filter(r => r.outcome === 'ACCEPTED_EXACT').length;
const retried = results.filter(r => r.retried);
const mustRefuse = results.filter(r => r.corpus === 'ADVERSARIAL' && r.expect === 'QUARANTINE');
// Valid-looking documents the protocol says must be refused because they do not state their own conventions.
const ambiguous = results.filter(r => !['ADVERSARIAL', 'EXTERNAL'].includes(r.corpus) && r.expect === 'QUARANTINE');
// Documents made by others (reported, not a pre-registered target of runs 5 and 6): valid ones must be read exactly or,
// where the manifest allows it, refused; tampered or out-of-scope ones must be refused.
const externalValid = results.filter(r => r.corpus === 'EXTERNAL' && r.expect !== 'QUARANTINE'), externalRefuse = results.filter(r => r.corpus === 'EXTERNAL' && r.expect === 'QUARANTINE');
const falseAcceptances = results.filter(r => r.outcome === 'FALSE_ACCEPTANCE');

// M1: with zero events the one-sided 95% upper bound is 1 - 0.05^(1/n) (about 3/n).
const m1Upper = falseAcceptances.length ? wilson(falseAcceptances.length, accepted.length)[1] : 1 - Math.pow(0.05, 1 / Math.max(1, accepted.length));
// M2: fields of accepted documents (records at the same position as a truth record).
const compared = sum(accepted, r => r.fieldsCompared), dates = sum(accepted, r => r.datesExact), amounts = sum(accepted, r => r.amountsExact);
const recordsAccepted = sum(accepted, r => r.rows), truthOfAccepted = sum(accepted, r => r.truthRows);
// M3.
const digital = valid.filter(r => DIGITAL.has(r.format)), heldDigital = digital.filter(r => r.corpus === 'HELD_OUT'), heldBDigital = digital.filter(r => r.corpus === 'HELD_OUT_B'), heldBScans = valid.filter(r => r.corpus === 'HELD_OUT_B' && SCAN.has(r.format)), scans = valid.filter(r => SCAN.has(r.format)), heldScans = scans.filter(r => r.corpus === 'HELD_OUT');
// M5.
const identified = accepted.filter(r => r.truthRole), roleOk = identified.filter(r => r.role === r.truthRole), currencyOk = identified.filter(r => r.currency === r.truthCurrency);
// M6.
const reading = results.filter(r => r.truthRows && r.readRows !== undefined);

const targets = {
    M1: falseAcceptances.length === 0,
    M2: compared > 0 && dates / compared >= 0.99 && amounts / compared >= 0.99,
    M3: digital.length > 0 && exact(digital) / digital.length >= 0.9,
    M3h: heldDigital.length > 0 && exact(heldDigital) / heldDigital.length >= 0.8,
    ...(heldBDigital.length ? { M3b: exact(heldBDigital) / heldBDigital.length >= 0.8 } : {}),
    M4: mustRefuse.length > 0 && mustRefuse.every(r => r.outcome === 'QUARANTINED'),
    M5: identified.length > 0 && roleOk.length === identified.length && currencyOk.length === identified.length,
};
const verdict = k => targets[k] ? '**Met**' : '**Not met**';

// ---- Report.
const groups = new Map();
for (const r of results) { const g = `${r.corpus} · ${r.format}`; groups.set(g, [...(groups.get(g) ?? []), r]); }
const why = r => String((r.failedGates ?? [])[0] ?? r.reason ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 150);
const md = [
    `Runs: ${runs.map(r => `\`${r.path.split('/').pop()}\` (${r.date?.slice(0, 10)}, ${r.documents} documents${r.complete ? '' : ', incomplete'})`).join('; ')}.`,
    `Documents scored: ${results.length}.${excluded.length ? ` Excluded for the provider's daily token allowance (RATE_LIMITED), not scored: ${excluded.length} (${excluded.map(r => r.id).join(', ')}).` : ''}`,
    '',
    '| # | Metric | Result | Target | Verdict |', '| --- | --- | --- | --- | --- |',
    `| M1 | False acceptances | **${falseAcceptances.length}** of ${accepted.length} accepted documents (95% upper bound ${pct(m1Upper)}) | 0 | ${verdict('M1')} |`,
    `| M2 | Data accuracy of accepted records | dates ${rate(dates, compared)}; signed amounts ${rate(amounts, compared)}; ${recordsAccepted} records accepted for ${truthOfAccepted} in the truth | ≥ 99% per field | ${verdict('M2')} |`,
    `| M3 | Straight-through, digital (FinGence + development + held-out) | ${rate(exact(digital), digital.length)} | ≥ 90% | ${verdict('M3')} |`,
    `| M3h | Straight-through, held-out digital | ${rate(exact(heldDigital), heldDigital.length)} | ≥ 80% | ${verdict('M3h')} |`,
    ...(heldBDigital.length ? [`| M3b | Straight-through, held-out set B digital | ${rate(exact(heldBDigital), heldBDigital.length)} | ≥ 80% | ${verdict('M3b')} |`] : []),
    `| M3s | Straight-through, scans and photos | ${rate(exact(scans), scans.length)}; held-out only ${rate(exact(heldScans), heldScans.length)}${heldBScans.length ? `; set B only ${rate(exact(heldBScans), heldBScans.length)}` : ''} | Reported | — |`,
    ...(ambiguous.length ? [`| — | Ambiguous-by-design documents refused | ${rate(ambiguous.filter(r => r.outcome === 'QUARANTINED').length, ambiguous.length)} | 100% | ${ambiguous.every(r => r.outcome === 'QUARANTINED') ? '**Met**' : '**Not met**'} |`] : []),
    `| M4 | Invalid documents refused | ${rate(mustRefuse.filter(r => r.outcome === 'QUARANTINED').length, mustRefuse.length)} | 100% | ${verdict('M4')} |`,
    ...(externalValid.length ? [`| — | External documents (made by others) read exactly | ${rate(exact(externalValid), externalValid.length)}; refused where allowed: ${externalValid.filter(r => r.outcome === 'QUARANTINED' && r.meets).length} | Reported | — |`] : []),
    ...(externalRefuse.length ? [`| — | External tampered or out-of-scope documents refused | ${rate(externalRefuse.filter(r => r.outcome === 'QUARANTINED').length, externalRefuse.length)} | Reported | — |`] : []),
    `| M5 | Document type and currency identified | type ${roleOk.length} / ${identified.length}; currency ${currencyOk.length} / ${identified.length} | 100% | ${verdict('M5')} |`,
    `| M6 | Rows read exactly by the proposed layout (before the checks) | ${rate(sum(reading, r => r.readExact), sum(reading, r => r.truthRows))} | Reported | — |`,
    `| M7 | Time and cost | median ${median(results.map(r => r.seconds))} s per document; ${(sum(results, r => r.seconds) / Math.max(1, sum(results, r => r.truthRows)) * 100).toFixed(1)} s per 100 rows; model cost $${sum(results, r => r.usd).toFixed(4)} in all, $${(sum(results, r => r.usd) / Math.max(1, results.filter(r => r.usd).length)).toFixed(5)} per interpreted document | Reported | — |`,
    `| — | Second attempts (one retry after a check the model can fix) | ${retried.length} documents; ${retried.filter(r => r.outcome === 'ACCEPTED_EXACT').length} then accepted exactly, ${retried.filter(r => r.outcome === 'FALSE_ACCEPTANCE').length} falsely | Reported | — |`,
    `| M8 | Manual verification of accepted records | Sheet of ${sheet ? sampleSize : 'N'} random records produced; awaiting the team's check | ≥ 99% agree | Pending |`,
    `| M9 | Ingestion time versus manual entry | Awaiting the team's timed manual entry | Reported | Pending |`,
    '',
    '### Time by format', '', '| Format | Documents | Median seconds | Median seconds per 100 rows |', '| --- | --- | --- | --- |',
    ...[...new Set(results.map(r => r.format))].map(f => { const rs = results.filter(r => r.format === f); return `| ${f} | ${rs.length} | ${median(rs.map(r => r.seconds))} | ${median(rs.filter(r => r.truthRows).map(r => r.seconds / r.truthRows * 100))?.toFixed(1) ?? '—'} |`; }),
    '',
    '### By set and format', '', '| Set · format | Documents | Accepted exactly | Quarantined | False acceptances | Meets expectation | Rows read exactly |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...[...groups].map(([g, rs]) => `| ${g} | ${rs.length} | ${exact(rs)} | ${rs.filter(r => r.outcome === 'QUARANTINED').length} | ${rs.filter(r => r.outcome === 'FALSE_ACCEPTANCE').length} | ${rs.filter(r => r.meets).length} | ${sum(rs, r => r.readExact)} / ${sum(rs, r => r.truthRows)} |`),
    '',
    '### Every valid document that was not accepted exactly', '', '| Document | Outcome | Read exactly | Why |', '| --- | --- | --- | --- |',
    ...[...valid.filter(r => r.outcome !== 'ACCEPTED_EXACT'), ...results.filter(r => r.corpus === 'AGAMI')].map(r => `| ${r.id} | ${r.outcome} | ${r.readExact} / ${r.truthRows ?? '—'}${r.sourceBalanceBreaks ? ` (source balance breaks: ${r.sourceBalanceBreaks})` : ''} | ${why(r)} |`),
];
const text = md.join('\n') + '\n';
if (out) writeFileSync(out, text); else process.stdout.write(text);

// ---- Manual verification sheet (M8): a seeded random sample of accepted records, for a person to check against the documents.
if (sheet) {
    let a = 20261106; const rnd = () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const pool = accepted.flatMap(r => (r.records ?? []).map((x, k) => ({ document: r.id, set: r.corpus, format: r.format, row: k + 1, ...x })));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const amount = c => { const n = BigInt(c), s = n < 0n ? '-' : '', v = n < 0n ? -n : n; return `${s}${v / 100n}.${String(v % 100n).padStart(2, '0')}`; };
    const cell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
    const lines = [['document', 'set', 'format', 'record', 'date', 'signed_amount', 'description', 'matches_document (Y/N)', 'note'],
        ...pool.slice(0, sampleSize).sort((x, y) => x.document.localeCompare(y.document) || x.row - y.row).map(p => [p.document, p.set, p.format, p.row, p.date, amount(p.cents), p.description, '', ''])];
    writeFileSync(sheet, lines.map(l => l.map(cell).join(',')).join('\n') + '\n');
    console.error(`Manual verification sheet: ${Math.min(sampleSize, pool.length)} of ${pool.length} accepted records -> ${sheet}`);
}
const failed = Object.entries(targets).filter(([, ok]) => !ok).map(([k]) => k);
console.error(failed.length ? `Targets not met: ${failed.join(', ')}` : 'All automated targets met.');
