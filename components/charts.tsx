"use client";

import { useId, useMemo, useState } from "react";

export type ChartSeries = {
  label: string;
  color: string;
  values: Array<number | null>;
  dashed?: boolean;
  fill?: boolean;
};

export function LineChart({
  labels,
  series,
  height = 250,
  formatValue = (value) => `${Math.round(value / 1000)}K`,
  ariaLabel,
}: {
  labels: string[];
  series: ChartSeries[];
  height?: number;
  formatValue?: (value: number) => string;
  ariaLabel: string;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const gradientId = useId().replace(/:/g, "");
  const width = 760;
  const padding = { top: 52, right: 18, bottom: 38, left: 52 };
  const values = series.flatMap((item) => item.values.filter((value): value is number => value !== null));
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(0, ...values);
  const roundedMax = Math.ceil(maxValue / 50_000) * 50_000 || maxValue;
  const range = roundedMax - minValue || 1;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index: number) => padding.left + (index / Math.max(1, labels.length - 1)) * plotWidth;
  const y = (value: number) => padding.top + (1 - (value - minValue) / range) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => minValue + range * fraction);

  const pathFor = (item: ChartSeries) => {
    let path = "";
    let drawing = false;
    item.values.forEach((value, index) => {
      if (value === null) {
        drawing = false;
        return;
      }
      path += `${drawing ? " L" : "M"} ${x(index).toFixed(2)} ${y(value).toFixed(2)}`;
      drawing = true;
    });
    return path;
  };

  const tooltipSeries = hoveredIndex === null ? [] : series.filter((item) => item.values[hoveredIndex] !== null);
  const tooltipX = hoveredIndex === null ? padding.left : Math.min(width - 160, Math.max(padding.left, x(hoveredIndex) - 68));

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full overflow-visible"
        role="img"
        aria-label={ariaLabel}
        onPointerLeave={() => setHoveredIndex(null)}
      >
        <defs>
          {series.map((item, index) => (
            <linearGradient key={item.label} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={item.color} stopOpacity="0.15" />
              <stop offset="1" stopColor={item.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="#dfe6ec"
              strokeDasharray="3 4"
            />
            <text x={padding.left - 10} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="#667085">
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {series.map((item, index) => {
          const path = pathFor(item);
          return (
            <g key={item.label}>
              {item.fill && path ? (
                <path
                  d={`${path} L ${x(item.values.length - 1)} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`}
                  fill={`url(#${gradientId}-${index})`}
                />
              ) : null}
              <path
                d={path}
                fill="none"
                stroke={item.color}
                strokeWidth="2.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={item.dashed ? "6 6" : undefined}
              />
              {item.values.map((value, pointIndex) =>
                value === null ? null : (
                  <circle
                    key={`${item.label}-${pointIndex}`}
                    cx={x(pointIndex)}
                    cy={y(value)}
                    r={hoveredIndex === pointIndex ? 5 : 3.4}
                    fill="white"
                    stroke={item.color}
                    strokeWidth="2"
                  />
                ),
              )}
            </g>
          );
        })}

        {labels.map((label, index) => (
          <g key={label}>
            <rect
              x={x(index) - Math.max(18, plotWidth / labels.length / 2)}
              y={padding.top}
              width={Math.max(36, plotWidth / labels.length)}
              height={plotHeight}
              fill="transparent"
              onPointerEnter={() => setHoveredIndex(index)}
            />
            <text
              x={x(index)}
              y={height - 12}
              textAnchor="middle"
              fontSize={labels.length > 9 ? "10" : "11"}
              fill="#667085"
            >
              {label}
            </text>
          </g>
        ))}

        {hoveredIndex !== null ? (
          <g pointerEvents="none">
            <line
              x1={x(hoveredIndex)}
              x2={x(hoveredIndex)}
              y1={padding.top}
              y2={height - padding.bottom}
              stroke="#98a2b3"
              strokeDasharray="3 4"
            />
            <rect
              x={tooltipX}
              y={4}
              width="150"
              height={24 + tooltipSeries.length * 16}
              rx="7"
              fill="#102a43"
              opacity="0.96"
            />
            <text x={tooltipX + 10} y={20} fontSize="10" fontWeight="600" fill="white">
              {labels[hoveredIndex]}
            </text>
            {tooltipSeries.map((item, index) => {
              const value = item.values[hoveredIndex];
              if (value === null) return null;
              return (
                <text key={item.label} x={tooltipX + 10} y={37 + index * 16} fontSize="10" fill="white">
                  {item.label}: {formatValue(value)}
                </text>
              );
            })}
          </g>
        ) : null}
      </svg>
      <div className="mt-1 flex flex-wrap justify-center gap-x-5 gap-y-2">
        {series.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-2 text-[11px] text-[var(--muted-strong)]">
            <span
              className={`h-0.5 w-6 ${item.dashed ? "border-t-2 border-dashed bg-transparent" : ""}`}
              style={item.dashed ? { borderColor: item.color } : { backgroundColor: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DonutChart({
  segments,
  center,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  center?: React.ReactNode;
}) {
  const gradient = useMemo(
    () =>
      `conic-gradient(${segments
        .map((segment, index) => {
          const start = segments
            .slice(0, index)
            .reduce((total, previousSegment) => total + previousSegment.value, 0);
          return `${segment.color} ${start}% ${start + segment.value}%`;
        })
        .join(", ")})`,
    [segments],
  );

  return (
    <div
      className="grid aspect-square w-32 shrink-0 place-items-center rounded-full sm:w-36"
      style={{ background: gradient }}
      role="img"
      aria-label={segments.map((segment) => `${segment.label} ${segment.value}%`).join(", ")}
    >
      <div className="grid size-[62%] place-items-center rounded-full bg-white text-center text-sm font-semibold text-[var(--ink)]">
        {center ?? "100%"}
      </div>
    </div>
  );
}

export function ComparisonBars({
  rows,
  max,
}: {
  rows: Array<{ label: string; primary: number; secondary: number }>;
  max?: number;
}) {
  const ceiling = max ?? Math.max(...rows.flatMap((row) => [row.primary, row.secondary]));
  return (
    <div className="space-y-4">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="font-medium text-[var(--muted-strong)]">{row.label}</span>
            <span className="text-[var(--muted)]">
              {Math.round(row.primary / 1000)}K / {Math.round(row.secondary / 1000)}K
            </span>
          </div>
          <div className="space-y-1">
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-[var(--teal)]" style={{ width: `${(row.primary / ceiling) * 100}%` }} />
            </div>
            <div className="h-2 rounded-full bg-slate-100">
              <div className="h-2 rounded-full bg-[var(--indigo)]" style={{ width: `${(row.secondary / ceiling) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
