# Individual contribution evidence — Increment 02

20 October 2026. Chia's experimental financial-document ingestion work, following the
SAIC consultation. Consultation interpretations and accounting rules remain subject to
client confirmation. No client feedback or individual working hours are invented here.

**Implemented and tested:** an experimental financial terminology policy; explicit
source-field and context dispositions; bank-versus-ledger safeguards; independent
date/number/source-value checks; reusable semantic templates rebound to fresh evidence;
source-context-preserving local extraction; a separate developer replay interface; and
independent evaluation labels, adversarial tests and a reproducible CLI.

**Research question:** can proposed financial processing rules be checked against source
evidence and conservative financial policies before exact normalization, and reused
without carrying stale values or unsupported interpretations into new documents?

Infrastructure is reused from the existing verified CSV/XLSX reader and normalization
engine, and the Increment 01 open-source Docling/RapidOCR benchmark. The contribution
is the financial verification/reuse boundary, evaluation and evidence workflow, not a
new OCR engine. Teammates retain backend, analytics, security and dashboard ownership.

**Evidence:** 40 new tests; complete suite 492 passed and 9 explicitly skipped; 26-document
recorded evaluation, with 27 accepted, 2 rejected and 14 observed unresolved row
representations. Three sources have unestablished row counts and a corrupt PDF fails.
Source-field fidelity is 242/276 including blanks and intentionally degraded cases.
The internal review's two false-acceptance/evidence-loss defects were reproduced and fixed.
See `verification.md`, `evidence/evaluation.json`, screenshots and the changed-file manifest.

**Not yet demonstrated:** genuine LLM-generated rules or model accuracy. All interpretation
inputs in this increment are explicitly RECORDED_TEST; live inference, token usage and
API spending are zero. The new schema's inference request preparation is disabled.
The ordinary finance upload page remains the preserved Increment 01 workflow and blocks
unavailable inference. No V2-to-C1 bridge, backend integration or production change is claimed.

**Next milestone:** securely authorized, budget-bounded genuine inference; evaluate
AI-generated blueprints against independent labels and the verified deterministic
baseline; measure both safe acceptance and unsupported/ambiguous cases; then review
the finance-user connection. Invoice/receipt normalization and bank movement accounting
interpretation require further policy work rather than convenient invented mappings.
