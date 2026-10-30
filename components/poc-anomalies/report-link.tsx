import Link from "next/link";
import { FileText } from "lucide-react";
import { Panel } from "@/components/ui";

/** Local M5 only: points Finance users from Reports to the source-derived management report. */
export default function ManagementReportLink() {
  return (
    <Panel title="PoC management report" eyebrow="Synthetic source data" className="mt-4">
      <div className="flex flex-col gap-3 p-5 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[var(--muted-strong)]">Download a PDF with signed cash movement, anomaly review counts, exceptions and reconciliation status for one business and period of an uploaded source.</p>
        <Link href="/anomalies#management-report" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-teal-800 px-4 text-sm font-semibold text-white hover:bg-teal-900"><FileText aria-hidden="true" size={16} /> Open report</Link>
      </div>
    </Panel>
  );
}
