import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CircleDot,
  CircleEllipsis,
  Info,
  Sparkles,
} from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[27px] font-semibold leading-tight tracking-[-0.035em] text-[var(--ink)] sm:text-[30px]">
          {title}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)] sm:text-[15px]">{description}</p>
      </div>
      {actions ? <div className="min-w-0 max-w-full sm:w-auto sm:shrink-0">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  eyebrow,
  action,
  children,
  className = "",
}: {
  title?: string;
  eyebrow?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel-shadow min-w-0 rounded-xl border border-[var(--border)] bg-white ${className}`}>
      {title || action ? (
        <div className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3.5 sm:px-5">
          <div>
            {eyebrow ? (
              <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--teal)]">
                {eyebrow}
              </p>
            ) : null}
            {title ? <h2 className="text-[15px] font-semibold text-[var(--ink)] sm:text-base">{title}</h2> : null}
          </div>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  trend,
  comparison,
  icon,
  tone = "teal",
}: {
  label: string;
  value: string;
  trend: number;
  comparison: string;
  icon: React.ReactNode;
  tone?: "teal" | "indigo";
}) {
  const positive = trend >= 0;
  const TrendIcon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <article className="panel-shadow min-w-0 rounded-xl border border-[var(--border)] bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-[var(--muted-strong)]">{label}</p>
          <p className="mt-2 whitespace-nowrap text-[24px] font-semibold leading-none tracking-[-0.035em] text-[var(--ink)] sm:text-[27px]">
            {value}
          </p>
        </div>
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-full border ${
            tone === "teal"
              ? "border-teal-200 bg-[var(--teal-soft)] text-[var(--teal)]"
              : "border-indigo-200 bg-indigo-50 text-[var(--indigo)]"
          }`}
        >
          {icon}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className={`inline-flex items-center font-semibold ${positive ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
          <TrendIcon aria-hidden="true" className="mr-1" size={15} />
          {positive ? "+" : ""}{trend.toFixed(1)}%
        </span>
        <span className="text-[var(--muted)]">{comparison}</span>
      </div>
    </article>
  );
}

const statusStyles: Record<string, string> = {
  Matched: "bg-[var(--green-soft)] text-[var(--green)] ring-green-200",
  Suggested: "bg-blue-50 text-blue-700 ring-blue-200",
  Unmatched: "bg-slate-100 text-slate-700 ring-slate-200",
  Anomaly: "bg-[var(--red-soft)] text-[var(--red)] ring-red-200",
  Review: "bg-[var(--amber-soft)] text-[var(--amber)] ring-amber-200",
  Open: "bg-[var(--red-soft)] text-[var(--red)] ring-red-200",
  Reviewed: "bg-[var(--green-soft)] text-[var(--green)] ring-green-200",
  Investigating: "bg-blue-50 text-blue-700 ring-blue-200",
  Dismissed: "bg-slate-100 text-slate-600 ring-slate-200",
  Processed: "bg-[var(--green-soft)] text-[var(--green)] ring-green-200",
  Complete: "bg-[var(--green-soft)] text-[var(--green)] ring-green-200",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex min-h-6 items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
        statusStyles[status] ?? "bg-slate-100 text-slate-700 ring-slate-200"
      }`}
    >
      {status}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: "High" | "Medium" }) {
  const high = risk === "High";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${
        high
          ? "bg-[var(--red-soft)] text-[var(--red)] ring-red-200"
          : "bg-[var(--amber-soft)] text-[var(--amber)] ring-amber-200"
      }`}
    >
      <AlertTriangle aria-hidden="true" size={12} />
      {risk} Risk
    </span>
  );
}

export function ProgressBar({
  value,
  tone = "teal",
  label,
}: {
  value: number;
  tone?: "teal" | "indigo" | "amber";
  label?: string;
}) {
  const color = tone === "teal" ? "bg-[var(--teal)]" : tone === "indigo" ? "bg-[var(--indigo)]" : "bg-[var(--amber)]";
  return (
    <div>
      {label ? <span className="sr-only">{label}</span> : null}
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

export function PrototypeLabel() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--muted)]">
      <Info aria-hidden="true" size={14} />
      Mock prototype data
    </span>
  );
}

export function InsightIcon() {
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
      <Sparkles aria-hidden="true" size={18} />
    </span>
  );
}

export function ConfidenceRing({ value, size = "md" }: { value: number; size?: "sm" | "md" | "lg" }) {
  const dimensions = size === "sm" ? "size-14 text-sm" : size === "lg" ? "size-32 text-3xl" : "size-20 text-lg";
  const tone = value >= 90 ? "var(--teal)" : value >= 80 ? "var(--indigo)" : "var(--amber)";
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${dimensions}`}
      style={{
        color: tone,
        background: `radial-gradient(circle closest-side, white 81%, transparent 82%), conic-gradient(${tone} ${value}%, #e8edf2 0)`,
      }}
      aria-label={`${value}% confidence`}
    >
      {value}%
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-52 place-items-center px-6 py-12 text-center">
      <div>
        <CircleEllipsis aria-hidden="true" className="mx-auto text-slate-300" size={34} />
        <h3 className="mt-3 text-sm font-semibold">{title}</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-[var(--muted)]">{description}</p>
      </div>
    </div>
  );
}

export function PassBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-[var(--green-soft)] px-2 py-1 text-[10px] font-bold text-[var(--green)] ring-1 ring-inset ring-green-200">
      <Check aria-hidden="true" size={12} /> PASS
    </span>
  );
}

export function DotLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[var(--muted-strong)] sm:text-xs">
      <CircleDot aria-hidden="true" size={12} style={{ color }} fill={color} />
      {label}
    </span>
  );
}
