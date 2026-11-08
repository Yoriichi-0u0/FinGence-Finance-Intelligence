# Experimental semantic and reuse boundary

## Pipeline and authority

Exact synthetic bytes → existing CSV/XLSX parser or local Docling/RapidOCR →
0.2 source evidence → recorded test proposal → independent semantic/fidelity checks →
unchanged deterministic normalizer/validator → separate accepted/rejected/unresolved results.

The authority of `experimental-financial-terminology-0.2` is
**EXPERIMENTAL_SYNTHETIC_POLICY**, not a SAIC or accountant-approved policy.
The registry is deterministic, reviewed test infrastructure. Meaningful LLM rule synthesis
is the next milestone; no claim of learned or autonomous semantic understanding is made.

`v2-evidence-0.2`, `v2-blueprint-0.2`, `v2-template-0.2` and `v2-verification-0.2`
are experimental types. Existing canonical schema/ruleset **0.1**, C1, C2, C3 and
Increment 01 0.1 experiment types are unchanged. V2 outputs are not cast to approved
`IngestionResult[]` or C1 accepted transactions.

Each source column receives one disposition: FINANCIAL, SUPPORTING_METADATA,
NONFINANCIAL_NARRATIVE or UNRESOLVED. Every populated source cell and extracted
context region must be accounted for. No field is discarded merely because it lacks a
normalization target. Proposals contain bounded declarative rules, not executable code.

The verifier checks literal/typed evidence agreement, source identity, one-to-one row
and column bindings, no reused cells, independent terminology and document context,
source coverage, and independently unambiguous date/number meanings. LLM confidence
is not a proof. Unsupported assumptions cannot authorize a decision. Source text is
untrusted data; a small instruction-pattern check is defense in depth, not a complete
prompt-injection detector.

## Financial safeguards

- Bank Money In/Payment Out are recognized as bank movements and held unresolved.
  They never become general-ledger debit/credit, revenue, expenses or signed cash flow.
- Debit/credit mapping requires actual GENERAL LEDGER context. A bank statement cannot
  authorize that interpretation. Source amount plus DEBIT/CREDIT direction remains a
  separate existing representation; IN/OUT is not silently converted.
- Amounts and identifiers remain exact strings. No floating-point financial arithmetic,
  currency conversion, inferred currency default, missing-date fallback or automatic
  blank-side-to-zero is introduced.
- Multiple possible date/number meanings are unresolved. Invalid known financial values
  are rejected by the existing validator; missing required evidence remains unresolved.
- Invoice/receipt extraction is supported, but invoice-to-transaction normalization is
  unsupported. Line totals, tax and document totals are never promoted to transactions.
- Supporting/narrative exclusions use explicit, rule-specific value allowlists.
  For example, Operations/Finance and Reviewed by clerk/Pending filing are synthetic
  administrative cases. Arbitrary free text, Commission RM 50.00, Paid JPY 5000 and
  unexplained numbers are held with EXCLUSION_NOT_JUSTIFIED. A blacklist of currency
  symbols cannot establish that a value is nonfinancial. Unknown legitimate notes may
  therefore require review; this is an intentional conservative limitation.

## Extraction fidelity

The new adapter reuses existing spreadsheet readers and a small local Docling wrapper.
It retains contextual text alongside table cells. Text is deduplicated only when its
literal whitespace-normalized contents match an emitted cell on the same page and its
region is contained in that cell (one coordinate-unit tolerance). A table's outer
rectangle does not establish that its contents were represented. Ambiguous merged
cells, incomplete conversion/pages and uncertain headers block acceptance.

Bounded sources: 10 MiB, four pages/worksheets, 12 megapixels, 50 financial rows,
16 spreadsheet columns, 2,000 evidence items, external worker timeout 120 seconds and
4 MiB worker output. Bounds and extractor errors fail closed; they are not proof that
arbitrary financial layouts can be extracted. Source coordinates are retained where
the extractor supplies them; no region or missing row count is fabricated.

## Blueprint reuse

Only a fully verified proposal with accepted rows can create a template. Templates keep
policy/version, original test/live origin, document kind, conventions and unique
semantic selectors. They contain no source hash, old monetary values, evidence IDs,
geometry or hardcoded column positions. Rebinding uses fresh evidence and runs the full
verifier again. Registered alternate headings/reordered columns can work across formats;
new approved administrative metadata can be retained. Missing/unknown financial fields,
ambiguous conventions or changed structure require reinterpretation. Repeated selectors
are deliberately unsupported. Reuse does not bypass checks or become a saved production
mapping profile. Template origin is a trusted internal attribute, not cryptographic proof.

## Local developer boundary and future integration

The developer page/API require development mode, FINGENCE_AI_LOCAL=1,
FINGENCE_AI_DEVELOPER_REPLAY=1, loopback host/origin and no VERCEL environment.
The API accepts only registered case/variant identifiers, with a 2 KiB request bound;
it does not accept arbitrary files, paths or supplied blueprints. Production returns
404 even with replay flags set. These are local PoC controls, not authentication/RBAC.

The finance page and its original API remain unchanged. Adding replay fields to the
normal upload API cannot activate a recorded provider. The 0.2 inference request builder
is server-only and returns DISABLED_FOR_INCREMENT_02; it performs no dispatch. No
credentials were created/read through a setup flow, and no inference usage occurred.
The original US$5 application budget guard remains unchanged and unspent.

No V2-to-C1 bridge is implemented. Celester's grouped internal persistence still consumes
trusted `IngestionResult[]`; C1 is a distinct reduced projection for downstream consumers.
No backend persistence, analytics, security, reconciliation or accounting-policy ownership
is transferred to this experiment. Client confirmation of financial conventions and
backend trust-boundary validation remain required before production integration.
