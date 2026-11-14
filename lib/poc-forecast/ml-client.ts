import { buildMlRequest, mlWorkerSchema, scoreMl, type MlForecastResult } from './ml';
import type { BusinessForecast } from './forecast';

export type MlClientOutcome =
    | { status: 'OK'; result: MlForecastResult }
    | { status: 'UNAVAILABLE' | 'REFUSED' | 'FAILED'; detail: string };

/** True only when the server reports the local ML worker is switched on. Any error is simply "not available". */
export async function mlForecastAvailable(signal?: AbortSignal): Promise<boolean> {
    try { return (await fetch('/api/forecast/ml', { cache: 'no-store', signal })).ok; } catch { return false; }
}

/** Sends monthly totals only, then validates and scores the worker result against this browser's own baseline. */
export async function fetchMlForecast(forecast: BusinessForecast, signal?: AbortSignal): Promise<MlClientOutcome> {
    const built = buildMlRequest(forecast);
    if (!('request' in built)) return { status: 'REFUSED', detail: built.detail };
    try {
        const response = await fetch('/api/forecast/ml', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(built.request), cache: 'no-store', signal });
        const body = await response.json().catch(() => null) as { result?: unknown; detail?: string } | null;
        if (!response.ok) return { status: response.status === 422 ? 'REFUSED' : response.status === 503 ? 'UNAVAILABLE' : 'FAILED', detail: body?.detail ?? 'The ML forecast could not be produced.' };
        const worker = mlWorkerSchema.safeParse(body?.result);
        if (!worker.success) return { status: 'FAILED', detail: 'The ML forecast result did not match its contract.' };
        return { status: 'OK', result: scoreMl(forecast, worker.data) };
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        return { status: 'FAILED', detail: 'The ML forecast result could not be verified against the baseline.' };
    }
}
