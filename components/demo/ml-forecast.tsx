'use client';
import { useEffect, useRef, useState } from 'react';
import { BrainCircuit } from 'lucide-react';
import { Panel } from '@/components/ui';
import { LineChart } from '@/components/charts';
import { fetchMlForecast, mlForecastAvailable } from '@/lib/poc-forecast/ml-client';
import { ML_HORIZONS, ML_LIMITATIONS, ML_MIN_MONTHS, type MlForecastResult, type MlHorizon, type MlWinner } from '@/lib/poc-forecast/ml';
import type { BusinessForecast } from '@/lib/poc-forecast/forecast';
import { Callout, Stat, Table, button, money, outflow, periodLabel, primaryButton } from './shared';

const LABEL = { credits: 'Cash in', debits: 'Cash out', net: 'Net (derived)' } as const;
const WINNER: Record<MlWinner, string> = { ML: 'XGBoost lower', BASELINE: 'Baseline lower', TIE: 'Tie' };
const months = (n: number) => `${n} month${n === 1 ? '' : 's'}`;

type State = { status: 'IDLE' } | { status: 'RUNNING' } | { status: 'DONE'; result: MlForecastResult } | { status: 'ERROR'; detail: string };

/**
 * Optional MLForecast + XGBoost challenger at 1, 4 and 6 months ahead. Hidden unless the server reports the local worker
 * is switched on (FINGENCE_ML_FORECAST=1), so the default page is exactly the deterministic baseline. Never replaces the baseline.
 */
export function MlChallenger({ forecast }: { forecast: BusinessForecast }) {
    const [available, setAvailable] = useState(false), [state, setState] = useState<State>({ status: 'IDLE' }), abort = useRef<AbortController | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        mlForecastAvailable(controller.signal).then(setAvailable);
        return () => { controller.abort(); abort.current?.abort(); };
    }, []);
    if (!available || forecast.forecast.status !== 'AVAILABLE') return null;
    const enough = forecast.history.length >= ML_MIN_MONTHS;

    async function run() {
        abort.current?.abort();
        const controller = abort.current = new AbortController();
        setState({ status: 'RUNNING' });
        try {
            const outcome = await fetchMlForecast(forecast, controller.signal);
            if (!controller.signal.aborted) setState(outcome.status === 'OK' ? { status: 'DONE', result: outcome.result } : { status: 'ERROR', detail: outcome.detail });
        } catch { /* aborted by unmount or a newer run */ }
    }

    return <Panel title="Experimental ML challenger" eyebrow="MLForecast + XGBoost · 1, 4 and 6 months ahead · compared with the baseline on the same months" className="mt-5"
        action={<button type="button" className={state.status === 'DONE' ? button : primaryButton} onClick={run} disabled={!enough || state.status === 'RUNNING'}><BrainCircuit aria-hidden="true" size={16} />{state.status === 'RUNNING' ? 'Running…' : state.status === 'DONE' ? 'Run again' : 'Run XGBoost forecast'}</button>}>
        <div className="space-y-4 p-4 sm:p-5">
            {!enough ? <Callout tone="warn" title="Not enough history for the ML challenger">{`${forecast.history.length} months observed; ${ML_MIN_MONTHS} consecutive months are needed. The baseline above is unaffected.`}</Callout> : null}
            {state.status === 'ERROR' ? <Callout tone="warn" title="ML forecast unavailable">{state.detail}</Callout> : null}
            {state.status === 'IDLE' && enough ? <p className="text-sm text-[var(--muted-strong)]">Trains a small XGBoost model on this history (lags of 1–3 months and a 3-month rolling mean) and forecasts 1, 4 and 6 months ahead, each tested on months already known. Only monthly totals are sent to the local worker.</p> : null}
            {state.status === 'DONE' ? <MlResult result={state.result} forecast={forecast} /> : null}
            <ul className="list-disc space-y-1 pl-5 text-xs text-[var(--muted)]">{ML_LIMITATIONS.map(l => <li key={l}>{l}</li>)}</ul>
        </div>
    </Panel>;
}

