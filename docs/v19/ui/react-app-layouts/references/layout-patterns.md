---
title: React layout pattern components
author: MOZGII, Inc.
lang: en
---

# React layout pattern components

Complete components for the app layout patterns: a resizable split view, saved layout preferences, a status bar, an empty state and a skeleton.

## Contents

This page, React layout pattern components, has these sections.

1. Resizable split view component
2. Saving pane sizes in preferences
3. Collapsible sidebar
4. Status bar component
5. Empty state component
6. Skeleton component

## Resizable split view component

The split is a CSS grid with three columns: left pane, a 4 px separator, right pane. The separator captures the pointer while dragging and supports arrow keys. `onCommit` fires when a drag or key press ends, which is when to save:

```tsx
import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'

const MIN = 0.15
const MAX = 0.8
const clamp = (f: number) => Math.min(MAX, Math.max(MIN, f))

export function SplitView({ left, right, initial = 0.35, label = 'Resize panes', onCommit }: {
  left: ReactNode; right: ReactNode; initial?: number; label?: string; onCommit?: (fraction: number) => void
}) {
  const [fraction, setFraction] = useState(initial)
  const box = useRef<HTMLDivElement>(null)

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !box.current) return
    const r = box.current.getBoundingClientRect()
    setFraction(clamp((e.clientX - r.left) / r.width))
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const next = e.key === 'Home' ? MIN : e.key === 'End' ? MAX : clamp(fraction + step)
    setFraction(next)
    onCommit?.(next)
  }

  return (
    <div ref={box} style={{ display: 'grid', height: '100%', gridTemplateColumns: `${fraction}fr 4px ${1 - fraction}fr` }}>
      <section style={{ minWidth: 0, overflow: 'hidden' }}>{left}</section>
      <div
        role="separator" aria-orientation="vertical" aria-label={label}
        aria-valuemin={MIN * 100} aria-valuemax={MAX * 100} aria-valuenow={Math.round(fraction * 100)}
        tabIndex={0} className="split-handle"
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={onPointerMove}
        onPointerUp={() => onCommit?.(fraction)}
        onKeyDown={onKeyDown}
      />
      <section style={{ minWidth: 0, overflow: 'hidden' }}>{right}</section>
    </div>
  )
}
```

```css
.split-handle { position: relative; z-index: 1; cursor: col-resize; background: var(--border); touch-action: none; }
.split-handle::after { content: ''; position: absolute; inset: 0 -10px; }   /* 4 + 10 + 10: a 24 px target around the 4 px bar */
.split-handle:hover, .split-handle:focus-visible { background: var(--accent); outline: none; }
```

The `::after` area belongs to the handle, so it takes the drag across 24 px while only the 4 px bar is drawn, and `z-index` keeps that area above both panes. `touch-action: none` stops touch scrolling from stealing the drag on tablets. Both panes need `min-width: 0`, because grid children default to `min-width: auto` and long content would push the separator.

## Saving pane sizes in preferences

Layout preferences (split fractions, collapsed sidebars, column widths) should persist per layout. A small Zustand store with `persist` keeps them in `localStorage` and versions the shape:

```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type LayoutPrefs = { splits: Record<string, number>; setSplit: (key: string, f: number) => void }

export const useLayoutPrefs = create<LayoutPrefs>()(persist(
  (set) => ({ splits: {}, setSplit: (key, f) => set((s) => ({ splits: { ...s.splits, [key]: f } })) }),
  { name: 'layout-prefs', version: 1 },
))

// usage
const initial = useLayoutPrefs((s) => s.splits['invoices'] ?? 0.35)
const setSplit = useLayoutPrefs((s) => s.setSplit)
<SplitView initial={initial} onCommit={(f) => setSplit('invoices', f)} left={<List />} right={<Detail />} />
```

When users move between devices, store preferences on the server instead and treat local storage as a cache.

## Collapsible sidebar

A collapsible sidebar keeps navigation one click away without taking space. Toggle a CSS variable for the width, keep icons visible when collapsed, and give the toggle an accessible state:

```tsx
export function SidebarToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-expanded={!collapsed} aria-controls="app-nav" onClick={onToggle}>
      <span className="sr-only">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
      <SidebarIcon aria-hidden />
    </button>
  )
}
// <div className="app-shell" style={{ '--nav-width': collapsed ? '56px' : '240px' } as React.CSSProperties}>
```

Collapsed labels become tooltips; they must still be the accessible names of the links.

## Status bar component

The status bar reads small stores, so updates re-render only the slot that changed:

```tsx
export function StatusBar() {
  return (
    <div className="status-bar">
      <JobsSlot />
      <SyncSlot />
      <ConnectionSlot />
    </div>
  )
}

function JobsSlot() {
  const jobs = useProgress()                                   // external store, one snapshot per frame
  if (jobs.length === 0) return null
  const done = jobs.reduce((n, j) => n + j.done, 0)
  const total = jobs.reduce((n, j) => n + j.total, 0)
  return (
    <button type="button" onClick={openJobsPanel} aria-label={`${jobs.length} jobs running, ${Math.round((done / total) * 100)} percent`}>
      <progress value={done} max={total} /> {jobs.length} running
    </button>
  )
}
```

```css
.status-bar { display: flex; gap: 16px; align-items: center; height: 28px; padding: 0 12px; font-size: 12px; border-top: 1px solid var(--border); }
```

## Empty state component

An empty state says what the area is for and offers the action that fills it. Keep it short:

```tsx
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state" role="status">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}
// <EmptyState title="No invoices yet" description="Invoices you create or import appear here." action={<Button onClick={create}>Create invoice</Button>} />
```

Distinguish "nothing exists yet" from "no results for these filters"; the second needs a Clear filters action instead.

## Skeleton component

A skeleton mirrors the shape of the content while it loads, with a subtle shimmer that stops under reduced motion:

```tsx
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden className="skeleton">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton-line" style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  )
}
```

```css
.skeleton-line { height: 12px; margin: 8px 0; border-radius: 4px; background: linear-gradient(90deg, var(--muted) 25%, var(--muted-2) 50%, var(--muted) 75%); background-size: 200% 100%; animation: shimmer 1.2s infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .skeleton-line { animation: none; } }
```

The skeleton is `aria-hidden`; announce loading through the container's `aria-busy="true"` or a polite status message.
