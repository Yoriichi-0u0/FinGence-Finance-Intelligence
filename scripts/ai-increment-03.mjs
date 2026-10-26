import './ai-runtime-03.mjs';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
const { processLiveDocument03, providerStatus03 } = await import('../lib/server/ai-ingestion/increment-03/service.ts');
const { scoreExtraction, scoreAccepted, pendingCases, resumeArgument, assertSourceDigest } = await import('../lib/ai-ingestion/increment-03/metrics.ts');
const { QuotaLedger } = await import('../lib/server/ai-ingestion/increment-03/quota.ts');
const [command = 'doctor', ...args] = process.argv.slice(2), live = args.includes('--live'), folder = resolve('.ai-local/increment-03');
// Default CLI operation cannot dispatch, even if activation flags were inherited.
if (!live) { process.env.FINGENCE_AI03_GROQ_DISPATCH_AUTHORIZED = '0'; process.env.FINGENCE_AI03_OLLAMA_DISPATCH_AUTHORIZED = '0'; }
process.env.FINGENCE_AI_PYTHON ??= resolve(process.platform === 'win32' ? '.venv-ai/Scripts/python.exe' : '.venv-ai/bin/python');
if (command === 'doctor') {
 console.log(JSON.stringify({ mode: 'NO_INFERENCE', node: process.version, platform: process.platform, pythonPresent: existsSync(process.env.FINGENCE_AI_PYTHON), provider: providerStatus03(), quota: new QuotaLedger(folder).summary(), credentialValuesPrinted: false }, null, 2));
} else if (command === 'run') {
 const file = args.find(a => !a.startsWith('--')); if (!file) throw new Error('Use run <registered synthetic path> [--live]');
 const r = await processLiveDocument03(readFileSync(file), basename(file)); mkdirSync(folder, { recursive: true, mode: 0o700 });
 const output = resolve(folder, `${r.runId}.json`); writeFileSync(output, JSON.stringify(r, null, 2), { mode: 0o600 });
 console.log(JSON.stringify({ mode: r.mode, source: r.evidence?.sourceId, counts: r.verification?.coverage ?? null, error: r.error, report: output }));
 if (r.error || r.mode === 'NOT_EXECUTED') process.exitCode = 2;
} else if (command === 'evaluate') {
 // Labels are evaluation-only, loaded here after runtime modules. The model receives none of them.
 const split = args.includes('--regression') ? 'regression' : 'heldout';
 const sourceFolder = split === 'heldout' ? 'public/samples/ai-ingestion-increment-03' : 'public/samples/ai-ingestion-increment-02';
 const manifest = JSON.parse(readFileSync(`${sourceFolder}/manifest.json`, 'utf8')).files;
 const labels = split === 'heldout' ? JSON.parse(readFileSync('tests/fixtures/ai-ingestion-03/ground-truth.json', 'utf8')).cases : null;
 const rawLabels = split === 'heldout' ? JSON.parse(readFileSync('tests/fixtures/ai-ingestion-03/field-truth.json', 'utf8')) : JSON.parse(readFileSync('tests/fixtures/ai-ingestion-02/field-truth.json', 'utf8'));
 const regressionTruth = split === 'regression' ? JSON.parse(readFileSync('tests/fixtures/ai-ingestion-02/ground-truth.json', 'utf8')) : null;
 const resumePath = resumeArgument(args);
 const previous = resumePath ? JSON.parse(readFileSync(resumePath, 'utf8')) : null;
 const providerProfile = providerStatus03(); const { policyHash } = await import('../lib/ai-ingestion/increment-03/plan.ts');
 if (previous && (!live || previous.inferenceRequested !== true || previous.split !== split || previous.guided !== !args.includes('--unguided') || previous.policyHash !== policyHash || previous.provider?.provider !== providerProfile.provider || previous.provider?.model !== providerProfile.model)) throw new Error('RESUME_PROFILE_MISMATCH');
 const pending = pendingCases(manifest, previous?.reports ?? []);
 const reports = previous ? previous.reports.filter(r => r.inference !== null) : []; mkdirSync(folder, { recursive: true, mode: 0o700 });
 for (const name of pending) {
  const sourceBytes = readFileSync(`${sourceFolder}/${name}`); assertSourceDigest(sourceBytes, manifest[name].sha256);
  const r = await processLiveDocument03(sourceBytes, `source${extname(name)}`, () => {}, undefined, undefined, !args.includes('--unguided'));
  writeFileSync(resolve(folder, `${r.runId}.json`), JSON.stringify(r), { mode: 0o600 });
  const stem = name.replace(/\.[^.]+$/, ''), family = regressionTruth?.formatFamilyAliases[stem] ?? stem;
  const expected = labels?.[name], raw = rawLabels[split === 'heldout' ? name : family];
  let acceptedTruth = expected?.accepted ?? [];
  if (regressionTruth) {
    const l = regressionTruth.families[family];
    const pairs = { amounts: 'source_amount', dates: 'transaction_date', postings: 'posting_date', currencies: 'currency', debits: 'debit', credits: 'credit', directions: 'entry_side', accountCodes: 'account_code' };
    acceptedTruth = (l.ids ?? []).slice(0, l.accepted).map((id, n) => Object.fromEntries([['source_transaction_id', id], ...Object.entries(pairs).filter(([key]) => l[key]).map(([key, field]) => [field, l[key][n]])]));
  }
  const scores = r.receipt ? scoreAccepted(r.verification?.accepted ?? [], acceptedTruth) : { exactAccepted: null, falseAccepted: null, eligibleWithheld: null };
  reports.push({ file: name, sha256: manifest[name].sha256, mode: r.mode, runId: r.runId, format: r.evidence?.format ?? null, extractionMs: r.evidence?.durationMs ?? null,
   observedRows: r.evidence ? new Set(r.evidence.items.filter(i => i.table !== null && !i.header && i.row !== null && i.text.trim()).map(i => `${i.table}:${i.row}`)).size : null, requestTokenBound: r.requestTokenBound, coverageEstablished: r.evidence?.coverage === 'TABLE_ROWS', evidenceItems: r.evidence?.items.length ?? 0,
   inference: r.receipt, dispatch: r.dispatch, error: r.error, proposalSchemaVerified: r.blueprint !== null, counts: r.verification?.coverage ?? null,
   ...scores, mapping: r.receipt && raw?.roles ? { correctFields: raw.headers.filter((h, n) => r.blueprint?.fields.some(f => f.column.toLowerCase().replace(/[^a-z0-9]/g, '') === h.toLowerCase().replace(/[^a-z0-9]/g, '') && f.role === raw.roles[n])).length, expectedFields: raw.headers.length } : null, extraction: raw ? scoreExtraction(r.evidence, raw) : null, expectedUnresolvedIds: expected?.unresolvedIds ?? null, runtimeMs: r.runtimeMs });
  console.log(JSON.stringify(reports.at(-1)));
  if (r.error?.startsWith('QUOTA_') || r.mode === 'DISPATCHED_UNKNOWN') break;
 }
 const result = { version: 'evaluation-0.3', policyHash, provider: providerProfile, resumedFrom: resumePath ? basename(resumePath) : null, split, inferenceRequested: live, guided: !args.includes('--unguided'), genuineInferenceRuns: reports.filter(r => r.mode === 'LIVE_GROQ' || r.mode === 'LIVE_OLLAMA').length,
  expectedDocuments: Object.keys(manifest).length, processedDocuments: reports.length, evaluationComplete: reports.length === Object.keys(manifest).length,
  unknownDispatches: reports.filter(r => r.mode === 'DISPATCHED_UNKNOWN').length,
  modelAccuracy: reports.some(r => r.inference) ? 'SEE_PER_RECORD_SCORES' : 'NOT_MEASURED', note: 'Recorded controls, extraction quality, schema compliance and live model accuracy are separate. Repeated document formats are not independent financial populations.', reports };
 const output = resolve(folder, `evaluation-${split}-${live ? 'live' : 'no-inference'}-${Date.now()}.json`); writeFileSync(output, JSON.stringify(result, null, 2), { mode: 0o600 }); console.log(JSON.stringify({ output, genuineInferenceRuns: result.genuineInferenceRuns, evaluationComplete: result.evaluationComplete }));
 if (!result.evaluationComplete || live && result.genuineInferenceRuns !== reports.length) process.exitCode = 2;
} else throw new Error('Use doctor, run, or evaluate [--regression] [--live] [--unguided]');
