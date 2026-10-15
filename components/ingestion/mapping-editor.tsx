import { Panel } from "@/components/ui";
import { CANONICAL_FIELDS, type CanonicalField, type ColumnMapping, type DatasetProfile, type IngestionOptions } from "@/lib/ingestion/models";
import { columnExamples, FIELD_LABELS, mappingProblem } from "./presentation";

const inputStyle = "mt-1 min-h-11 w-full min-w-0 rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm";
const amountLabels = {
  debit_credit: "Separate Debit and Credit columns",
  signed_amount: "One amount column with positive/negative signs",
  amount_direction: "Non-negative amount plus a Debit/Credit label",
};
const dateLabels = { ISO: "Year-month-day only · 2026-09-01", DMY: "Day/month/year · also accepts year-month-day", MDY: "Month/day/year · also accepts year-month-day" };
const numberLabels = { plain: "Decimal point, no thousands separator · 1250.00", dot_comma: "Comma thousands, decimal point · 1,250.00", comma_dot: "Point thousands, decimal comma · 1.250,00" };
const policyLabels = { warn: "Include with attention", reject: "Cannot include", allow: "Allow under confirmed convention" };
export function MappingEditor({ mapping, profile, options, errors, reviewed, checked, disabled, onMapping, onOptions, onReviewed, onRun }: {
  mapping: ColumnMapping[]; profile: DatasetProfile; options: IngestionOptions; errors: string[];
  reviewed: boolean; checked: boolean; disabled: boolean;
  onMapping: (index: number, target: CanonicalField | null) => void;
  onOptions: (options: IngestionOptions) => void;
  onReviewed: (reviewed: boolean) => void; onRun: () => void;
}) {
  const change = <K extends keyof IngestionOptions>(key: K, value: IngestionOptions[K]) => onOptions({ ...options, [key]: value });
  const problems = errors.map(error => mappingProblem(error, mapping));
  return <>
    <Panel title="3. Confirm columns and financial conventions" className="mt-5" eyebrow="Your review is required">
      <fieldset disabled={disabled} className="min-w-0 space-y-5 p-4 sm:p-5">
        <legend className="sr-only">Column choices and financial conventions</legend>
        <p className="text-sm text-[var(--muted-strong)]">Choose what each column means. Suggested matches still need your review. Columns you do not use remain in the full check report.</p>
        <div className="space-y-3">
          {mapping.map(item => {
            const examples = columnExamples(profile, item.sourceIndex);
            const collision = item.target !== null && mapping.filter(other => other.target === item.target).length > 1;
            return <fieldset key={item.sourceIndex} className="min-w-0 rounded-lg border border-[var(--border)] p-3 lg:grid lg:grid-cols-[1fr_1fr_1.2fr] lg:items-start lg:gap-4">
              <legend className="sr-only">Column {item.sourceIndex + 1}: {item.sourceColumn}</legend>
              <div className="min-w-0"><p className="text-xs text-[var(--muted)]">Column {item.sourceIndex + 1} in your file</p><p className="mt-1 break-words text-sm font-semibold">{item.sourceColumn}</p>
                <p className="mt-1 text-xs text-[var(--muted-strong)]">{item.method === "manual" ? "Changed by you" : item.target === null ? "Choose a purpose or leave unused" : "Suggested — please review"}</p></div>
              <div className="my-3 min-w-0 text-xs lg:my-0" id={"column-example-" + item.sourceIndex}><p className="text-[var(--muted)]">Examples from this file</p>
                {examples.length ? examples.map(value => <p key={value} className="mt-1 break-words whitespace-pre-wrap" title={value.slice(0, 1000)}>{value.slice(0, 100)}</p>) : <p className="mt-1">No populated examples in the preview</p>}</div>
              <div className="min-w-0"><label htmlFor={"column-choice-" + item.sourceIndex} className="text-xs font-semibold">Use this column as</label>
                <select id={"column-choice-" + item.sourceIndex} aria-label={"Use " + item.sourceColumn + " (column " + (item.sourceIndex + 1) + ") as"}
                  aria-invalid={collision} aria-describedby={"column-example-" + item.sourceIndex + (collision ? " mapping-problems" : "")}
                  value={item.target ?? ""} onChange={event => onMapping(item.sourceIndex, (event.target.value || null) as CanonicalField | null)} className={inputStyle}>
                  <option value="">Do not use — original kept</option>
                  {CANONICAL_FIELDS.map(field => <option key={field} value={field}>{FIELD_LABELS[field]}</option>)}
                </select>
                {collision && <p className="mt-2 text-xs text-red-800">Another column also uses {FIELD_LABELS[item.target!]}. Review both choices below.</p>}
              </div>
            </fieldset>;
          })}
        </div>
        <details>
          <summary className="cursor-pointer py-2 text-sm font-semibold">Column-matching technical details</summary>
          <p className="mt-2 text-xs text-[var(--muted-strong)]">Scores describe name-matching strength, not the probability that an accounting interpretation is correct.</p>
          <ul className="mt-3 space-y-2 text-xs">{mapping.map(item => <li key={item.sourceIndex} className="break-words">{item.sourceColumn} → {item.target ?? "unmapped"} · {item.method} · score {item.confidence === null ? "not scored" : item.confidence.toFixed(2)} · user_confirmed: {String(item.userConfirmed)}</li>)}</ul>
          {errors.length > 0 && <ul className="mt-3 space-y-1 text-xs">{errors.map(error => <li key={error}>{error}</li>)}</ul>}
        </details>
        <fieldset className="min-w-0 space-y-4 rounded-lg bg-slate-50 p-4">
          <legend className="px-1 text-sm font-semibold">Financial conventions for these records</legend>
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="min-w-0 text-xs font-semibold">Source name
              <input value={options.sourceSystem} maxLength={120} onChange={event => change("sourceSystem", event.target.value)} className={inputStyle} />
            </label>
            <label className="min-w-0 text-xs font-semibold">How does this file record amounts?
              <select value={options.monetaryMode} onChange={event => change("monetaryMode", event.target.value as IngestionOptions["monetaryMode"])} className={inputStyle}>
                {Object.entries(amountLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-xs font-semibold">Which date should be used for these records?
              <select value={options.dateBasis} aria-describedby="date-choice-help" onChange={event => change("dateBasis", event.target.value as IngestionOptions["dateBasis"])} className={inputStyle}>
                <option value="transaction_date">Transaction date</option><option value="posting_date">Posting date</option>
              </select>
            </label>
            <p id="date-choice-help" className="self-center text-xs text-[var(--muted-strong)]">This determines the date used when these records are checked and added to the combined records. Both source dates are kept. If the selected date is blank or unreadable, the other date is not substituted.</p>
            <label className="min-w-0 text-xs font-semibold">How are text dates written?
              <select value={options.dateOrder} onChange={event => change("dateOrder", event.target.value as IngestionOptions["dateOrder"])} className={inputStyle}>
                {Object.entries(dateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-xs font-semibold">How are text amounts written?
              <select value={options.numberFormat} onChange={event => change("numberFormat", event.target.value as IngestionOptions["numberFormat"])} className={inputStyle}>
                {Object.entries(numberLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="min-w-0 text-xs font-semibold">Currency to use when the file leaves it blank
              <input value={options.currencyDefault ?? ""} placeholder="Leave blank unless confirmed · e.g. MYR" maxLength={12}
                onChange={event => change("currencyDefault", event.target.value || null)} className={inputStyle} />
            </label>
            <p className="self-center text-xs text-[var(--muted-strong)]">A selected default applies only to blank currency values; it does not convert amounts. Currency checks cover three-letter format, not the official code list. Excel number cells use their stored numeric values.</p>
          </div>
          {options.monetaryMode === "debit_credit" && <fieldset className="min-w-0 space-y-3 rounded-lg border border-[var(--border)] p-3 text-xs">
            <legend className="px-1 font-semibold">Ledger handling — provisional, confirm the source convention</legend>
            <label className="flex min-h-11 items-start gap-3 py-2"><input type="checkbox" checked={options.blankSideAsZero} onChange={event => change("blankSideAsZero", event.target.checked)} className="mt-0.5" /><span>Treat a blank Debit or Credit as 0 only when the other side is populated.</span></label>
            <label className="block">If Debit or Credit is negative
              <select value={options.negativeDebitCredit} onChange={event => change("negativeDebitCredit", event.target.value as IngestionOptions["negativeDebitCredit"])} className={inputStyle}>
                <option value="warn">Include with attention — may be a reversal or adjustment</option><option value="reject">Cannot include — source convention confirmed</option><option value="allow">Allow — source convention confirmed</option>
              </select>
            </label>
            <label className="block">If both Debit and Credit are nonzero
              <select value={options.bothDebitCredit} onChange={event => change("bothDebitCredit", event.target.value as IngestionOptions["bothDebitCredit"])} className={inputStyle}>
                <option value="warn">Include with attention — unusual source structure</option><option value="reject">Cannot include — source convention confirmed</option><option value="allow">Allow — source convention confirmed</option>
              </select>
            </label>
            <p className="text-[var(--muted-strong)]">Debit and Credit are retained separately. A ledger-derived net is a convenience field, not universal cash flow; it is not combined with bank amounts.</p>
          </fieldset>}
        </fieldset>
        {errors.length > 0 && <div id="mapping-problems" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          <p className="font-semibold">Resolve these choices before checking</p><ul className="mt-2 list-inside list-disc space-y-2">{problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>
        </div>}
      </fieldset>
    </Panel>
    <Panel title="4. Approve and check" className="mt-5">
      <fieldset disabled={disabled} className="min-w-0 space-y-4 p-4 sm:p-5">
        <legend className="sr-only">Review confirmation</legend>
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          {[["Amount convention", amountLabels[options.monetaryMode]], ["Date used", FIELD_LABELS[options.dateBasis]],
            ["Text dates", dateLabels[options.dateOrder]], ["Text amounts", numberLabels[options.numberFormat]],
            ["Blank currency", options.currencyDefault || "No default selected"], ["Columns not used", String(mapping.filter(item => item.target === null).length)],
            ...(options.monetaryMode === "debit_credit" ? [["Blank ledger side", options.blankSideAsZero ? "Treat as 0 when other side is populated" : "Keep blank"],
              ["Negative sides / both nonzero", policyLabels[options.negativeDebitCredit] + " / " + policyLabels[options.bothDebitCredit]]] : []),
          ].map(([label, value]) => <div key={label}><dt className="text-[var(--muted)]">{label}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>)}
        </dl>
        <p className="text-xs text-[var(--muted-strong)]">{checked ? "These settings were used for this file's current results. Changing them removes its results until you review and check it again." : "Confirm the column choices, unused columns and financial conventions above. Confirming this review does not add records until you run the checks."}</p>
        <label className="flex min-h-11 items-start gap-3 rounded-lg border border-[var(--border)] p-3 text-sm">
          <input type="checkbox" checked={reviewed} onChange={event => onReviewed(event.target.checked)} className="mt-1" />
          <span>I have reviewed the column choices, unused columns, dates, amounts, currency and any ledger handling.</span>
        </label>
        <p className="text-xs text-[var(--muted-strong)]">{errors.length ? "Resolve the highlighted choices before checking." : reviewed ? "Review confirmed. You can now run the checks." : "Confirm your review to enable the checks."}</p>
        <button type="button" disabled={disabled || !reviewed || errors.length > 0} onClick={onRun} className="min-h-11 rounded-lg bg-[var(--teal)] px-4 text-sm font-semibold text-white hover:bg-[var(--teal-dark)] disabled:cursor-not-allowed disabled:opacity-50">Check and add to this session</button>
      </fieldset>
    </Panel>
  </>;
}
