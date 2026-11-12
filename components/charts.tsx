"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ChartSeries = {
  label: string;
  color: string;
  values: Array<number | null>;
  dashed?: boolean;
  fill?: boolean;
};

/** A "nice" axis ceiling (1, 2, 2.5 or 5 times a power of ten) so ticks read as round figures. */
function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value) ?? 10;
  return step * power;
}

export function LineChart({
  labels,
  series,
  height: preferredHeight = 250,
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
  // The chart is drawn at its real width, so its text stays legible on a phone instead of being scaled down.
  const frame = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(760);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setMeasured(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const width = measured;
  const compact = width < 520;
  const height = compact ? Math.min(preferredHeight, 230) : preferredHeight;
  const padding = { top: 24, right: compact ? 10 : 18, bottom: 34, left: compact ? 44 : 56 };
  const values = series.flatMap((item) => item.values.filter((value): value is number => value !== null));
  const maxValue = Math.max(...values, 0);
  const minValue = Math.min(0, ...values);
  const roundedMax = maxValue > 0 ? niceCeiling(maxValue) : 0;
  const roundedMin = minValue < 0 ? -niceCeiling(-minValue) : 0;
  const range = roundedMax - roundedMin || 1;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const x = (index: number) => padding.left + (labels.length === 1 ? plotWidth / 2 : (index / Math.max(1, labels.length - 1)) * plotWidth);
  const y = (value: number) => padding.top + (1 - (value - roundedMin) / range) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => roundedMin + range * fraction);
  // Only every n-th label is written when the labels would otherwise collide.
  const labelEvery = Math.max(1, Math.ceil((labels.length * (compact ? 34 : 40)) / plotWidth));

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
  const tooltipWidth = 168;
  const tooltipX = hoveredIndex === null ? padding.left : Math.min(width - tooltipWidth - 2, Math.max(2, x(hoveredIndex) - tooltipWidth / 2));
  const zeroY = y(0);

  return (
    <div className="w-full" ref={frame}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block h-auto max-w-full overflow-visible"
        role="img"
        aria-label={ariaLabel}
        onPointerLeave={() => setHoveredIndex(null)}
      >
        <defs>
          {series.map((item, index) => (
            <linearGradient key={item.label} id={`${gradientId}-${index}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={item.color} stopOpacity="0.22" />
              <stop offset="1" stopColor={item.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} stroke="var(--chart-grid)" strokeDasharray={tick === 0 ? undefined : "2 5"} />
            <text x={padding.left - 8} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {roundedMin < 0 ? <line x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" /> : null}

        {series.map((item, index) => {
          const path = pathFor(item);
          return (
            <g key={item.label}>
              {item.fill && path ? (
                <path
                  d={`${path} L ${x(item.values.findLastIndex((v) => v !== null))} ${zeroY} L ${x(item.values.findIndex((v) => v !== null))} ${zeroY} Z`}
                  fill={`url(#${gradientId}-${index})`}
                />
              ) : null}
              <path
                d={path}
                fill="none"
                stroke={item.color}
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={item.dashed ? "6 6" : undefined}
              />
              {item.values.map((value, pointIndex) =>
                value === null || (labels.length > 24 && hoveredIndex !== pointIndex) ? null : (
                  <circle
                    key={`${item.label}-${pointIndex}`}
                    cx={x(pointIndex)}
                    cy={y(value)}
                    r={hoveredIndex === pointIndex ? 5 : 3}
                    fill="var(--surface)"
                    stroke={item.color}
                    strokeWidth="2"
                  />
                ),
              )}
            </g>
          );
        })}

        {labels.map((label, index) => (
          <g key={`${label}-${index}`}>
            <rect
              x={x(index) - Math.max(10, plotWidth / labels.length / 2)}
              y={padding.top}
              width={Math.max(20, plotWidth / labels.length)}
              height={plotHeight}
              fill="transparent"
              onPointerEnter={() => setHoveredIndex(index)}
              onPointerDown={() => setHoveredIndex(index)}
            />
            {index % labelEvery === 0 ? (
              <text x={x(index)} y={height - 12} textAnchor="middle" fontSize="11" fill="var(--muted)">
                {label}
              </text>
            ) : null}
          </g>
        ))}

        {hoveredIndex !== null ? (
          <g pointerEvents="none">
            <line x1={x(hoveredIndex)} x2={x(hoveredIndex)} y1={padding.top} y2={height - padding.bottom} stroke="var(--border-strong)" strokeDasharray="3 4" />
            <rect x={tooltipX} y={2} width={tooltipWidth} height={24 + tooltipSeries.length * 17} rx="8" fill="var(--rail)" opacity="0.96" />
            <text x={tooltipX + 10} y={19} fontSize="11" fontWeight="600" fill="#ffffff">
              {labels[hoveredIndex]}
            </text>
            {tooltipSeries.map((item, index) => {
              const value = item.values[hoveredIndex];
              if (value === null) return null;
              return (
                <g key={item.label}>
                  <circle cx={tooltipX + 14} cy={33 + index * 17} r="3.5" fill={item.color} />
                  <text x={tooltipX + 24} y={37 + index * 17} fontSize="11" fill="#e8ebf8">
                    {item.label}: {formatValue(value)}
                  </text>
                </g>
              );
            })}
          </g>
        ) : null}
      </svg>
      <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-2">
        {series.map((item) => (
          <span key={item.label} className="inline-flex items-center gap-2 text-xs text-[var(--muted-strong)]">
            <span
              className={`h-0.5 w-6 rounded-full ${item.dashed ? "border-t-2 border-dashed bg-transparent" : ""}`}
              style={item.dashed ? { borderColor: item.color } : { backgroundColor: item.color, height: 3 }}
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
      <div className="grid size-[62%] place-items-center rounded-full bg-[var(--surface)] text-center text-sm font-semibold text-[var(--ink)]">
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
