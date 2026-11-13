# Local Groq chat over uploaded financial data

This adds an opt-in, signed-in local chat mode to the existing `/chatbot` page. It uses the same local Finance account and uploaded bank source as `poc:dev`. The existing `poc:dev` mode stays rule-based; the separate `poc:groq` launcher enables Groq for the `/chatbot` UI.

## What the assistant can review

The server reads an uploaded source from the current Finance user's local database, verifies its stored hash, and recomputes facts with the existing Finance questions, analytics, anomaly, reconciliation, and forecast code. Before sending anything to Groq, the browser shows the exact question and up to three matching, server-computed summary passages. The user must approve that preview. The server recomputes the source facts and rejects an expired, edited, or stale preview.

Groq receives the question and short aggregate summaries. It does not receive the uploaded file, raw transaction rows, record IDs, file name, source hash, organization name, or user identity. Numeric claims are checked against the passages; unsupported figures are withheld. The UI labels whether Groq was used, shows the provider-returned model, and links cited sections to FinGence pages. General questions use the same preview and consent flow but send no financial passages.

The assistant describes signed amounts as **net cash movement**, not profit, loss, revenue, income, or sales. Questions asking how much money the business “made” or “earned” are refused because a bank statement alone cannot establish earnings. It does not determine why a payment happened, rank or calculate new financial values, classify a payee, provide financial advice, or allege fraud. A person should review important figures against the linked source pages.

## Start it on Windows

Use the existing local Finance account and source. If needed, start `pnpm.cmd poc:dev` first, sign in, and upload the synthetic bank CSV from the Anomalies page. Stop that server with **Ctrl+C** before starting Groq mode. Both launchers use the same local database and must not run together.

From the repository folder in PowerShell, enter the Groq key at a hidden prompt and start the separate mode:

```powershell
$secure = Read-Host "Groq API key" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:GROQ_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    pnpm.cmd poc:groq
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    Remove-Item Env:GROQ_API_KEY -ErrorAction SilentlyContinue
}
```

Open `http://127.0.0.1:3191/chatbot`, sign in with the same active local Finance account, and choose the uploaded source and month. The launcher is loopback-only, uses Webpack, and does not call Groq on startup. Stop it with **Ctrl+C**. Do not run `poc:dev` at the same time because both processes use the same local database.

## Try a question and verify the provider call

Ask naturally, for example:

- “Can you explain the cash movement for this month?”
- “What does a duplicate-reference flag mean?”
- “Which parts of this month's activity should I review?”
- “How does the latest month compare with the earlier months?”
- “How do I upload another statement?”

The first step creates a preview. Read the exact question and displayed source summary, check the approval box, then select **Approve and send**. The answer card reports **Groq used for this reply**, whether a provider request was attempted, the returned model name, and cited sections. For provider verification, open the browser's developer tools, select **Network**, and inspect the same-origin request to `/api/ai-ingestion/m2/finance-questions?action=chat-send`. A successful provider answer includes `groqUsed: true`, `providerAttempted: true`, a returned `model`, and citations. The browser never calls Groq directly and the key is not returned to it.

## Scope and limitations

- This is a local proof of concept, not hosted or production authentication. Only a signed-in local Finance member may read their organization's stored source.
- This integration currently reads bank CSV sources stored by the existing M2 PoC. It does not yet connect the Architecture 2.0 V2 ingestion results or arbitrary XLSX/PDF/image uploads to the chat.
- The assistant sees aggregates and rule explanations, not individual transaction rows. It cannot answer “which exact transaction/payee?” questions yet.
- Previews are held in server memory for five minutes and are lost on restart. Source reads use the existing `public.security_audit_events` table in the local database transaction; this is machine-local, not a hosted audit service. The Groq send itself is not separately recorded as a durable provider-dispatch audit event in this PoC.
- Automated checks use a fake Groq transport. A real provider request happens only when a user starts `poc:groq`, reviews a preview, and explicitly approves it.
