#!/usr/bin/env python3
"""MLForecast + XGBoost multi-horizon forecast for FinGence monthly bank cash totals.

Reads one JSON request on stdin and writes one JSON result on stdout. It has no network,
database or credential access and writes no files. All money crosses the boundary as integer
cents; floats exist only inside the model.

Request : {"currency": "MYR", "months": [{"period": "2025-04", "credits": 6054712, "debits": 2657482}, ...]}
Result  : {"engine": {...}, "config": {...}, "path": [...6 months...], "backtests": {"1": [...], "4": [...], "6": [...]}, "importance": {...}}

Each metric (credits, debits) is modelled separately, so one series never leaks into the other.
Net is never modelled; the caller derives it as credits minus debits.

Horizons are 1, 4 and 6 months. One model per metric is refit on all months and forecasts the next six
months recursively (each month's forecast feeds the next month's lags), so `path` holds months 1 to 6 and
every horizon reads its first h months.

A backtest for horizon h is rolling-origin: at each origin the model is refit on only the earlier months and
forecasts h months ahead, and the entry holds the forecast of the h-th month. The first origin has
BACKTEST_START months of history (the same as the deterministic baseline), so horizon h is tested on the target
months BACKTEST_START + h - 1 onward: with 12 months that is 6, 3 and 1 test months for horizons 1, 4 and 6.
Hyper-parameters are fixed in advance and are never tuned on the backtest months.
"""
import json
import re
import sys
import warnings

MIN_MONTHS = 12          # ML needs more history than the 7-month baseline; see docs/architecture/ml-forecast-v1.md
MAX_MONTHS = 120
BACKTEST_START = 6       # must equal BACKTEST_START in lib/poc-forecast/forecast.ts
HORIZONS = (1, 4, 6)     # must equal ML_HORIZONS in lib/poc-forecast/ml.ts
MAX_HORIZON = max(HORIZONS)
LAGS = [1, 2, 3]
ROLLING_WINDOW = 3
METRICS = ("credits", "debits")
PERIOD = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
XGB_PARAMS = dict(
    n_estimators=80, max_depth=2, learning_rate=0.1, min_child_weight=1, subsample=1.0,
    colsample_bytree=1.0, reg_lambda=1.0, tree_method="hist", random_state=0, n_jobs=1, verbosity=0,
)


class Refusal(Exception):
    """A request the engine will not forecast; the message is safe to show."""


def fail(code, detail):
    json.dump({"error": {"code": code, "detail": detail}}, sys.stdout)
    sys.stdout.write("\n")
    sys.exit(2)


def next_period(period):
    year, month = int(period[:4]), int(period[5:])
    return f"{year + 1}-01" if month == 12 else f"{year}-{month + 1:02d}"


def validate(request):
    if not isinstance(request, dict) or not isinstance(request.get("months"), list):
        raise Refusal("The request must hold a months list.")
    months = request["months"]
    if not MIN_MONTHS <= len(months) <= MAX_MONTHS:
        raise Refusal(f"{len(months)} months supplied; the ML forecast needs {MIN_MONTHS} to {MAX_MONTHS} consecutive months.")
    for i, m in enumerate(months):
        if not isinstance(m, dict) or not isinstance(m.get("period"), str) or not PERIOD.match(m["period"]):
            raise Refusal(f"Month {i + 1} has no valid YYYY-MM period.")
        for metric in METRICS:
            v = m.get(metric)
            if isinstance(v, bool) or not isinstance(v, int) or v < 0 or v > 10**15:
                raise Refusal(f"Month {m['period']} {metric} must be a non-negative integer number of cents.")
        if i and m["period"] != next_period(months[i - 1]["period"]):
            raise Refusal(f"Months are not consecutive (gap before {m['period']}); missing months are never filled in.")
    return months


