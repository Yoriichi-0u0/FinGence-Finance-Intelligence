export type MLForecastResult = {
  status: "AVAILABLE" | "UNAVAILABLE";
  model: "XGBoost";
  horizon: number;
  receipts: string | null;
  payments: string | null;
  net: string | null;
  reason?: string;
};

export async function forecastWithXGBoost(
  history: MonthlyHistory[],
): Promise<MLForecastResult> {
  // Convert validated history to model input.
  // Execute the Python forecasting process.
  // Validate and convert its output.
}
