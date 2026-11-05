import json
import sys

import pandas as pd
from xgboost import XGBRegressor
from mlforecast import MLForecast


def forecast_series(data, horizon=3):
    df = pd.DataFrame(data)

    df["ds"] = pd.to_datetime(df["ds"])
    df["y"] = pd.to_numeric(df["y"], errors="raise")

    if len(df) < 12:
        raise ValueError("Insufficient history for ML forecasting")

    df = df.sort_values(["unique_id", "ds"])

    model = MLForecast(
        models=[
            XGBRegressor(
                n_estimators=100,
                max_depth=3,
                learning_rate=0.05,
                objective="reg:squarederror",
                random_state=42,
            )
        ],
        freq="MS",
        lags=[1, 2, 3, 6],
    )

    model.fit(df)

    predictions = model.predict(h=horizon)

    results = predictions.rename(
        columns={"XGBRegressor": "prediction"}
    )

    return results.to_dict(orient="records")


if __name__ == "__main__":
    request = json.loads(sys.stdin.read())

    result = forecast_series(
        request["data"],
        request.get("horizon", 3),
    )

    print(json.dumps(result, default=str))