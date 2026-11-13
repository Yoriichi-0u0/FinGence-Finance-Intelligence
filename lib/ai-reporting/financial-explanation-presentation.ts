import type { FinancialExplanationLimitationCode } from "./financial-explanation-schema";
import type { ValidatedFinancialExplanation } from "./financial-explanation-validation";
import { formatReportMoney } from "./report-presentation";

export const FINANCIAL_EXPLANATION_LIMITATION_TEXT: Readonly<Record<FinancialExplanationLimitationCode, string>> = {
  SOURCE_VALUES_NOT_FINANCIAL_STATEMENT_METRICS: "Supplied values and their totals are not automatically revenue, expenses, profit or cash flow.",
  WARNINGS_PRESENT: "Some included records have validation warnings and require attention.",
  REJECTED_ROWS_EXCLUDED: "Rejected rows are excluded from the evidence and report figures.",
  MISSING_CURRENCY: "At least one monetary value has no supplied currency.",
  MIXED_CURRENCY: "The evidence contains more than one currency; values are kept separate.",
  STATISTICAL_FLAGS_REQUIRE_REVIEW: "Statistical amount flags identify review candidates, not confirmed errors or fraud.",
  HUMAN_REVIEW_REQUIRED: "A person must review the wording and evidence before the explanation is used.",
};

export const FINANCIAL_EXPLANATION_HTML_CSS = `
.ai-explanation{border:2px solid #5b21b6;padding:12px 14px;background:#faf5ff}.ai-explanation h2{border-bottom-color:#7c3aed}.ai-label{margin:0 0 4px!important;color:#6d28d9;font-size:8px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.ai-status{border:1px solid #7c3aed;padding:7px 9px;font-size:9px;font-weight:700}.ai-claim{margin-top:10px;border-top:1px solid #c4b5fd;padding-top:8px;break-inside:avoid}.ai-values{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:7px}.ai-value{border:1px solid #ddd6fe;padding:6px;background:#fff}.ai-value span{display:block;color:#4b5563;font-size:7px}.ai-reference{color:#4b5563;font-size:8px;overflow-wrap:anywhere}.ai-limitations{margin-top:12px;border:1px solid #d97706;padding:8px;background:#fffbeb;font-size:9px}.ai-assurance{margin-top:12px;border-top:1px solid #111;padding-top:7px;font-size:8px}.ai-explanation code{overflow-wrap:anywhere;font-size:7px}
`.trim();

function escapeHtml(value: string | number | null): string {
  return String(value ?? "Not supplied")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Render an already-validated explanation. This function does not validate a
 * provider response and must never be called with raw model output.
 */
export function renderFinancialExplanationHtml(explanation: ValidatedFinancialExplanation): string {
  const references = new Map(explanation.references.map(reference => [reference.evidenceId, reference.label]));
  const claims = explanation.claims.map(({ claim }) => {
    const values = claim.valueAssertions.map(assertion => `<div class="ai-value"><span>${escapeHtml(references.get(assertion.evidenceId) ?? "Validated source-field total")}</span><strong>${escapeHtml(formatReportMoney(assertion.currency, assertion.exactValue))}</strong><span>${escapeHtml(assertion.monetaryBasis ?? "No monetary basis")}</span></div>`).join("");
    const citedEvidence = claim.evidenceIds.map(evidenceId => escapeHtml(references.get(evidenceId) ?? evidenceId)).join("; ");
    return `<article class="ai-claim"><p>${escapeHtml(claim.text)}</p>${values ? `<div class="ai-values">${values}</div>` : ""}<p class="ai-reference"><strong>Evidence:</strong> ${citedEvidence}</p></article>`;
  }).join("");
  const limitations = explanation.limitationCodes
    .map(code => `<li>${escapeHtml(FINANCIAL_EXPLANATION_LIMITATION_TEXT[code])}</li>`)
    .join("");

  return `<section class="section ai-explanation"><p class="ai-label">AI-assisted report explanation</p><h2>AI Management Summary - Requires Review</h2><p class="ai-status">The management summary is LLM-generated. The evidence context is application-generated from deterministic calculations. Semantic review and publication approval remain outstanding.</p><h3>AI-generated management summary</h3><p>${escapeHtml(explanation.managementSummary)}</p><h3>Verified evidence context - application-generated</h3>${claims}<div class="ai-limitations"><strong>Limitations carried into this explanation</strong><ul>${limitations}</ul></div><div class="ai-assurance"><strong>Assurance boundary.</strong> FinGence checked the model-authored summary and deterministically created the evidence observations with evidence IDs, exact value assertions, currency context and required caveats. These checks do not prove that every sentence is semantically entailed and do not authorize publication.<br><strong>Provider:</strong> ${escapeHtml(explanation.generation.provider)} · <strong>Model:</strong> ${escapeHtml(explanation.generation.modelIdentifier)} · <strong>Prompt:</strong> <code>${escapeHtml(explanation.generation.promptVersion)}</code><br><strong>Prompt source:</strong> <code>lib/ai-reporting/prompts/financial-explanation.ts</code></div></section>`;
}
