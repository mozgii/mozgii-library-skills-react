---
name: react-charts-and-dataviz
description: Builds charts and data visualizations in React that are correct, responsive and accessible - choosing Recharts 3, visx 4 or Apache ECharts 6 by data size and how custom the chart is, picking the right chart type, responsive sizing without layout jumps, number and date formatting with Intl, colour palettes that work for colour-blind users and in dark mode, keyboard and screen reader access with a data table alternative, loading, empty and error states, and large datasets with canvas rendering and downsampling. Use when adding a dashboard chart, a line, bar, area or pie chart, a sparkline, a custom visualization, when a chart is slow with many points, overflows its container, is unreadable in dark mode, or fails an accessibility review.
metadata:
  tags:
  - react
  - charts
  - data-visualization
  - recharts
  - visx
  - echarts
  - accessibility
  - dashboards
---

# React charts and data visualization

A chart is a claim about data: the type, the axes and the colours decide whether readers see the truth. In React, a chart library turns data into SVG or canvas; you still decide the chart type, format the numbers, size it to its container, make it readable without colour and without sight, and design what happens while data loads, when there is none, and when it fails.

## Step 0: read the installed charting libraries

Chart APIs changed across majors, so read the installed versions first:

```bash
node -p "['react','recharts','@visx/visx','@visx/xychart','echarts','echarts-for-react','d3-scale','d3-shape'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `recharts` 3.10.1, `@visx/visx` 4.0.0, `echarts` 6.1.0, `echarts-for-react` 3.0.6. Recharts 3.3 added the `responsive` prop (no `ResponsiveContainer` wrapper needed), and `accessibilityLayer` is on by default in Recharts 3. visx 4 requires React 18 or 19.

## Decision table: which chart library

| Need | Pick | Why the others lose |
|---|---|---|
| Standard dashboard charts (line, bar, area, pie, composed), quick to build | Recharts 3 | declarative components, sensible defaults, keyboard layer built in; visx needs more code for the same chart |
| Custom or unusual visualizations in your design system's look | visx 4 (D3 scales and shapes as React components) | full control of the SVG; Recharts fights custom layouts |
| Tens of thousands to millions of points, maps, heatmaps, rich zoom and brush | Apache ECharts 6 (canvas or SVG renderer) | SVG libraries slow down past a few thousand elements |
| A sparkline or a single bar in a table cell | a tiny hand-written SVG | a chart library per cell is heavy |
| Exploratory, notebook-style charts | Observable Plot | concise grammar, less suited to interactive app UI |

## Decision table: which chart type

| Question the chart answers | Type | Avoid |
|---|---|---|
| How does a value change over time? | line (area for one cumulative series) | bars for long time series |
| How do categories compare? | horizontal bar, sorted | pie with more than 4 slices |
| What share of a whole? (2 to 4 parts) | stacked bar or a single 100 percent bar; pie or donut only for very few parts | 3D charts of any kind |
| How are values distributed? | histogram or box plot | a line through categories |
| Do two measures relate? | scatter plot | dual y-axes, which suggest false correlations |
| One number and its trend | a big number with a sparkline | a gauge |

Start bar charts at zero; a truncated bar axis exaggerates differences. Line charts may start elsewhere when the change is the point.

## Responsive sizing without layout jumps

Charts need real pixel sizes, but layouts are fluid. Give the container a stable size from CSS (a height or an `aspect-ratio`) and let the chart fill it:

- Recharts 3.3 and newer: `<LineChart responsive width="100%" height={320} data={data}>`, or wrap in `ResponsiveContainer` on older 3.x.
- visx: `useParentSize()` or `<ParentSize>` from `@visx/responsive` measures the parent with a ResizeObserver.
- ECharts: call `chart.resize()` from a ResizeObserver on the container (the React wrapper does it when `autoResize` is on).
- Reserve the height while loading (a skeleton with the same size), so the page does not jump when the chart appears.
- On narrow screens, reduce ticks, rotate nothing, and move the legend below; consider a table or a single number instead.

## Format numbers and dates with Intl

Axis ticks and tooltips must read like the rest of the app, in the user's locale. Create the formatters once:

```ts
const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })      // 12.4K, 3.1M
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
const month = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' })
```

Send dates as ISO strings or epoch milliseconds and convert at the edge; never format on the server in another time zone.

## Colour that works for everyone and in dark mode

Colour in a chart encodes meaning, so it must survive colour blindness, dark mode and printing:

- Use a categorical palette designed for colour-vision deficiencies (for example Okabe-Ito or a palette tested with a simulator); never red against green alone.
- Never rely on colour alone: label lines directly at their end, use different dash patterns or markers, and keep the legend order the same as the visual order.
- Define chart colours as CSS variables with light and dark values and read them in the chart (`stroke="var(--chart-1)"` works in SVG libraries); for canvas charts, read them with `getComputedStyle` and re-render on theme change.
- Text in a chart (ticks, labels, legends, tooltips) needs 4.5:1 contrast against its background (WCAG 1.4.3), or 3:1 only at large size. Lines, bars and other marks people must see need 3:1 (WCAG 1.4.11 for graphical objects). So label series in the text colour, never in a pale series colour.

## Accessible charts: names, keyboard and a data table

A chart that only shows pixels is invisible to screen reader users and hard for keyboard users. Provide, in order of importance:

1. A text summary next to the chart that states the main finding ("Revenue grew 18 percent from January to June, peaking in May").
2. The data as a table, visually hidden or behind a "Show data" disclosure.
3. A name for the graphic: wrap it in `<figure>` with `<figcaption>`, or give the SVG `role="img"` with `aria-label`.
4. Keyboard access to data points where the chart is interactive: Recharts' `accessibilityLayer` lets arrow keys move the tooltip between points; ECharts' `aria` option generates a description and can add decal patterns.

Respect reduced motion: turn off entry animations (`isAnimationActive={false}` in Recharts) when `prefers-reduced-motion: reduce` matches.

## Worked example: an accessible, responsive revenue chart with every state

A monthly revenue line chart with loading, error and empty states, locale formatting, theme colours, a text summary and a data table:

```tsx
import { useId } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'

