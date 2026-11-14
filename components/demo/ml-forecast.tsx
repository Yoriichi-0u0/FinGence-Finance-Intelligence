'use client';
import { useEffect, useRef, useState } from 'react';
import { BrainCircuit } from 'lucide-react';
import { Panel } from '@/components/ui';
import { LineChart } from '@/components/charts';
import { fetchMlForecast, mlForecastAvailable } from '@/lib/poc-forecast/ml-client';
import { ML_LIMITATIONS, ML_MIN_MONTHS, type MlForecastResult, type MlWinner } from '@/lib/poc-forecast/ml';
import type { BusinessForecast } from '@/lib/poc-forecast/forecast';
import { Callout, Stat, Table, button, money, outflow, primaryButton } from './shared';

const LABEL = { credits: 'Cash in', debits: 'Cash out', net: 'Net (derived)' } as const;
const WINNER: Record<MlWinner, string> = { ML: 'XGBoost lower', BASELINE: 'Baseline lower', TIE: 'Tie' };

type State = { status: 'IDLE' } | { status: 'RUNNING' } | { status: 'DONE'; result: MlForecastResult } | { status: 'ERROR'; detail: string };

/**
 * Optional MLForecast + XGBoost challenger. Hidden unless the server reports the local worker is switched on
 * (FINGENCE_ML_FORECAST=1), so the default page is exactly the deterministic baseline. Never replaces the baseline.
 */
export function MlChallenger({ forecast }: { forecast: BusinessForecast }) {
    const [available, setAvailable] = useState(false), [state, setState] = useState<State>({ status: 'IDLE' }), abort = useRef<AbortController | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        mlForecastAvailable(controller.signal).then(setAvailable);
        return () => { controller.abort(); abort.current?.abort(); };
    }, []);
    if (!available || forecast.forecast.status !== 'AVAILABLE') return null;
    const enough = forecast.history.length >= ML_MIN_MONTHS, base = forecast.forecast, currency = forecast.currency ?? '';

    async function run() {
        abort.current?.abort();
        const controller = abort.current = new AbortController();
        setState({ status: 'RUNNING' });
        try {
            const outcome = await fetchMlForecast(forecast, controller.signal);
            if (!controller.signal.aborted) setState(outcome.status === 'OK' ? { status: 'DONE', result: outcome.result } : { status: 'ERROR', detail: outcome.detail });
        } catch { /* aborted by unmount or a newer run */ }
    }

    return <Panel title="Experimental ML challenger" eyebrow="MLForecast + XGBoost · compared with the baseline on the same months" className="mt-5"
        action={<button type="button" className={state.status === 'DONE' ? button : primaryButton} onClick={run} disabled={!enough || state.status === 'RUNNING'}><BrainCircuit aria-hidden="true" size={16} />{state.status === 'RUNNING' ? 'Running…' : state.status === 'DONE' ? 'Run again' : 'Run XGBoost forecast'}</button>}>
        <div className="space-y-4 p-4 sm:p-5">
            {!enough ? <Callout tone="warn" title="Not enough history for the ML challenger">{`${forecast.history.length} months observed; ${ML_MIN_MONTHS} consecutive months are needed. The baseline above is unaffected.`}</Callout> : null}
            {state.status === 'ERROR' ? <Callout tone="warn" title="ML forecast unavailable">{state.detail}</Callout> : null}
            {state.status === 'IDLE' && enough ? <p className="text-sm text-[var(--muted-strong)]">Trains a small XGBoost model on this history (lags of 1–3 months and a 3-month rolling mean) and backtests it on the same {base.tests} months as the baseline. Only monthly totals are sent to the local worker.</p> : null}
            {state.status === 'DONE' ? <Result result={state.result} baseline={base} currency={currency} history={forecast} /> : null}
            <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--muted)]">{ML_LIMITATIONS.map(l => <li key={l}>{l}</li>)}</ul>
        </div>
    </Panel>;
}

function Result({ result, baseline, currency, history }: { result: MlForecastResult; baseline: Extract<BusinessForecast['forecast'], { status: 'AVAILABLE' }>; currency: string; history: BusinessForecast }) {
    const n = history.history.length;
    return <>
        <div className="grid gap-3 sm:grid-cols-3">
            <Stat tone="brand" label={`${result.period} cash in`} value={money(currency, result.credits)} detail={`Baseline ${money(currency, baseline.credits)}`} />
            <Stat tone="plain" label={`${result.period} cash out`} value={outflow(currency, result.debits)} detail={`Baseline ${outflow(currency, baseline.debits)}`} />
            <Stat tone="warn" label={`${result.period} net (derived)`} value={money(currency, result.net)} detail={`Baseline ${money(currency, baseline.net)} · least reliable figure`} />
        </div>
        <Table caption="Backtest error: XGBoost challenger against the six-month mean baseline" columns={['Metric', 'XGBoost WAPE', 'Baseline WAPE', 'Lower error', 'XGBoost MAE', 'Baseline MAE']}
            rows={result.scores.map(s => [LABEL[s.metric], s.mlWape === null ? 'n/a' : `${s.mlWape}%`, s.baselineWape === null ? 'n/a' : `${s.baselineWape}%`, s.lowerWape === null ? 'n/a' : WINNER[s.lowerWape], money(currency, s.mlMae), money(currency, s.baselineMae)])} />
        <div className="min-w-0">
            <LineChart ariaLabel="Observed net movement with baseline and XGBoost backtest and next-month forecast" height={260}
                labels={[...history.history.map(m => m.period.slice(2)), result.period.slice(2)]}
                series={[
                    { label: 'Observed net', color: 'var(--chart-in)', values: [...history.history.map(m => Number(m.net)), null], fill: true },
                    { label: 'Baseline (6-month mean)', color: 'var(--chart-net)', dashed: true, values: [...history.history.map((m, i) => i < n - 1 ? null : Number(m.net)), Number(baseline.net)] },
                    { label: 'XGBoost', color: 'var(--chart-out)', dashed: true, values: [...history.history.map((m, i) => i < n - 1 ? null : Number(m.net)), Number(result.net)] },
                ]} />
        </div>
        <p className="text-xs text-[var(--muted)]">{`${result.tests} backtest months · mlforecast ${result.engine.mlforecast} · xgboost ${result.engine.xgboost} · fixed hyper-parameters, no tuning on test months. Lag importance (cash in): ${Object.entries(result.importance.credits).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ')}.`}</p>
    </>;
}
