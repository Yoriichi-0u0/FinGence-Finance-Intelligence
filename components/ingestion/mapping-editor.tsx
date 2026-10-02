import { Panel } from "@/components/ui";
import { CANONICAL_FIELDS, type CanonicalField, type ColumnMapping, type IngestionOptions } from "@/lib/ingestion/models";

const inputStyle = "mt-1 min-h-10 w-full rounded-lg border border-[var(--border-strong)] bg-white px-3 text-sm";
export function MappingEditor({ mapping, options, errors, reviewed, onMapping, onOptions, onReviewed, onRun }: {
  mapping: ColumnMapping[]; options: IngestionOptions; errors: string[]; reviewed: boolean;
  onMapping: (index: number, target: CanonicalField | null) => void;
  onOptions: (options: IngestionOptions) => void;
  onReviewed: (reviewed: boolean) => void;
  onRun: () => void;
}) {
  const change = <K extends keyof IngestionOptions>(key: K, value: IngestionOptions[K]) => onOptions({ ...options, [key]: value });
  return (
    <Panel title="2. Review mapping and source conventions" className="mt-5" eyebrow="Approval required">
      <div className="space-y-5 p-4 sm:p-5">
        <p className="text-sm text-[var(--muted-strong)]">Correct any suggested target before continuing. Ignored columns remain in raw evidence. Scores describe matching strength, not the probability that a financial interpretation is correct.</p>
        <div className="max-h-96 overflow-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50"><tr><th className="px-3 py-2">Source column</th><th className="px-3 py-2">Canonical target</th><th className="px-3 py-2">Suggestion / provenance</th></tr></thead>
            <tbody>{mapping.map(item => <tr key={item.sourceIndex} className="border-t border-[var(--border)]">
              <td className="px-3 py-2 font-medium">{item.sourceColumn}</td>
              <td className="px-3 py-2">
                <select aria-label={"Map " + item.sourceColumn} value={item.target ?? ""} onChange={event => onMapping(item.sourceIndex, (event.target.value || null) as CanonicalField | null)} className="min-h-9 w-full min-w-44 rounded-md border border-[var(--border-strong)] bg-white px-2">
                  <option value="">Ignore · raw retained</option>
                  {CANONICAL_FIELDS.map(field => <option key={field} value={field}>{field}</option>)}
                </select>
              </td>
              <td className="px-3 py-2 text-[var(--muted-strong)]">{item.confidence === null ? "—" : item.confidence.toFixed(2)} · {item.method.replaceAll("_", " ")}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className="text-xs font-semibold">Source-system label
            <input value={options.sourceSystem} maxLength={120} onChange={event => change("sourceSystem", event.target.value)} className={inputStyle} />
          </label>
          <label className="text-xs font-semibold">Monetary representation
            <select value={options.monetaryMode} onChange={event => change("monetaryMode", event.target.value as IngestionOptions["monetaryMode"])} className={inputStyle}>
              <option value="debit_credit">Debit / credit · retain both sides</option><option value="signed_amount">Signed source amount · preserve sign</option><option value="amount_direction">Unsigned amount + Debit/Credit direction</option>
            </select>
          </label>
          <label className="text-xs font-semibold">Canonical date source
            <select value={options.dateBasis} onChange={event => change("dateBasis", event.target.value as IngestionOptions["dateBasis"])} className={inputStyle}>
              <option value="transaction_date">Transaction date · retain both dates</option><option value="posting_date">Posting date · retain both dates</option>
            </select>
          </label>
          <label className="text-xs font-semibold">Text date convention
            <select value={options.dateOrder} onChange={event => change("dateOrder", event.target.value as IngestionOptions["dateOrder"])} className={inputStyle}>
              <option value="ISO">ISO only · YYYY-MM-DD</option><option value="DMY">Day / month / year · also accepts ISO</option><option value="MDY">Month / day / year · also accepts ISO</option>
            </select>
          </label>
          <label className="text-xs font-semibold">Text number convention
            <select value={options.numberFormat} onChange={event => change("numberFormat", event.target.value as IngestionOptions["numberFormat"])} className={inputStyle}>
              <option value="plain">Decimal dot · no thousands separator</option><option value="dot_comma">1,250.00 · comma thousands, decimal dot</option><option value="comma_dot">1.250,00 · dot thousands, decimal comma</option>
            </select>
          </label>
          <label className="text-xs font-semibold">Explicit default currency
            <input value={options.currencyDefault ?? ""} placeholder="None · e.g. MYR if explicitly confirmed" maxLength={12} onChange={event => change("currencyDefault", event.target.value || null)} className={inputStyle} />
          </label>
        </div>
        <p className="text-xs text-[var(--muted)]">Transaction and posting dates retain their source meanings. Canonical date uses only the selected date; missing or invalid input is rejected without fallback. Excel numeric cells use stored numeric values. Currency checks cover three-letter structure, not authoritative ISO membership.</p>
        {options.monetaryMode === "debit_credit" && <fieldset className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs">
          <legend className="px-1 font-semibold">Provisional ledger rules</legend>
          <label className="flex items-start gap-2"><input type="checkbox" checked={options.blankSideAsZero} onChange={event => change("blankSideAsZero", event.target.checked)} className="mt-0.5" /><span>Convert a blank debit/credit side to zero only when the other side is populated.</span></label>
          <label className="block">Negative debit / credit
            <select value={options.negativeDebitCredit} onChange={event => change("negativeDebitCredit", event.target.value as IngestionOptions["negativeDebitCredit"])} className={inputStyle}>
              <option value="warn">Warn · may be a reversal or adjustment</option><option value="reject">Reject · source convention confirmed</option><option value="allow">Allow · source convention confirmed</option>
            </select>
          </label>
          <label className="block">Both debit and credit nonzero
            <select value={options.bothDebitCredit} onChange={event => change("bothDebitCredit", event.target.value as IngestionOptions["bothDebitCredit"])} className={inputStyle}>
              <option value="warn">Warn · unusual source structure</option><option value="reject">Reject · source convention confirmed</option><option value="allow">Allow · source convention confirmed</option>
            </select>
          </label>
          <p className="text-[var(--muted)]">Ledger net is an explicitly labelled convenience value. It is not universal cash flow and is not summed with bank amounts.</p>
        </fieldset>}
        {errors.length > 0 && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert"><p className="font-semibold">Resolve before validation</p><ul className="mt-2 list-inside list-disc">{errors.map(error => <li key={error}>{error}</li>)}</ul></div>}
        <label className="flex items-start gap-3 rounded-lg border border-[var(--border)] p-3 text-sm">
          <input type="checkbox" checked={reviewed} onChange={event => onReviewed(event.target.checked)} className="mt-1" />
          <span>I reviewed the mappings, ignored columns, date/number conventions, and amount meaning.</span>
        </label>
        <button type="button" disabled={!reviewed || errors.length > 0} onClick={onRun} className="min-h-10 rounded-lg bg-[var(--teal)] px-4 text-sm font-semibold text-white hover:bg-[var(--teal-dark)] disabled:cursor-not-allowed disabled:opacity-50">Validate and normalize</button>
      </div>
    </Panel>
  );
}
