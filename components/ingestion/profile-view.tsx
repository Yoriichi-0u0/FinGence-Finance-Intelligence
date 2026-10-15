import { Panel } from "@/components/ui";
import type { Dataset, DatasetProfile } from "@/lib/ingestion/models";
import { sourceValue } from "./presentation";

export function ProfileView({ dataset, profile }: { dataset: Dataset; profile: DatasetProfile }) {
  return (
    <Panel title="2. Check file contents" className="mt-5" eyebrow={dataset.file.name + " · " + (dataset.sheet.name ?? "CSV")}>
      <div className="space-y-4 p-4 sm:p-5">
        <p className="text-sm text-[var(--muted-strong)]">Check that this is the right file and worksheet before choosing how its columns should be used.</p>
        <dl className="grid grid-cols-2 gap-4 text-sm lg:grid-cols-4">
          {[
            ["File", dataset.file.name], ["Worksheet / format", (dataset.sheet.name ?? "Single CSV dataset") + " / " + dataset.file.type],
            ["Rows / columns", profile.rowCount + " / " + profile.columnCount],
            ["Repeated rows", String(profile.duplicateRowCount)],
          ].map(([label, value]) => <div key={label}><dt className="text-xs text-[var(--muted)]">{label}</dt><dd className="mt-1 break-words font-semibold">{value}</dd></div>)}
        </dl>
        <p className="text-xs text-[var(--muted-strong)]">Repeated rows are not automatically removed. Blank rows and source values remain available for checking.</p>
        <details open>
          <summary className="cursor-pointer py-2 text-sm font-semibold">Original file preview · first {profile.sampleRows.length} rows</summary>
          <p className="my-2 text-xs text-[var(--muted)]">Scroll sideways to see all columns. These are values read from the file, before the checks.</p>
          <div tabIndex={0} role="region" aria-label="Original file preview, horizontally scrollable" className="max-h-96 overflow-auto rounded-lg border border-[var(--border)]">
            <table className="w-full whitespace-nowrap text-left text-xs">
              <thead className="sticky top-0 bg-slate-50"><tr><th scope="col" className="px-3 py-2">Source row</th>{dataset.columns.map((column, i) => <th scope="col" key={i} className="px-3 py-2">{column}</th>)}</tr></thead>
              <tbody>{profile.sampleRows.map(row => <tr key={row.rowNumber} className="border-t border-[var(--border)]">
                <th scope="row" className="px-3 py-2 font-semibold">{row.rowNumber}</th>
                {row.cells.map((value, index) => <td key={index} className="max-w-64 truncate px-3 py-2" title={sourceValue(value).slice(0, 1000)}>{sourceValue(value).slice(0, 200)}</td>)}
              </tr>)}</tbody>
            </table>
          </div>
        </details>
        <details>
          <summary className="cursor-pointer py-2 text-sm font-semibold">Blank cells by column</summary>
          <ul className="mt-2 grid gap-2 text-xs sm:grid-cols-2">{profile.columns.map((column, index) => <li key={index} className="flex justify-between gap-3 rounded border border-[var(--border)] p-3"><span className="min-w-0 break-words">{column.name}</span><span>{column.missing} blank</span></li>)}</ul>
        </details>
        <details>
          <summary className="cursor-pointer py-2 text-sm font-semibold">Technical file details</summary>
          <div className="mt-2 space-y-3 text-xs text-[var(--muted-strong)]">
            <p className="break-all">SHA-256: {dataset.file.fingerprint}</p>
            <p>Types describe the source values; profiling does not convert them. CSV source rows are logical record numbers including the header; Excel rows are worksheet positions.</p>
            <ul className="space-y-2">{profile.columns.map((column, index) => <li key={index}>{column.name} · inferred type: {column.inferredType} · missing: {column.missing}</li>)}</ul>
          </div>
        </details>
      </div>
    </Panel>
  );
}
