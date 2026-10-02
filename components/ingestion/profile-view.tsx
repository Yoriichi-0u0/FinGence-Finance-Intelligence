import { Panel } from "@/components/ui";
import type { Dataset, DatasetProfile } from "@/lib/ingestion/models";
import { rawText } from "@/lib/ingestion/normalizer";

export function ProfileView({ dataset, profile }: { dataset: Dataset; profile: DatasetProfile }) {
  return (
    <Panel title="1. Source profile" className="mt-5" eyebrow="Raw evidence">
      <div className="space-y-4 p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          {[
            ["File", dataset.file.name], ["Format / sheet", dataset.file.type + " / " + (dataset.sheet.name ?? "CSV")],
            ["Data rows / columns", profile.rowCount + " / " + profile.columnCount],
            ["Repeated raw rows", String(profile.duplicateRowCount)],
          ].map(([label, value]) => <div key={label}><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>)}
        </dl>
        <p className="break-all text-xs text-[var(--muted)]">SHA-256: {dataset.file.fingerprint}</p>
        <p className="text-xs text-[var(--muted-strong)]">Types describe the source values; profiling does not convert them. Blank data rows remain visible. CSV source rows are logical record numbers, including the header; Excel rows are worksheet positions.</p>
        <div className="max-h-72 overflow-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50"><tr><th className="px-3 py-2">Detected column</th><th className="px-3 py-2">Inferred type</th><th className="px-3 py-2">Missing values</th></tr></thead>
            <tbody>{profile.columns.map((column, index) => <tr key={index} className="border-t border-[var(--border)]"><td className="px-3 py-2 font-medium">{column.name}</td><td className="px-3 py-2">{column.inferredType}</td><td className="px-3 py-2">{column.missing}</td></tr>)}</tbody>
          </table>
        </div>
        <details open>
          <summary className="cursor-pointer text-sm font-semibold">Raw preview · first {profile.sampleRows.length} records</summary>
          <div className="mt-3 overflow-auto rounded-lg border border-[var(--border)]">
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="bg-slate-50"><tr><th className="px-3 py-2">Source row</th>{dataset.columns.map((column, i) => <th key={i} className="px-3 py-2">{column}</th>)}</tr></thead>
              <tbody>{profile.sampleRows.map(row => <tr key={row.rowNumber} className="border-t border-[var(--border)]">
                <td className="px-3 py-2 font-semibold">{row.rowNumber}</td>
                {row.cells.map((value, index) => <td key={index} className="max-w-64 truncate px-3 py-2" title={rawText(value).slice(0, 1000)}>{value === null || value === "" ? "∅" : rawText(value).slice(0, 200)}</td>)}
              </tr>)}</tbody>
            </table>
          </div>
        </details>
      </div>
    </Panel>
  );
}
