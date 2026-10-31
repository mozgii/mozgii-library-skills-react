---
title: React chart recipes with visx and ECharts
author: MOZGII, Inc.
lang: en
---

# React chart recipes with visx and ECharts

Recipes beyond standard Recharts charts: a custom bar chart with visx, Apache ECharts with tree-shaking and a small React wrapper, downsampling large series, a dependency-free sparkline, and a colour-blind-safe palette. Sources: the visx 4 package types, the Apache ECharts 6 handbook (import, aria, renderers), and Sveinn Steinarsson's thesis on the Largest-Triangle-Three-Buckets algorithm.

## A custom horizontal bar chart with visx

visx gives D3 scales and SVG shapes as React components; you write the layout. A sorted, labelled horizontal bar chart that fills its parent:

```tsx
import { useParentSize } from '@visx/responsive'
import { scaleBand, scaleLinear } from '@visx/scale'
import { Bar } from '@visx/shape'
import { Group } from '@visx/group'
import { AxisLeft } from '@visx/axis'

type Row = { label: string; value: number }
const fmt = new Intl.NumberFormat(undefined, { notation: 'compact' })

export function BarList({ data, title }: { data: Row[]; title: string }) {
  const { parentRef, width } = useParentSize({ debounceTime: 50 })
  const rows = [...data].sort((a, b) => b.value - a.value)
  const margin = { top: 8, right: 48, bottom: 8, left: 120 }
  const height = rows.length * 32 + margin.top + margin.bottom
  const innerW = Math.max(0, width - margin.left - margin.right)
  const y = scaleBand({ domain: rows.map((r) => r.label), range: [0, rows.length * 32], padding: 0.25 })
  const x = scaleLinear({ domain: [0, Math.max(...rows.map((r) => r.value), 1)], range: [0, innerW], nice: true })
  return (
    <div ref={parentRef} style={{ width: '100%' }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${title}: ${rows.map((r) => `${r.label} ${fmt.format(r.value)}`).join(', ')}`}>
          <Group left={margin.left} top={margin.top}>
            <AxisLeft scale={y} hideTicks hideAxisLine tickLabelProps={{ fill: 'var(--text)', fontSize: 12, textAnchor: 'end', dy: '0.33em' }} />
            {rows.map((r) => (
              <g key={r.label}>
                <Bar x={0} y={y(r.label)} width={x(r.value)} height={y.bandwidth()} fill="var(--chart-1)" rx={3} />
                <text x={x(r.value) + 6} y={(y(r.label) ?? 0) + y.bandwidth() / 2} dy="0.33em" fontSize={12} fill="var(--text)">{fmt.format(r.value)}</text>
              </g>
            ))}
          </Group>
        </svg>
      )}
    </div>
  )
}
```

Direct value labels make the axis unnecessary and the chart readable without hovering. For long lists, the `aria-label` gets long: prefer a visually hidden table then.

## Apache ECharts 6 with tree-shaking

Import only the chart types, components and renderer you use from `echarts/core`, register them once, and the bundle stays a fraction of the full build:

```ts
// echarts-setup.ts
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { AriaComponent, DataZoomComponent, GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, AriaComponent, CanvasRenderer])
export { echarts }
```

A small wrapper that creates the chart once, updates options, resizes with the container and disposes on unmount:

```tsx
import { useEffect, useRef } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import { echarts } from './echarts-setup'

