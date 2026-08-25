# ADR-0002: Apache ECharts over D3.js / Recharts

- **Status:** Accepted

## Context

The dashboard requires a variety of chart types, several of which are non-standard:

- **Gauge charts** — used for ESR score and reservation coverage widgets.
- **Confidence-band area charts** — used on the Budgets page for forecast visualisation (shaded upper/lower
  bound bands rendered as `markArea`).
- **Bubble/scatter charts** — used on the Workload page (CPU vs cost, with bubble sizing).
- **Radar/spider charts** — used on the AI Insights page for WAF scores.
- Line, area, bar, and pie/donut charts are also required.

The team also needed reliable dark-theme support and a declarative, React-friendly API.

## Decision

Use **Apache ECharts** via the `echarts-for-react` wrapper (version 5.5.x / 3.0.x).

## Consequences

- **Native gauge chart type** — satisfies the score and coverage widget requirements without custom SVG
  work.
- **Built-in dark theme support** — toggled via the `ThemeToggle` component that sets a `dark` class on
  `<html>`.
- **Declarative options API** — chart configuration is a plain JavaScript object, which fits the React
  component model cleanly.
- **`markArea` for confidence bands** — provides the shaded forecast band on the Budgets page without
  additional libraries.
- **Rejected: D3.js** — too low-level; no built-in gauge support; requires significant custom code for
  each chart type.
- **Rejected: Recharts** — no gauge chart; limited chart variety; confidence-band support requires
  workarounds.

New chart components added: `ScatterChart` (bubble sizing by cost), `RadarChart` (WAF spider),
`ThemeToggle` (light/dark class toggle on `<html>`).
