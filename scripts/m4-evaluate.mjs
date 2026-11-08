import './ai-runtime-03.mjs';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PGlite } from '@electric-sql/pglite';
import { prepareI2ReportDestination, saveI2Report } from './ai-i2-report.mjs';
const { installM2Schema } = await import('../lib/server/ai-ingestion/m2/pipeline.ts');
const { createM2Identity, provisionM2Account } = await import('../lib/server/ai-ingestion/m2/identity.ts');
const { installM3Schema } = await import('../lib/server/financial-m3/management.ts');
const { createFinancialConsumers } = await import('../lib/server/financial-m3/consumers.ts');
const { installM4Schema, createM4Pipeline } = await import('../lib/server/ai-ingestion/m4/adapter.ts');
const { scoreM4 } = await import('../lib/server/ai-ingestion/m4/evaluation.ts');
const { prepareRequest } = await import('../lib/ai-ingestion/increment-03/plan.ts');
process.env.FINGENCE_AI_PYTHON ??= '.venv-ai/bin/python';
if (process.env.VERCEL || process.env.NODE_ENV === 'production' || process.argv.length !== 2)
    throw Error('OFFLINE_LOCAL_EVALUATION_ONLY');
prepareI2ReportDestination();
const pg = await PGlite.create();
const db = { close: async () => { }, transaction: work => pg.transaction(tx => work({ query: async (sql, v) => { const r = await tx.query(sql, v); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; } })) };
try {
    await pg.exec('CREATE ROLE anon;CREATE ROLE authenticated;');
    await pg.exec(readFileSync('supabase/sql/v2-verified-document-local.sql', 'utf8'));
    await installM2Schema(db);
    const password = randomBytes(24).toString('hex');
    await provisionM2Account(db, { email: 'evaluation@m4.invalid', password, organizationName: 'M4 synthetic evaluation' });
    await createM2Identity(db).login('evaluation@m4.invalid', password).then(s => s.token).then(async (token) => {
        await installM3Schema(db);
        await installM4Schema(db);
        const pipeline = createM4Pipeline(db), consumer = createFinancialConsumers(db), manifest = JSON.parse(readFileSync('synthetic/m4/manifest.json', 'utf8'));
        const results = [];
        for (const [file, entry] of Object.entries(manifest.files)) {
            const bytes = readFileSync('synthetic/m4/' + file), operation = (await pipeline.reserve(token)).id, start = performance.now();
            let error = null;
            try {
                await pipeline.process(token, operation, bytes, 'source.' + file.split('.').at(-1));
            }
            catch {
                error = 'PROCESSING_NOT_CONFIRMED';
            }
            const view = await pipeline.get(token, operation), row = (await pg.query('SELECT proposal FROM fingence_m4.inferences WHERE operation_id=$1', [operation])).rows[0];
            // Evaluation labels are loaded here, AFTER provider output and independent verification/persistence.
            const gold = JSON.parse(readFileSync('tests/fixtures/ai-ingestion-m4/gold.json', 'utf8')).cases[file];
            let score = null;
            if (view.batch?.evidence) {
                if (view.batch.source.sha256 !== entry.sha256)
                    throw Error('SOURCE_MISMATCH');
                score = scoreM4(view.batch.evidence, row?.proposal ?? null, view.batch.verification, gold, 'RECORDED_TEST', String(view.inference?.state ?? 'NOT_EXECUTED'), view.inference?.receipt ?? null);
            }
            const financial = view.batch ? await consumer.export(token, operation, 'include') : null;
            results.push({ caseId: gold.caseId, sourceSha256: entry.sha256, origin: 'RECORDED_TEST', providerState: view.inference?.state ?? 'NOT_EXECUTED', genuineModelPerformance: null, error, score, expectedExtractionFields: gold.rows.reduce((n, r) => n + r.length, 0), quarantine: view.batch?.documentQuarantine, verification: view.batch?.verification?.coverage ?? null, independentDecision: view.batch?.verification?.decision ?? null, requestTokenBound: view.batch?.evidence ? prepareRequest(view.batch.evidence).inputTokenBound + 1600 : null, financial: financial ? { selection: financial.selection, counts: financial.counts, totals: financial.analytics.map(g => ({ currency: g.currency, basis: g.monetaryBasis, total: g.sourceSignedTotal, status: g.status })) } : null, totalPipelineMs: Math.round(performance.now() - start) });
        }
        const summary = { version: 'm4-offline-evaluation-v1', origin: 'RECORDED_TEST', genuineProviderRequests: 0, genuineModelPerformance: null, cases: results.length, completed: results.filter(r => r.providerState === 'COMPLETED').length, failedOrUnknown: results.filter(r => r.error || r.providerState !== 'COMPLETED').length, accepted: results.reduce((n, r) => n + (r.verification?.accepted ?? 0), 0), rejected: results.reduce((n, r) => n + (r.verification?.rejected ?? 0), 0), unresolved: results.reduce((n, r) => n + (r.verification?.unresolved ?? 0), 0), falseAccepted: results.reduce((n, r) => n + (r.score?.acceptance?.falseAccepted ?? 0), 0), extractionExactFields: results.reduce((n, r) => n + (r.score?.extraction.exactFields ?? 0), 0), extractionExpectedFields: results.reduce((n, r) => n + (r.expectedExtractionFields), 0), results };
        const paths = saveI2Report(summary, `M4 OFFLINE RECORDED_TEST controls\nCases: ${summary.cases}; completed: ${summary.completed}; failed/unknown: ${summary.failedOrUnknown}\nAccepted/rejected/unresolved: ${summary.accepted}/${summary.rejected}/${summary.unresolved}\nFalse acceptance versus source-authored labels: ${summary.falseAccepted}\nLiteral extraction: ${summary.extractionExactFields}/${summary.extractionExpectedFields}\nGenuine model requests: 0; genuine model accuracy: unavailable.\n`);
        console.log(JSON.stringify({ cases: summary.cases, completed: summary.completed, accepted: summary.accepted, rejected: summary.rejected, unresolved: summary.unresolved, falseAccepted: summary.falseAccepted, extractionExactFields: summary.extractionExactFields, extractionExpectedFields: summary.extractionExpectedFields, genuineModelPerformance: null, ...paths }));
    });
}
finally {
    await pg.close();
}
