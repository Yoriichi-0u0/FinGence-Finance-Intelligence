import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, lstatSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import { createHash } from 'node:crypto';
if (process.env.VERCEL || process.env.NODE_ENV === 'production' || !process.versions.node.startsWith('24.'))
    throw Error('LOCAL_NODE_24_REQUIRED');
Object.assign(process.env, { NODE_ENV: 'development', FINGENCE_AI_LOCAL: '1', FINGENCE_V2_I1_LOCAL: '1', FINGENCE_M2_LOCAL: '1', FINGENCE_M3_LOCAL: '1', FINGENCE_M4_LOCAL: '1' });
if (existsSync('.venv-ai/bin/python'))
    process.env.FINGENCE_AI_PYTHON ??= '.venv-ai/bin/python';
const command = process.argv[2];
if (command === 'serve') {
    const require = createRequire(import.meta.url), env = { ...process.env, FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED: '', FINGENCE_AI03_OLLAMA_DISPATCH_AUTHORIZED: '', FINGENCE_M4_SINGLE_DISPATCH_AUTHORIZED: '' };
    const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3184'], { env, stdio: 'inherit' });
    for (const s of ['SIGINT', 'SIGTERM'])
        process.on(s, () => child.kill(s));
    child.on('exit', c => { process.exitCode = c ?? 1; });
}
else if (command === 'account') {
    process.argv[2] = 'account';
    await import('./m3.mjs');
}
else {
    await import('./ai-runtime-03.mjs');
    const { m4Runtime } = await import('../lib/server/ai-ingestion/m4/runtime.ts');
    const { closeM2Runtime } = await import('../lib/server/ai-ingestion/m2/runtime.ts');
    if (command === 'dispatch-one' && (process.argv.length !== 5 || process.env.FINGENCE_M4_SINGLE_DISPATCH_AUTHORIZED !== '1' || !process.env.FINGENCE_M4_AUTHORIZATION_ID || !process.env.GROQ_API_KEY || process.env.FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED !== '1' || process.env.FINGENCE_AI03_FREE_PLAN_CONFIRMED !== '1'))
        throw Error('SEPARATE_LIVE_AUTHORIZATION_REQUIRED');
    try {
        const runtime = await m4Runtime(), session = await runtime.identity.login(process.env.M2_LOCAL_EMAIL ?? '', process.env.M2_LOCAL_PASSWORD ?? '');
        const path = resolve(process.argv[3] ?? ''), bytes = readFileSync(path);
        const { registeredM2Source } = await import('../lib/server/ai-ingestion/m2/pipeline.ts');
        if (!await registeredM2Source(bytes))
            throw Error('REGISTERED_SYNTHETIC_REQUIRED');
        const { extractTrustedEvidence } = await import('../lib/server/ai-ingestion/v2-i1/persistence.ts');
        const { prepareRequest } = await import('../lib/ai-ingestion/increment-03/plan.ts');
        const evidence = await extractTrustedEvidence(bytes, 'source' + extname(path)), request = prepareRequest(evidence);
        if (command === 'prepare') {
            const operation = await runtime.pipeline.reserve(session.token), manifest = { version: 'm4-proposed-dispatch-v1', operationId: operation.id, userId: session.principal.user_id, organizationId: session.principal.organization_id, membershipVersion: session.principal.version, sourceSha256: createHash('sha256').update(bytes).digest('hex'), promptHash: request.promptHash, policyHash: request.policyHash, promptRevision: request.promptRevision, model: 'openai/gpt-oss-20b', requestTokenBound: request.inputTokenBound + 1600, authorizationCreated: false, dispatchEnabled: false };
            const folder = resolve('.local/m4-prepared');
            mkdirSync(folder, { recursive: true, mode: 0o700 });
            const s = lstatSync(folder);
            if (s.isSymbolicLink() || (s.mode & 0o077))
                throw Error('UNSAFE_PREPARATION_PATH');
            const file = join(folder, operation.id + '.json');
            writeFileSync(file, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
            console.log(JSON.stringify({ operationId: operation.id, manifest: file, authorizationCreated: false, providerDispatches: 0, requestTokenBound: manifest.requestTokenBound }));
        }
        else if (command === 'dispatch-one') {
            const { prepareI2ReportDestination, saveI2Report } = await import('./ai-i2-report.mjs');
            prepareI2ReportDestination();
            const { canonicalQuotaDirectory, prepareAuthorizedGroq } = await import('../lib/server/ai-ingestion/m4/authorization.ts');
            const { createM4Pipeline } = await import('../lib/server/ai-ingestion/m4/adapter.ts');
            const folder = canonicalQuotaDirectory();
            const pipeline = createM4Pipeline(runtime.database, { origin: 'LIVE_GROQ', prepare: async (e, c) => prepareAuthorizedGroq(e, c, { folder, authorizationId: process.env.FINGENCE_M4_AUTHORIZATION_ID }) }), id = process.argv[4];
            let error = null;
            try {
                await pipeline.process(session.token, id, bytes, 'source' + extname(path));
            }
            catch {
                error = 'PROCESSING_NOT_CONFIRMED';
            }
            const view = await pipeline.get(session.token, id), report = { version: 'm4-owner-live-run-v1', sourceSha256: evidence.sourceId, operationId: id, promptHash: request.promptHash, policyHash: request.policyHash, view, error, evaluation: null, automaticRetries: 0 };
            const row = await runtime.database.transaction(async (tx) => (await tx.query('SELECT proposal,receipt,state,origin FROM fingence_m4.inferences WHERE operation_id=$1 AND organization_id=$2', [id, session.principal.organization_id])).rows[0]);
            if (view.batch?.evidence && row) {
                const labels = JSON.parse(readFileSync('tests/fixtures/ai-ingestion-m4/gold.json', 'utf8'));
                const gold = Object.values(labels.cases).find(g => g.sourceSha256 === evidence.sourceId);
                if (gold) {
                    const { scoreM4 } = await import('../lib/server/ai-ingestion/m4/evaluation.ts');
                    const score = scoreM4(view.batch.evidence, row.proposal, view.batch.verification, gold, 'LIVE_GROQ', String(row.state), row.receipt);
                    report.evaluation = { ...score, genuineModelPerformance: row.origin === 'LIVE_GROQ' && row.state === 'COMPLETED' ? score.liveCandidateMetrics : null };
                }
            }
            const saved = saveI2Report(report, `M4 owner-authorized experiment\nOrigin: ${view.inference?.origin ?? 'NOT_EXECUTED'}\nState: ${view.inference?.state ?? 'NOT_EXECUTED'}\nVerification: ${view.batch?.verification?.decision ?? 'unavailable'}\nNo automatic retry. Inspect the original operation and shared quota/global dispatch fence if uncertain.\n`);
            console.log(JSON.stringify({ operationId: id, origin: view.inference?.origin ?? 'NOT_EXECUTED', state: view.inference?.state ?? 'NOT_EXECUTED', error, ...saved }));
            if (error)
                process.exitCode = 2;
        }
        else
            throw Error('USE_PREPARE_OR_DISPATCH_ONE');
    }
    finally {
        await closeM2Runtime();
    }
}
