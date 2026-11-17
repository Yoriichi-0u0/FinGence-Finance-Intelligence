import { AlertTriangle, Link2, ShieldCheck, Sparkles } from "lucide-react";
import {
  FINANCIAL_EXPLANATION_LIMITATION_TEXT,
  formatReportMoney,
  type ValidatedFinancialExplanation,
} from "@/lib/ai-reporting";

function monetaryBasisText(value: string | null): string {
  if (value === "source_amount_with_direction") return "Source amount separated using the verified entry direction";
  if (value === "source_signed_amount") return "Original signed source amount";
  if (value === "debit_credit") return "Original debit or credit source field";
  if (value === "approved_interpretation") return "Approved financial interpretation";
  return "Source monetary basis not supplied";
}

export function AiExplanationPanel({ explanation }: { explanation: ValidatedFinancialExplanation }) {
  const references = new Map(explanation.references.map(reference => [reference.evidenceId, reference.label]));

  return (
    <article
      data-testid="ai-explanation-panel"
      className="w-full overflow-hidden rounded-xl border border-violet-200 bg-white shadow-[0_18px_55px_rgb(76_29_149/0.10)]"
    >
      <header className="border-b border-violet-200 bg-violet-50 px-5 py-5 sm:px-8">
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-violet-100 text-violet-700">
            <Sparkles aria-hidden="true" size={20} />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700">AI-assisted report explanation</p>
            <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em]">AI management summary</h2>
          </div>
        </div>
      </header>

      <div className="space-y-7 px-5 py-6 sm:px-8">
        <section aria-labelledby="ai-summary-heading">
          <h3 id="ai-summary-heading" className="text-sm font-semibold">AI-generated management summary</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{explanation.managementSummary}</p>
        </section>

        <section aria-labelledby="ai-observations-heading">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="ai-observations-heading" className="text-sm font-semibold">Verified evidence context</h3>
            <span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-800">Application-generated</span>
          </div>
          <div className="mt-3 space-y-3">
            {explanation.claims.map(({ claim }) => (
              <article key={claim.claimId} className="rounded-lg border border-[var(--border)] bg-slate-50 p-4">
                <p className="text-sm leading-6">{claim.text}</p>
                {claim.valueAssertions.length > 0 && (
                  <dl className="mt-3 grid gap-2 sm:grid-cols-2">
                    {claim.valueAssertions.map(assertion => {
                      const label = references.get(assertion.evidenceId) ?? "Validated source-field total";
                      return (
                        <div key={assertion.evidenceId} className="rounded-md bg-white p-3 ring-1 ring-inset ring-slate-200">
                          <dt className="text-[10px] font-medium leading-4 text-[var(--muted)]">{label}</dt>
                          <dd className="mt-1 text-base font-semibold">{formatReportMoney(assertion.currency, assertion.exactValue)}</dd>
                          <dd className="mt-1 text-[10px] leading-4 text-slate-500">{monetaryBasisText(assertion.monetaryBasis)}</dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
                <div className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-[var(--muted-strong)]">
                  <Link2 aria-hidden="true" className="mt-0.5 shrink-0" size={13} />
                  <span>Evidence: {claim.evidenceIds.map(id => references.get(id) ?? id).join("; ")}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4" aria-labelledby="ai-limitations-heading">
          <div className="flex gap-3">
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-amber-700" size={18} />
            <div>
              <h3 id="ai-limitations-heading" className="text-sm font-semibold text-amber-950">Limitations carried into the explanation</h3>
              <ul className="mt-2 list-inside list-disc space-y-1 text-xs leading-5 text-amber-950">
                {explanation.limitationCodes.map(code => <li key={code}>{FINANCIAL_EXPLANATION_LIMITATION_TEXT[code]}</li>)}
              </ul>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-teal-200 bg-[var(--teal-soft)] p-4 text-xs leading-5 text-slate-700" aria-label="AI explanation validation status">
          <div className="flex gap-3">
            <ShieldCheck aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--teal-dark)]" size={18} />
            <div>
              <p className="font-semibold text-[var(--teal-dark)]">Validation passed</p>
              <p className="mt-1">Figures and evidence are application-generated. Human review is required before this explanation is used.</p>
            </div>
          </div>
        </section>
      </div>
    </article>
  );
}
