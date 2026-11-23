import React from "react";
import { formatCurrency } from "../../utils/format.js";

// A single-series horizontal bar chart for a report, drawn from the same
// rows as the table beneath it (so it inherits the server's masking and
// every chart has a table). One series, so no legend: the title names it.
// Bars use the church's --brand-color; thin bars, rounded data end, quiet
// grid, labels in text color rather than the series color. Each bar has a
// <title> tooltip and the figure carries a text summary for screen readers.
const ROW_H = 26;
const LABEL_W = 150;
const VALUE_W = 74;
const BAR_H = 12;

function fmt(value, type) {
  return type === "currency" ? formatCurrency(value) : String(value);
}

export default function ReportBarChart({ chart, rows }) {
  if (!chart) return null;
  const data = rows
    .map((r) => ({ label: String(r[chart.label] ?? ""), value: Number(r[chart.value]) }))
    .filter((d) => Number.isFinite(d.value) && d.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, chart.limit || 10);
  if (data.length < 2) return null;

  const max = Math.max(...data.map((d) => d.value));
  const width = 520;
  const plotW = width - LABEL_W - VALUE_W;
  const height = data.length * ROW_H + 4;
  const summary = data.map((d) => `${d.label}: ${fmt(d.value, chart.type)}`).join("; ");

  return (
    <figure className="report-chart" aria-label={chart.title}>
      <figcaption>{chart.title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary} width="100%">
        <line x1={LABEL_W} x2={LABEL_W} y1="0" y2={height} stroke="#ccc" strokeWidth="1" />
        {data.map((d, i) => {
          const y = i * ROW_H + 2;
          const w = Math.max((d.value / max) * plotW, 3);
          return (
            <g key={d.label + i} className="report-chart-row">
              <title>{`${d.label}: ${fmt(d.value, chart.type)}`}</title>
              <rect x="0" y={y} width={width} height={ROW_H} fill="transparent" />
              <text x={LABEL_W - 8} y={y + ROW_H / 2 + 4} textAnchor="end" fontSize="12" fill="currentColor">
                {d.label.length > 22 ? `${d.label.slice(0, 21)}…` : d.label}
              </text>
              <rect
                className="report-chart-bar"
                x={LABEL_W}
                y={y + (ROW_H - BAR_H) / 2}
                width={w}
                height={BAR_H}
                rx="4"
                fill="var(--brand-color, #2a5d3c)"
              />
              <text x={LABEL_W + w + 6} y={y + ROW_H / 2 + 4} fontSize="12" fill="currentColor">
                {fmt(d.value, chart.type)}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
