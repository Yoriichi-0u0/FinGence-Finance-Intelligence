# Local Obsidian and Groq chatbot demo

This isolated local demo uses a server-generated synthetic March 2026 vault note. It does not read browser-provided processing context or user-uploaded files. The note contains aggregate cash-movement figures, source hashes, processing ID, period and currency; it does not contain raw rows or user identity.

## Ports and running alongside `poc:dev`

- `pnpm poc:dev` uses `127.0.0.1:3186` by default and Next's `.next` development directory. Its local launcher uses Webpack to avoid Windows Turbopack junction errors, strips provider credentials and clears any inherited Obsidian demo flag.
- `pnpm demo:groq` uses `127.0.0.1:3190` and `.next-obsidian-demo`.
- The separate ports and build directories allow both local servers to run at once. Stop either server with Ctrl+C.

## Start the chatbot on Windows PowerShell

Run from the repository root. Enter the Groq key only at the hidden prompt:

```powershell
$secure = Read-Host "Groq API key" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)

try {
    $env:GROQ_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    pnpm.cmd demo:groq
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
}
```

The launcher generates `.local/obsidian-demo-groq-vault/FinGence Synthetic Finance Summary - 2026-03.md` from the server pipeline, checks that it is the only Markdown note in that dedicated vault, and starts the server. Open `http://127.0.0.1:3190/chatbot`. Startup does not call Groq; a live provider request occurs only after a user previews the exact prompt and passages and explicitly consents to sending them.

The launcher passes the key to the local Next server through its environment, not command-line arguments, and prints only whether a key is configured. It clears the other local/hosted AI switches and uses the demo mode flag only in the child server. The POC launcher continues stripping Groq/provider environment variables, clears the Obsidian demo flag, and keeps its existing port and local-mode controls.

## Verify the source fallback without a live Groq call

```powershell
$env:NODE_ENV = 'development'
$env:FINGENCE_OBSIDIAN_DEMO = '1'
$env:FINGENCE_OBSIDIAN_SYNTHETIC_ONLY = '1'
$env:FINGENCE_OBSIDIAN_VAULT_PATH = '.local/obsidian-demo-groq-vault'
$env:GROQ_API_KEY = ''
pnpm.cmd obsidian:demo:fallback
```

This command regenerates the synthetic vault, retrieves the March cash-movement passage, and injects a fake provider timeout. Expected result: `status: FALLBACK`, `groqUsed: false`, `providerAttempted: true`, a verbatim source snippet, and the cited note title, heading and link.

## Scope and limitations

- All demo endpoints are refused unless the separate demo flag is enabled and the caller is loopback. Signed-in POC flags disable this demo.
- The demo uses the existing deterministic checks and AI budget admission. Its budget counter and retrieval audit are in-memory for this local process.
- Durable audit storage needs a persistent database connection, an applied audit schema migration, and database-backed audit storage.
- The review ZIP is not the vault. Do not put `.env` files, keys or generated vault notes in a review archive.

## Verify an actual Groq request in the browser

This is a manual live-provider check. The automated tests use only fake transports. Start `demo:groq` with a fresh key in the current PowerShell session, then open `http://127.0.0.1:3190/chatbot`.

1. Confirm the page says **Groq available: Yes**.
2. Ask a question about the generated March 2026 source, such as “What was total cash in March?”
3. Read the exact question and source passages in the preview. Check the consent box only if you agree to send those displayed passages to Groq, then select **Send to Groq**.
4. Confirm the reply says **Groq used for this reply: Yes**, shows **Provider request attempted: Yes**, includes the provider-returned model name, and lists the cited title and heading.
5. In browser developer tools, open **Network**, filter to **Fetch/XHR**, and inspect `/api/obsidian-demo/status`, `/api/obsidian-demo/preview`, and `/api/obsidian-demo/send`. The send response should contain `groqUsed: true`, `providerAttempted: true`, a non-empty `model`, and the cited sections. Its request body should include the preview ID, payload hash, and `consent: true`.

The browser does not make a direct request to Groq: the Groq request is server-to-server. The successful `/send` response fields and the UI status are the browser-visible evidence. The API key is never returned to the browser.
