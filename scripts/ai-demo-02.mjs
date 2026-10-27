import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
if (!process.versions.node.startsWith("24.")) throw new Error("Use Node.js 24.x for the verified local demo.");
const require = createRequire(import.meta.url);
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3105"], { stdio: "inherit", env: { ...process.env, FINGENCE_AI_LOCAL: "1", FINGENCE_AI_DEVELOPER_REPLAY: "1", FINGENCE_AI_LIVE_APPROVED: "0", FINGENCE_AI_PYTHON: resolve(".venv-ai/bin/python") } });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => { process.exitCode = code ?? 1; });
