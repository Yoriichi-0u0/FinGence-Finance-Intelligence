# Katana-first Windows preparation — NOT EXECUTED

Current owner-supplied hardware: MSI Katana 17 B13VFK, Intel Core i7-13620H, RTX 4060 Laptop GPU with 8 GB dedicated VRAM, 32 GB RAM, Windows and WSL Ubuntu. Mac baseline: MacBook Air M2, 16 GB unified memory. Lab comparison: RTX 5090, 32 GB VRAM, access/configuration unverified. Full current instructions: `~/Documents/FinGence/docs/WINDOWS_KATANA.md`.

Groq-first testing does not need laptop GPU memory for LLM inference. PDF/image extraction
still needs a verified local Python runtime, dependencies/model cache and sufficient RAM.
The tested macOS lock is not proof of Windows wheel/model compatibility.

1. Use an isolated source checkout/copy, Node 24.x and pnpm 11.19.0. Preserve the Linux/macOS
   source fixture bytes (do not newline-normalize CSVs); verify the manifest hashes.
2. Run `pnpm install --frozen-lockfile` and `pnpm test`. Do not claim skipped image/native
   database tests ran. Native PostgreSQL tests require their real binaries.
3. Create `.venv-ai` with Python 3.12. Resolve `requirements-ai.in` on Windows, run
   `python -m pip check`, record the installed versions, and review any incompatible pins
   before changing them. The 03 launcher selects `.venv-ai/Scripts/python.exe`.
4. Run `node --conditions=react-server scripts/ai-increment-03.mjs doctor` and the
   no-inference evaluation. Source extraction must pass before live provider use.
5. Run `node scripts/ai-demo-03.mjs`; open `http://127.0.0.1:3107/ai-ingestion/live`.
   This launcher uses Node environment configuration rather than Unix-only shell syntax.
6. Secure Groq configuration/dispatch remains separately authorized, synthetic-only and
   Free Plan only. Never place a key in a PowerShell command, screenshot, Git or report.

Before selecting local Ollama weights, capture Windows version, system RAM/free disk and:

```powershell
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
```

Do not infer Katana GPU/VRAM from the laptop product name. The small provisional candidate
is qwen3:4b-instruct (about 2.5 GB download); RTX 5090 lab comparison candidate is
 gpt-oss:20b (about 14 GB). Both require separate installation/download authorization and
actual schema/latency/VRAM measurement. Neither is installed by these scripts.

Run Ollama on loopback of the test machine; no public unauthenticated endpoint. GPU
performance, driver compatibility and end-to-end Windows/Ollama execution remain unverified.
