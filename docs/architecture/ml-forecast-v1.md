# ML forecast challenger (MLForecast + XGBoost): 1, 4 and 6 months ahead

> The file name keeps `v1` so existing links still work. Result contract: `ml-xgboost-forecast-v2` (adds the 4- and 6-month horizons).

An **optional, experimental** challenger to the deterministic six-month-mean cash baseline
(`lib/poc-forecast/forecast.ts`). It never replaces the baseline: both are shown together on
`/forecasting`, scored on the same months, at 1, 4 and 6 months ahead.

## Shape

| Piece | File | Role |
| --- | --- | --- |
| Worker | `scripts/ml_forecast.py` | MLForecast + `XGBRegressor`. JSON on stdin, JSON on stdout. No network, DB, credentials or file writes. |
| Contract and scoring | `lib/poc-forecast/ml.ts` | Pure and client-safe. Builds the request from the baseline's accepted history, validates the untrusted worker result (zod, strict), scores ML and baseline in exact integer cents with the baseline's own WAPE/MAE maths. |
| Runner | `lib/server/poc-forecast/ml-runner.ts` | Spawns the worker: stripped environment (no credentials), 60 s timeout, 256 KB output cap, one run at a time. |
| Route | `app/api/forecast/ml/route.ts` | `GET` availability, `POST` run. Same-origin, JSON only, 16 KB body, strict schema. 404 unless enabled. |
| Browser client | `lib/poc-forecast/ml-client.ts` | Fetches, re-validates, and calls `scoreMl` against this browser's own baseline. |
| UI | `components/demo/ml-forecast.tsx` | "Experimental ML challenger" panel on the Forecasting page with a 1 / 4 / 6-month picker. Renders nothing unless the server reports the worker is on. |

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
- Horizons: **1, 4 and 6 months**. One model per metric is refit on all months and forecasts the next six months **recursively** (each month's forecast feeds the next month's lags). A horizon reads its first *h* months and shows their **total**, so the 4-month view is months 1 to 4. The recursive choice is deliberate: a direct model per horizon would train on only about 4 rows at 6 months with a 12-month history.
- Backtest: rolling-origin, `refit=True`. For horizon *h*, at each origin the model is refit on only the earlier months and forecasts *h* months ahead; the entry scored is the forecast of the *h*-th month. The first origin has 6 months of history (the same as the baseline), so horizon *h* is tested on target months from index `6 + h - 1`. **With 12 months that is 6, 3 and 1 test months for 1, 4 and 6 months ahead** (`n - 6 - h + 1` in general).
- Baseline at every horizon: the same six-month mean of the months known at the origin, so it is **flat** across the horizon. At horizon 1 it equals the deterministic backtest month for month (tested). The baseline's own 1-month contract in `forecast.ts` is unchanged.
- A horizon with fewer than 3 test months is labelled **indicative only** in the panel and is never presented as evidence.
- Money crosses every boundary as integer cents. Forecasts are clipped at zero and rounded to the cent inside the worker.
- Minimum history is **12 consecutive months** (the baseline needs 7). The challenger inherits every baseline refusal: currency mix, sign mismatch, gaps.

## Result on the bundled demo history (12 months, Rimba Demo Kitchen, MYR)

Error is WAPE (weighted absolute percentage error, lower is better) of the forecast made *h* months ahead.

| Horizon | Test months | Cash in (XGBoost / baseline) | Cash out | Net (derived) |
| --- | --- | --- | --- | --- |
| 1 month | 6 | 4.94% / 3.98%, baseline lower | 6.55% / 8.94%, XGBoost lower | 9.18% / 9.03%, baseline lower (near tie) |
| 4 months | 3 | 2.55% / 7.51%, XGBoost lower | 13.37% / 16.48%, XGBoost lower | 11.61% / 13.95%, XGBoost lower |
| 6 months | 1 (indicative) | 2.45% / 8.36%, XGBoost lower | 27.97% / 30.73%, XGBoost lower | 34.08% / 23.66%, baseline lower |

This is one synthetic business with 6, 3 and 1 test months. It does **not** show XGBoost is better or worse in general, and the
6-month column is a single data point. Totals over each horizon (MYR): 4 months, XGBoost net 115,933.30 against baseline 141,785.80;
6 months, XGBoost net 173,899.95 against baseline 212,678.70.

Two things the backtests cannot show:

- **The forward path is flat on cash out.** XGBoost forecasts MYR 40,242.56 for every one of the next six months: it treats March's
  one-off spike (MYR 40,401.31, against about 30,000 before) as the new normal, because the spike is the last observation and only the final
  model has seen it. The baseline averages the spike away. This is why the 6-month cash-out total (241,455.36) is about 26% above the baseline's (190,966.98).
- **Cash in alternates** between MYR 70,098.03 and 68,353.74 from month to month, an artefact of recursive tree forecasts on a short series.

Trees also cannot extrapolate beyond values seen in training. More history is the main lever for any real benefit.

## Limits

- Longer horizons compound error (each month feeds the next). Treat 4 and 6 months as indicative with short histories.
- Experimental, synthetic PoC data. Not financial-publication eligible. No confidence interval.
- Amounts are bank cash movements, not revenue, profit, expenses or a cash flow statement.
- Only monthly totals are sent to the worker; never transactions, descriptions or documents.