export function EChart({ option, label, height = 360 }: { option: EChartsCoreOption; label: string; height?: number }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null)
  useEffect(() => {
    if (!el.current) return
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' })
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current)
    return () => { ro.disconnect(); c.dispose(); chart.current = null }
  }, [])
  useEffect(() => { chart.current?.setOption(option, { notMerge: true }) }, [option])
  return <div ref={el} role="img" aria-label={label} style={{ width: '100%', height }} />
}
```

`echarts-for-react` 3.0.6 (with `echarts-for-react/lib/core` for the tree-shaken build) does the same if you prefer a package.

## ECharts accessibility and large data options

ECharts can describe a chart and add patterns so series do not depend on colour:

```ts
const option = {
  aria: { enabled: true, decal: { show: true } },                // generated description, decal patterns on series
  tooltip: { trigger: 'axis', valueFormatter: (v: number) => money.format(v) },
  dataZoom: [{ type: 'inside' }, { type: 'slider' }],            // zoom and pan for long series
  xAxis: { type: 'time' },
  yAxis: { type: 'value', axisLabel: { formatter: (v: number) => compact.format(v) } },
  series: [{ type: 'line', data: points, showSymbol: false, sampling: 'lttb' }],
}
```

`sampling: 'lttb'` downsamples line series to the pixel width while keeping the shape. `large: true` enables optimized rendering for big scatter and bar series; line series have no such option. Pass `[timestamp, value]` pairs rather than objects for big arrays.

## Downsampling a series with Largest-Triangle-Three-Buckets

For SVG libraries, downsample before rendering: no screen shows more points than it has pixels. The Largest-Triangle-Three-Buckets (LTTB) algorithm keeps the visual shape, including peaks:

```ts
export function lttb<T>(data: T[], threshold: number, x: (d: T) => number, y: (d: T) => number): T[] {
  if (threshold >= data.length || threshold < 3) return data
  const out: T[] = [data[0]!]
  const every = (data.length - 2) / (threshold - 2)
  let a = 0
  for (let i = 0; i < threshold - 2; i++) {
    const start = Math.floor((i + 1) * every) + 1
    const end = Math.min(Math.floor((i + 2) * every) + 1, data.length)
    let avgX = 0, avgY = 0
    for (let j = start; j < end; j++) { avgX += x(data[j]!); avgY += y(data[j]!) }
    avgX /= end - start; avgY /= end - start
    const rangeStart = Math.floor(i * every) + 1, rangeEnd = Math.floor((i + 1) * every) + 1
    let maxArea = -1, next = rangeStart
    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs((x(data[a]!) - avgX) * (y(data[j]!) - y(data[a]!)) - (x(data[a]!) - x(data[j]!)) * (avgY - y(data[a]!)))
      if (area > maxArea) { maxArea = area; next = j }
    }
    out.push(data[next]!); a = next
  }
  out.push(data.at(-1)!)
  return out
}
// const shown = useMemo(() => lttb(points, Math.max(100, Math.round(width)), (p) => p.t, (p) => p.v), [points, width])
```

Run it in a Web Worker for millions of points.

## A dependency-free sparkline

A sparkline in a table cell needs no library: map values to a polyline in a fixed viewBox and let CSS size it:

```tsx
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <span role="img" aria-label={`${label}: not enough data`}>–</span>
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / span) * 28 - 1}`).join(' ')
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" width="80" height="24" role="img"
      aria-label={`${label}: from ${values[0]} to ${values.at(-1)}, range ${min} to ${max}`}>
      <polyline points={points} fill="none" stroke="var(--chart-1)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
```

## A colour-blind-safe categorical palette

The Okabe-Ito palette was designed to stay distinguishable for the common colour-vision deficiencies. As tokens, with dark-mode variants lifted for contrast on dark backgrounds:

```css
:root {
  --chart-1: #0072b2; --chart-2: #e69f00; --chart-3: #009e73; --chart-4: #cc79a7;
  --chart-5: #56b4e9; --chart-6: #d55e00; --chart-7: #f0e442; --chart-grid: #e5e7eb; --chart-axis: #6b7280;
}
[data-theme='dark'] {
  --chart-1: #56b4e9; --chart-2: #f0b84a; --chart-3: #3cc49a; --chart-4: #e0a0c8;
  --chart-5: #8fd0f5; --chart-6: #f08040; --chart-7: #f5ea70; --chart-grid: #374151; --chart-axis: #9ca3af;
}
```

Use at most five or six categorical colours in one chart; beyond that, group the rest into "Other" or use small multiples.

Contrast of the light set on white, against the 3:1 that lines and bars need:

| Token | Contrast on white | Use on white |
|---|---|---|
| `--chart-1` | 5.19 | lines, bars and text |
| `--chart-6` | 3.87 | lines and bars |
| `--chart-3` | 3.42 | lines and bars |
| `--chart-4` | 3.06 | lines and bars |
| `--chart-5` | 2.31 | fills with a darker outline, never thin lines |
| `--chart-2` | 2.25 | fills with a darker outline, never thin lines |
| `--chart-7` | 1.32 | fills with a darker outline, never thin lines |

Only `--chart-1` is safe for text on white. Every dark-mode value clears 6:1 on `#111827`.
