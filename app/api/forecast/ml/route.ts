import { mlForecastEnabled, runMlForecast } from '@/lib/server/poc-forecast/ml-runner';
import { boundedJson, noStoreJson as json } from '@/lib/server/ai/request';
import { mlRequestSchema } from '@/lib/poc-forecast/ml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const MAX_BODY_BYTES = 16_000;
const notFound = () => new Response('Not found', { status: 404 });

/** Availability only: 404 unless FINGENCE_ML_FORECAST=1 (never on Vercel). Nothing else is disclosed. */
export async function GET() {
    if (!mlForecastEnabled()) return notFound();
    return json({ available: true, model: 'MLForecast + XGBoost', sends: 'Monthly bank cash-in and cash-out totals in integer cents; never transactions, descriptions or documents.' });
}

/**
 * Runs the local MLForecast + XGBoost worker over monthly totals. The body is strictly validated, nothing is stored or
 * logged, and the worker result is validated again before it is returned. The browser scores it against the baseline.
 */
export async function POST(request: Request) {
    if (!mlForecastEnabled()) return notFound();
    const read = await boundedJson(request, MAX_BODY_BYTES);
    if ('refusal' in read) return read.refusal;
    const parsed = mlRequestSchema.safeParse(read.body);
    if (!parsed.success) return json({ code: 'INVALID_REQUEST', detail: 'Expected 12 to 120 consecutive monthly cash totals in integer cents.' }, 400);
    const outcome = await runMlForecast(parsed.data);
    if (outcome.status === 'OK') return json({ result: outcome.result });
    const status = outcome.status === 'REFUSED' ? 422 : outcome.status === 'BUSY' ? 429 : outcome.status === 'UNAVAILABLE' ? 503 : 500;
    return json({ code: outcome.code, detail: outcome.detail }, status);
}
