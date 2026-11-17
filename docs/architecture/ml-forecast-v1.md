# ML forecast challenger v1 (MLForecast + XGBoost)

An **optional, experimental** challenger to the deterministic six-month-mean cash baseline
(`lib/poc-forecast/forecast.ts`). It never replaces the baseline: both are shown together on
`/forecasting`, scored on the same months.

## Shape

| Piece | File | Role |
| --- | --- | --- |
| Worker | `scripts/ml_forecast.py` | MLForecast + `XGBRegressor`. JSON on stdin, JSON on stdout. No network, DB, credentials or file writes. |
| Contract and scoring | `lib/poc-forecast/ml.ts` | Pure and client-safe. Builds the request from the baseline's accepted history, validates the untrusted worker result (zod, strict), scores ML and baseline in exact integer cents with the baseline's own WAPE/MAE maths. |
| Runner | `lib/server/poc-forecast/ml-runner.ts` | Spawns the worker: stripped environment (no credentials), 60 s timeout, 256 KB output cap, one run at a time. |
| Route | `app/api/forecast/ml/route.ts` | `GET` availability, `POST` run. Same-origin, JSON only, 16 KB body, strict schema. 404 unless enabled. |
| Browser client | `lib/poc-forecast/ml-client.ts` | Fetches, re-validates, and calls `scoreMl` against this browser's own baseline. |
| UI | `components/demo/ml-forecast.tsx` | "Experimental ML challenger" panel on the Forecasting page. Renders nothing unless the server reports the worker is on. |

## Setup (local only)

```sh
python3 -m venv .venv-ml
.venv-ml/bin/pip install -r requirements-ml.txt
FINGENCE_ML_FORECAST=1 pnpm dev        # then process the demo on /data and open /forecasting
```

- `FINGENCE_ML_FORECAST=1` switches it on. Without it the route is 404 and the page is exactly the baseline.
- It is **never enabled on Vercel**: the worker is an external Python runtime, not a bundled asset.
- `FINGENCE_ML_PYTHON` overrides the interpreter (default `.venv-ml/bin/python`, then `python3`).

## Method

- Each metric (cash in, cash out) is modelled **separately**; net is derived as in minus out and is never modelled.
- Features: lags 1-3 and the 3-month rolling mean of lag 1. No calendar features: 12 months holds one observation per calendar month.
- XGBoost parameters are fixed in advance (`n_estimators=80, max_depth=2, learning_rate=0.1`, `random_state=0`, one thread) and were **not tuned on the backtest months**. The worker is deterministic: identical input gives byte-identical output.
- Backtest: rolling-origin, `refit=True`, horizon 1, on exactly the months the baseline is tested on (month index 6 onward), each fit using only earlier months.
- Money crosses every boundary as integer cents. Forecasts are clipped at zero and rounded to the cent inside the worker.
- Minimum history is **12 consecutive months** (the baseline needs 7). The challenger inherits every baseline refusal: currency mix, sign mismatch, gaps.

## Result on the bundled demo history (12 months, Rimba Demo Kitchen, MYR)

| Metric | XGBoost WAPE | Six-month-mean WAPE | Lower |
| --- | --- | --- | --- |
| Cash in | 4.94% | 3.98% | Baseline |
| Cash out | 6.55% | 8.94% | XGBoost |
| Net (derived) | 9.18% | 9.03% | Baseline (near tie) |

This is 6 test months for one business. It does **not** show XGBoost is better or worse in general.
XGBoost's April 2026 cash-out forecast (MYR 40,242.56) largely repeats March's one-off spike
(MYR 40,401.31, against about 30,000 in the months before), because it leans on lag 1; the baseline averages the spike away.
Trees also cannot extrapolate beyond values seen in training. More history is the main lever for any real benefit.

## Limits

- Experimental, synthetic PoC data. Not financial-publication eligible. No confidence interval.
- Amounts are bank cash movements, not revenue, profit, expenses or a cash flow statement.
- Only monthly totals are sent to the worker; never transactions, descriptions or documents.