/** The result view. `initialHorizon` only sets the tab shown first (the person can switch); it exists so each tab can be rendered in a test. */
export function MlResult({ result, forecast, initialHorizon = 1 }: { result: MlForecastResult; forecast: BusinessForecast; initialHorizon?: MlHorizon }) {
    const [horizon, setHorizon] = useState<MlHorizon>(initialHorizon), currency = result.currency, history = forecast.history, n = history.length;
    const hz = result.horizons.find(x => x.horizon === horizon) ?? result.horizons[0], h = hz.horizon, steps = result.path.slice(0, h);
    const span = h === 1 ? periodLabel(steps[0].period) : periodLabel(`${steps[0].period}/${hz.last}`);
    const lastObserved = Number(history[n - 1].net);
    return <>
        <div role="group" aria-label="Forecast horizon" className="grid max-w-md grid-cols-3 gap-1 rounded-xl bg-[var(--surface-sunken)] p-1">
            {ML_HORIZONS.map(x => <button key={x} type="button" aria-pressed={horizon === x} onClick={() => setHorizon(x)} className={`min-h-10 rounded-lg text-sm font-semibold transition-colors ${horizon === x ? 'bg-[var(--surface)] text-[var(--ink)] shadow-sm' : 'text-[var(--muted)]'}`}>{months(x)}</button>)}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
            <Stat tone="brand" label={h === 1 ? `${span} cash in` : `Cash in, ${span}`} value={money(currency, hz.total.ml.credits)} detail={`Baseline ${money(currency, hz.total.baseline.credits)}`} />
            <Stat tone="plain" label={h === 1 ? `${span} cash out` : `Cash out, ${span}`} value={outflow(currency, hz.total.ml.debits)} detail={`Baseline ${outflow(currency, hz.total.baseline.debits)}`} />
            <Stat tone="warn" label={h === 1 ? `${span} net (derived)` : `Net, ${span} (derived)`} value={money(currency, hz.total.ml.net)} detail={`Baseline ${money(currency, hz.total.baseline.net)} · least reliable figure`} />
        </div>
        {h > 1 ? <Table caption={`Month by month: XGBoost against the baseline, ${months(h)} ahead`} columns={['Month', 'Cash in', 'Cash out', 'Net (derived)', 'Baseline net']}
            rows={steps.map(s => [periodLabel(s.period), money(currency, s.ml.credits), outflow(currency, s.ml.debits), money(currency, s.ml.net), money(currency, s.baseline.net)])} /> : null}
        {h > 1 ? <p className="text-xs text-[var(--muted)]">XGBoost forecasts each month from its own earlier forecasts, so the path can zigzag or flatten. The baseline repeats the same six-month average every month.</p> : null}
        {hz.indicative ? <Callout tone="warn" title="Indicative only">{`Forecasting ${months(h)} ahead can be tested on only ${months(hz.tests)} of this history. Read the comparison below as one or two data points, not as evidence that either method is better.`}</Callout> : null}
        <Table caption={`Backtest: forecasting ${months(h)} ahead, XGBoost against the six-month-mean baseline`} columns={['Metric', 'XGBoost WAPE', 'Baseline WAPE', 'Lower error', 'XGBoost MAE', 'Baseline MAE']}
            rows={hz.scores.map(s => [LABEL[s.metric], s.mlWape === null ? 'n/a' : `${s.mlWape}%`, s.baselineWape === null ? 'n/a' : `${s.baselineWape}%`, s.lowerWape === null ? 'n/a' : WINNER[s.lowerWape], money(currency, s.mlMae), money(currency, s.baselineMae)])} />
        <div className="min-w-0">
            <LineChart ariaLabel={`Observed net movement with the baseline and XGBoost forecast, ${months(h)} ahead`} height={260}
                labels={[...history.map(m => m.period.slice(2)), ...steps.map(s => s.period.slice(2))]}
                series={[
                    { label: 'Observed net', color: 'var(--chart-in)', values: [...history.map(m => Number(m.net)), ...steps.map(() => null)], fill: true },
                    { label: 'Baseline (6-month mean)', color: 'var(--chart-net)', dashed: true, values: [...history.map((_, i) => i < n - 1 ? null : lastObserved), ...steps.map(s => Number(s.baseline.net))] },
                    { label: 'XGBoost', color: 'var(--chart-out)', dashed: true, values: [...history.map((_, i) => i < n - 1 ? null : lastObserved), ...steps.map(s => Number(s.ml.net))] },
                ]} />
        </div>
        <p className="text-xs text-[var(--muted)]">{`${months(hz.tests)} of backtest at this horizon · recursive multi-step · mlforecast ${result.engine.mlforecast} · xgboost ${result.engine.xgboost} · fixed hyper-parameters, no tuning on test months. Lag importance (cash in): ${Object.entries(result.importance.credits).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(', ')}.`}</p>
    </>;
}