type Point = { month: string; revenue: number }       // month as ISO date, e.g. 2026-05-01
const money = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const compactMoney = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 })
const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
const fmtMonth = (iso: string) => monthLabel.format(new Date(iso))
const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

function summarize(points: Point[]): string {
  const first = points[0]!, last = points.at(-1)!
  const peak = points.reduce((a, b) => (b.revenue > a.revenue ? b : a))
  const change = first.revenue === 0 ? null : (last.revenue - first.revenue) / first.revenue
  const trend = change === null ? '' : ` ${change >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(change * 100))} percent,`
  return `Revenue went from ${money.format(first.revenue)} in ${fmtMonth(first.month)} to ${money.format(last.revenue)} in ${fmtMonth(last.month)},${trend} with a peak of ${money.format(peak.revenue)} in ${fmtMonth(peak.month)}.`
}

export function RevenueChart() {
  const titleId = useId()
  const q = useQuery({
    queryKey: ['revenue', 'monthly'],
    queryFn: async ({ signal }): Promise<Point[]> => {
      const r = await fetch('/api/revenue/monthly', { signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json()
    },
  })

  return (
    <figure aria-labelledby={titleId} className="chart-card">
      <figcaption id={titleId}><strong>Monthly revenue</strong></figcaption>
      {q.isPending ? (
        <div role="status" aria-label="Loading revenue chart" className="skeleton" style={{ height: 320 }} />
      ) : q.isError ? (
        <div role="alert" style={{ height: 320 }}>Revenue could not be loaded. <button type="button" onClick={() => q.refetch()}>Retry</button></div>
      ) : q.data.length === 0 ? (
        <p style={{ height: 320 }}>No revenue recorded yet for this period.</p>
      ) : (
        <>
          <p>{summarize(q.data)}</p>
          <LineChart responsive width="100%" height={320} data={q.data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="month" tickFormatter={fmtMonth} stroke="var(--chart-axis)" minTickGap={24} />
            <YAxis tickFormatter={(v: number) => compactMoney.format(v)} stroke="var(--chart-axis)" width={64} />
            <Tooltip formatter={(v) => money.format(Number(v))} labelFormatter={(l) => fmtMonth(String(l))}
              contentStyle={{ background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' }} />
            <Line type="monotone" dataKey="revenue" name="Revenue" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3 }}
              isAnimationActive={!reducedMotion} />
          </LineChart>
          <details>
            <summary>Show data</summary>
            <table>
              <caption className="sr-only">Monthly revenue</caption>
              <thead><tr><th scope="col">Month</th><th scope="col">Revenue</th></tr></thead>
              <tbody>{q.data.map((p) => <tr key={p.month}><td>{fmtMonth(p.month)}</td><td>{money.format(p.revenue)}</td></tr>)}</tbody>
            </table>
          </details>
        </>
      )}
    </figure>
  )
}
```

Every state keeps the same height, the summary states the finding in words, the table gives exact values, and the keyboard layer (on by default) lets arrow keys move through points. Recipes for visx, ECharts and large datasets: [chart-recipes.md](references/chart-recipes.md).

## Verify charts

- Resize from 320 px to a wide screen: no overflow, no overlapping ticks, the legend stays readable.
- Toggle dark mode: axis and tooltip text keep 4.5:1 contrast, series and axis lines keep 3:1; gridlines are decoration.
- Check with a colour-blindness simulator (DevTools Rendering panel, "Emulate vision deficiencies"): series stay distinguishable.
- Keyboard: Tab to the chart, arrow keys move between points; a screen reader reads the summary and the table.
- Load 50,000 points into a large-data chart: interaction stays under 100 ms in a Performance recording.
- Unit-test the formatting and summary functions; snapshot charts only through the data table, not SVG paths.

## Gotchas and anti-patterns in charts

Each gotcha names the symptom, its cause and the fix.

1. **The chart renders at zero height.** Cause: a responsive chart in a container with no height. Fix: set a height or an `aspect-ratio` on the container.
2. **The chart overflows a flex or grid cell.** Cause: the cell's `min-width: auto` lets content push it wider. Fix: `min-width: 0` on the flex or grid child.
3. **Axis labels show "1000000" or US formats for German users.** Cause: no formatter. Fix: `Intl.NumberFormat` and `Intl.DateTimeFormat` for ticks and tooltips.
4. **Months shift by one for users west of UTC.** Cause: parsing `2026-05-01` as UTC midnight and formatting in local time. Fix: format with `timeZone: 'UTC'` for date-only values.
5. **The page freezes with a large series.** Cause: tens of thousands of SVG nodes. Fix: downsample (largest triangle three buckets) or switch to ECharts' canvas renderer.
6. **Series are indistinguishable for some users.** Cause: colour alone, red against green. Fix: a colour-blind-safe palette plus direct labels, markers or dashes.
7. **The chart is silent for screen readers.** Cause: an unlabelled SVG. Fix: a figure caption, a text summary and a data table.
8. **Memory grows on a dashboard with ECharts.** Cause: instances not disposed on unmount. Fix: `chart.dispose()` in the effect cleanup (wrappers do this).

## Pre-merge checklist for charts

1. The chart type answers the question; bar axes start at zero; no 3D, no dual axes.
2. The container has a stable size; loading, empty and error states keep it.
3. Numbers and dates use `Intl` formatters in the user's locale.
4. Colours come from themed variables, are not the only encoding, and pass contrast: 4.5:1 for text, 3:1 for marks.
5. A text summary and a data table exist; the chart has a name; keyboard access works where interactive.
6. Animations respect reduced motion.
7. Large data is downsampled or rendered on canvas; chart instances are disposed.

See also: react-data-fetching, react-accessibility, react-styling, react-performance, react-i18n.
