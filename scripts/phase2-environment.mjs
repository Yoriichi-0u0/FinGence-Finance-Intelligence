import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

/** Test mode must explicitly opt out before any developer environment file is inspected. */
export function loadPhase2Environment(environment = process.env, loader = loadEnvFile) {
  const disabled = environment.FINSIGHT_PHASE2_TEST_NO_ENV_FILE === "1";
  if (environment.NODE_ENV === "test") {
    if (!disabled) throw new Error("Test CLI requires isolated environment loading.");
    return;
  }
  if (environment.FINSIGHT_PHASE2_TEST_NO_ENV_FILE !== undefined) {
    throw new Error("Environment-file disable switch is test-only.");
  }
  const localEnvironment = new URL("../.env.local", import.meta.url);
  if (existsSync(localEnvironment)) loader(fileURLToPath(localEnvironment));
}
