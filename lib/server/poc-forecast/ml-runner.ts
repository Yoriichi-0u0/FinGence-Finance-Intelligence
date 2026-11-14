import 'server-only';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { mlWorkerErrorSchema, mlWorkerSchema, type MlRequest, type MlWorkerResult } from '../../poc-forecast/ml';

export const ML_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 256 * 1024;

/**
 * Off unless FINGENCE_ML_FORECAST=1, and never on Vercel: the worker is an external local Python runtime
 * (requirements-ml.txt), not a bundled production asset, exactly like the AI extraction workers.
 */
export function mlForecastEnabled() {
    return process.env.FINGENCE_ML_FORECAST === '1' && !process.env.VERCEL;
}
function pythonPath() {
    if (process.env.FINGENCE_ML_PYTHON) return process.env.FINGENCE_ML_PYTHON;
    const venv = resolve(process.platform === 'win32' ? '.venv-ml/Scripts/python.exe' : '.venv-ml/bin/python');
    return existsSync(venv) ? venv : 'python3';
}

export type MlRunOutcome =
    | { status: 'OK'; result: MlWorkerResult }
    | { status: 'REFUSED' | 'UNAVAILABLE' | 'BUSY' | 'FAILED'; code: string; detail: string };

let running = false;
/**
 * Runs the worker once. The environment carries no application credentials; stdin is the validated request and
 * stdout is parsed against a strict schema, so a malformed or oversized result is an error and never a forecast.
 * One run at a time: a second concurrent request is refused rather than queued.
 */
export async function runMlForecast(request: MlRequest, script = resolve('scripts/ml_forecast.py')): Promise<MlRunOutcome> {
    if (running) return { status: 'BUSY', code: 'BUSY', detail: 'A forecast is already running. Try again in a moment.' };
    running = true;
    try {
        return await new Promise<MlRunOutcome>(done => {
            const child = spawn(pythonPath(), [script], {
                stdio: ['pipe', 'pipe', 'pipe'],
                env: { NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', PYTHONDONTWRITEBYTECODE: '1' },
            });
            let out = '', size = 0, settled = false;
            const finish = (outcome: MlRunOutcome) => { if (!settled) { settled = true; clearTimeout(timer); done(outcome); } };
            const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ status: 'FAILED', code: 'TIMEOUT', detail: `The forecast exceeded its ${ML_TIMEOUT_MS / 1000}-second limit.` }); }, ML_TIMEOUT_MS);
            child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
                size += Buffer.byteLength(chunk);
                if (size > MAX_OUTPUT_BYTES) { child.kill('SIGKILL'); finish({ status: 'FAILED', code: 'OUTPUT_TOO_LARGE', detail: 'The forecast worker returned too much output.' }); return; }
                out += chunk;
            });
            child.stderr.resume();
            child.on('error', () => finish({ status: 'UNAVAILABLE', code: 'PYTHON_UNAVAILABLE', detail: 'The Python runtime for the ML forecast could not be started. See requirements-ml.txt.' }));
            child.on('close', () => {
                let json: unknown;
                try { json = JSON.parse(out); } catch { return finish({ status: 'FAILED', code: 'BAD_OUTPUT', detail: 'The forecast worker returned no valid result.' }); }
                const failure = mlWorkerErrorSchema.safeParse(json);
                if (failure.success) {
                    const { code, detail } = failure.data.error;
                    return finish({ status: code === 'MISSING_DEPENDENCY' ? 'UNAVAILABLE' : code === 'REFUSED' ? 'REFUSED' : 'FAILED', code, detail });
                }
                const parsed = mlWorkerSchema.safeParse(json);
                finish(parsed.success ? { status: 'OK', result: parsed.data } : { status: 'FAILED', code: 'BAD_OUTPUT', detail: 'The forecast worker result did not match its contract.' });
            });
            child.stdin.on('error', () => undefined);
            child.stdin.end(JSON.stringify(request));
        });
    } finally {
        running = false;
    }
}