def run(months):
    # Imported late so a missing dependency is reported as a clear error rather than a traceback.
    import mlforecast
    import numpy as np
    import pandas as pd
    import xgboost
    from mlforecast import MLForecast
    from mlforecast.lag_transforms import RollingMean
    from xgboost import XGBRegressor

    periods = [m["period"] for m in months]
    ds = pd.to_datetime([p + "-01" for p in periods])
    windows = {h: len(months) - BACKTEST_START - h + 1 for h in HORIZONS}
    if min(windows.values()) < 1:
        raise Refusal("Not enough history to test every horizon.")
    path = [{"period": None, "credits": 0, "debits": 0} for _ in range(MAX_HORIZON)]
    p = periods[-1]
    for step in path:
        p = next_period(p)
        step["period"] = p
    backtests = {
        str(h): [{"period": periods[BACKTEST_START + h - 1 + i], "credits": 0, "debits": 0} for i in range(windows[h])]
        for h in HORIZONS
    }
    out = {"path": path, "backtests": backtests, "importance": {}}

    def cents(value):
        # A forecast cash movement cannot be negative; clip, then round half away from zero to the cent.
        return int(np.floor(max(float(value), 0.0) * 100 + 0.5))

    for metric in METRICS:
        df = pd.DataFrame({"unique_id": metric, "ds": ds, "y": [m[metric] / 100 for m in months]})

        def make():
            return MLForecast(
                models={"xgb": XGBRegressor(**XGB_PARAMS)}, freq="MS", lags=LAGS,
                lag_transforms={1: [RollingMean(window_size=ROLLING_WINDOW)]},
            )

        for h in HORIZONS:
            cv = make().cross_validation(df, n_windows=windows[h], h=h, step_size=1, refit=True)
            # Each origin forecasts h months ahead; only the last of those h forecasts is the horizon-h forecast.
            cv = cv.sort_values(["cutoff", "ds"]).groupby("cutoff").tail(1).sort_values("ds")
            expected = [row["period"] for row in backtests[str(h)]]
            if [d.strftime("%Y-%m") for d in cv["ds"]] != expected:
                raise Refusal("The backtest did not cover the expected months.")
            for row, value in zip(backtests[str(h)], cv["xgb"]):
                row[metric] = cents(value)

        final = make()
        final.fit(df)
        pred = final.predict(MAX_HORIZON).sort_values("ds")
        if [d.strftime("%Y-%m") for d in pred["ds"]] != [step["period"] for step in path]:
            raise Refusal("The forecast did not cover the expected months.")
        for step, value in zip(path, pred["xgb"]):
            step[metric] = cents(value)
        names = list(final.ts.features_order_)
        out["importance"][metric] = {n: round(float(v), 4) for n, v in zip(names, final.models_["xgb"].feature_importances_)}

    out["engine"] = {
        "mlforecast": mlforecast.__version__, "xgboost": xgboost.__version__, "pandas": pd.__version__, "numpy": np.__version__,
        "python": ".".join(map(str, sys.version_info[:3])),
    }
    out["config"] = {
        "model": "XGBRegressor", "params": XGB_PARAMS, "lags": LAGS, "rolling": f"mean of the last {ROLLING_WINDOW} months (lag 1)",
        "horizons": list(HORIZONS), "strategy": "recursive", "windows": {str(h): windows[h] for h in HORIZONS},
        "refit": True, "perMetric": True,
    }
    return out


def main():
    try:
        raw = sys.stdin.read(200_000)
        try:
            request = json.loads(raw)
        except ValueError:
            fail("INVALID_JSON", "stdin was not valid JSON.")
        months = validate(request)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            result = run(months)
    except Refusal as refusal:
        fail("REFUSED", str(refusal))
    except ImportError as error:
        fail("MISSING_DEPENDENCY", f"Install requirements-ml.txt ({error.name}).")
    except Exception as error:  # a model failure must never become a silent or partial forecast
        fail("MODEL_ERROR", type(error).__name__)
    json.dump(result, sys.stdout, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
