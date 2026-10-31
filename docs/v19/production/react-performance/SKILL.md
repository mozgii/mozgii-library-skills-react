---
name: react-performance
description: Makes React apps fast with measurement first - React DevTools Profiler and React's Performance tracks, the React Compiler 1.0 instead of manual useMemo, useCallback and memo, transitions and useDeferredValue for responsive input, Activity for hidden panels, code splitting with lazy, virtualized lists with TanStack Virtual, high-frequency updates through an external store, and bundle and Web Vitals checks. Use when a React screen feels slow, typing lags, a list stutters, the bundle is large, INP or LCP is poor, when adding or debugging the React Compiler, when scroll or resize handlers stutter, or before adding memoization by hand.
metadata:
  tags:
  - react
  - performance
  - react-compiler
  - memoization
  - virtualization
  - transitions
  - profiling
  - web-vitals
---

# React performance

Slow React apps are usually slow for a few reasons: too much rendering work per update, too much JavaScript to load, waterfalls of requests, or long lists rendered in full. Measure first, then fix the cause the measurement shows. This skill covers React 19.3, the React Compiler 1.0, TanStack Virtual 3.14 and Vite 8.

## Step 0: read the installed React, compiler and build versions

Whether the React Compiler runs and which build tools are present decide the fixes that apply. Read them from the project root:

```bash
node -p "['react','react-dom','babel-plugin-react-compiler','@vitejs/plugin-react','vite','@tanstack/react-virtual','web-vitals'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `react` 19.3.1, `babel-plugin-react-compiler` 1.0.0, `@vitejs/plugin-react` 6.1.2, `vite` 8.3.5, `@tanstack/react-virtual` 3.14.24, `web-vitals` 6.2.3. A `missing` compiler line means the manual memoization section applies.

## Measure before changing code

Performance work starts with a recording, not a guess. Use a production build, because development builds are several times slower and run Strict Mode double renders:

```bash
npm run build && npm run preview          # profile this, not the dev server
```

| Tool | Answers |
|---|---|
| React DevTools Profiler | which components rendered, why, and how long each took |
| Chrome DevTools Performance panel with React's tracks (React 19.2+) | Scheduler track (priorities, blocking vs transition work) and Components track (render and effect durations) on the same timeline as the browser |
| Lighthouse or `web-vitals` in production | LCP (load), INP (input response), CLS (layout shift) for real users |
| A bundle visualizer | which modules make the bundle big |

Turn on "Highlight updates when components render" in React DevTools to see what re-renders while you interact. A profiling build for production debugging: alias `react-dom/client` to `react-dom/profiling`.

## Choose the fix for the measured symptom

Choosing a performance fix starts from what the recording showed, not from a favourite technique. Each symptom has one first fix:

| Measured symptom | First fix | Why the usual alternatives lose |
|---|---|---|
| Slow first screen, large JavaScript download (poor LCP) | split routes and heavy widgets with `lazy`, preload what the first screen needs | memoization does nothing for bytes on the wire |
| Spinners that appear one after another | start requests in parallel in loaders or on hover | faster components cannot fix requests that wait for each other |
| Typing or clicking lags behind a heavy re-render (poor INP) | `useDeferredValue` or `startTransition` | a debounce delays every update, cheap ones included |
| Many components re-render on each change | the React Compiler, state moved down, store selectors | hand-written `memo` everywhere costs review and still misses unstable props |
| A long list stutters while scrolling | virtualization (`react-virtual-lists`) | memoized rows still mount thousands of DOM nodes |
| Many updates per second (progress, prices) | an external store read once per frame (`react-realtime`) | state per message renders every subscriber every time |
| Switching tabs is slow and loses scroll | `<Activity>` for a few heavy panels | remounting rebuilds DOM and state from nothing |
| One computation is slow on its own | a better algorithm, then a Web Worker | moving a slow loop into `useMemo` still blocks the first render |

## Fix the cause, in this order

The biggest wins come from the top of this list; memoization is near the bottom:

1. **Waterfalls**: requests that wait for each other or for components to mount. Start them in parallel and early (route loaders, `Promise.all`, prefetch on hover). See `react-data-fetching`.
2. **Bundle size**: code the first screen does not need. Split routes and heavy widgets with `lazy` (below).
3. **Long lists**: render only visible rows (below).
4. **Expensive renders on every keystroke**: mark the heavy update as a transition (below).
5. **Unnecessary re-renders**: the React Compiler, state placed lower, selectors on stores, split contexts.
6. **Raw JavaScript cost**: `Map` and `Set` lookups instead of repeated `find`, one pass instead of chained `filter().map()`, hoisted regexes.

## React Compiler instead of manual memoization

The React Compiler (`babel-plugin-react-compiler` 1.0) memoizes components and hooks at build time, including values computed during render and JSX, more precisely than hand-written `useMemo`, `useCallback` and `memo`. New code carries no manual memoization for performance. Setup with Vite 8:

```bash
npm i -D @rolldown/plugin-babel @babel/core babel-plugin-react-compiler
```

```ts
// vite.config.ts
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

export default defineConfig({ plugins: [react(), babel({ presets: [reactCompilerPreset()] })] })
```

- Verify: React DevTools shows a "Memo ✨" badge on compiled components.
- The compiler skips components that break the Rules of React, silently. The linter (`react/*` compiler rules in Oxlint, `eslint-plugin-react-hooks` 7 in ESLint) is how you find them.
- `@vitejs/plugin-react` also has `react({ compiler: true })`, which uses a Rust port of the compiler (`oxc-transform-react`); its README marks it experimental.
- Adoption on an existing codebase, opt-outs, library compatibility and React 17/18 targets: [react-compiler.md](references/react-compiler.md).

## Manual memoization when there is no compiler

Manual memoization with `memo`, `useMemo` and `useCallback` is for code without the React Compiler; memoize only what a profile shows is slow:

- `memo(Component)` skips a re-render when props are shallowly equal. It helps only if the props are stable, so the parent must also memoize the objects and callbacks it passes.
- `useMemo(() => compute(a, b), [a, b])` caches an expensive value; `useCallback(fn, deps)` caches a function passed to a memoized child or used as an effect dependency.
- Moving state down (into the component that uses it) or passing JSX as `children` often removes the re-render with no memoization at all.

## Transitions and useDeferredValue for responsive input

A transition marks a state update as non-urgent: React keeps the screen responsive to typing and clicks and renders the transition in the background, abandoning it if a newer one starts.

```tsx
import { useDeferredValue, useState, useTransition } from 'react'

function Search({ items }: { items: Item[] }) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)          // the list renders with a lagging value
  const stale = query !== deferredQuery
  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
      <div style={{ opacity: stale ? 0.6 : 1 }}><Results items={items} query={deferredQuery} /></div>
    </>
  )
}

function Tabs() {
  const [tab, setTab] = useState('overview')
  const [isPending, startTransition] = useTransition()
  return <TabList current={tab} pending={isPending} onSelect={(t) => startTransition(() => setTab(t))} />
}
```

- `useDeferredValue` when you receive a value (a prop or input state); `startTransition` when you own the update.
- `Results` must be cheap to skip when its props are unchanged: compiled by the React Compiler or wrapped in `memo`.
- From React 19.3, separate transitions render independently, so a slow one no longer holds back others.

## Code splitting with lazy and Suspense

`lazy` loads a component's code only when it first renders, which keeps it out of the initial bundle. Split by route first, then by heavy widgets (editors, charts, maps):

```tsx
import { lazy, Suspense } from 'react'

const ChartPanel = lazy(() => import('./ChartPanel'))       // the module's default export

<Suspense fallback={<ChartSkeleton />}>
  <ChartPanel data={data} />
</Suspense>
```

- Routers do this per route (`lazy` route property in React Router, `autoCodeSplitting` in TanStack Router).
- Preload on intent: call the import on hover or focus (`onPointerEnter={() => import('./ChartPanel')}`) so the code is cached by click time.
- Declare `lazy` at module scope, never inside a component, or the component remounts on every render.

## Activity for hidden panels

`<Activity>` (stable since React 19.2) hides a subtree while keeping its state and DOM. Hidden content renders at low priority and its effects are cleaned up until it is visible again, so switching back is instant and scroll and inputs are where the user left them:

```tsx
import { Activity } from 'react'

<Activity mode={panel === 'inspector' ? 'visible' : 'hidden'}><Inspector /></Activity>
<Activity mode={panel === 'history' ? 'visible' : 'hidden'}><History /></Activity>
```

Use it for a few heavy panels or tabs, and to pre-render a screen the user is likely to open next. Hidden trees still hold memory, so do not wrap every route. React 19.3 tightened hiding: portal contents hide with the tree, an error in a hidden tree no longer reaches the visible UI, a hidden `<title>` stops being hoisted, and `useSyncExternalStore` picks up changes made while hidden. On 19.2, test those four cases.

## Virtualize long lists

Virtualization renders only the rows in view plus a small overscan, so a list of 50,000 rows costs the same as one of 50. TanStack Virtual is headless and works with any markup. Keep the virtualized list in a small leaf component, because the React Compiler skips components that call `useVirtualizer`:

```tsx
import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

export function RowList({ rows, onOpen }: { rows: readonly { id: string; name: string }[]; onOpen: (id: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 32, overscan: 10, getItemKey: (i) => rows[i]!.id })
  return (
    <div ref={scrollRef} style={{ height: '100%', overflow: 'auto' }} role="list" aria-label="Files">
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((item) => (
          <div key={item.key} role="listitem"
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: item.size, transform: `translateY(${item.start}px)` }}>
            <button type="button" onClick={() => onOpen(rows[item.index]!.id)} style={{ width: '100%', height: '100%', textAlign: 'left' }}>
              {rows[item.index]!.name}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

`role="list"` is deliberate in this example: a `ul` cannot hold the sizing `div` between it and its rows, and Safari with VoiceOver can drop the list semantics of a `ul` whose markers are gone. Oxlint's `jsx-a11y/prefer-tag-over-role` flags the role anyway, so set that one rule to `"off"` in `.oxlintrc.json`.

Sortable, filterable tables with TanStack Table: `react-data-tables`. Paging from the server, variable row heights, grids, CSS `content-visibility` as a lighter option, and lists fed by a stream: [lists-and-streams.md](references/lists-and-streams.md).

## High-frequency updates

Updates that arrive many times per second (progress, cursors, prices, sensor data) re-render every subscriber per message when written to React state or a query cache. Keep them in an external store, publish at most one snapshot per animation frame, and read it with `useSyncExternalStore` in small components. Code: [lists-and-streams.md](references/lists-and-streams.md).

## Scroll, resize and layout work outside React

Scroll, pointer and layout work runs on the main thread beside React, so the Profiler shows nothing while the page still stutters. Look for it in the Performance panel as long tasks and purple layout blocks, then fix it at the listener:

- Share one listener between components. A hook that calls `addEventListener` per instance adds a listener per row; a module-level store with `useSyncExternalStore` keeps one.
- Register `wheel` and `touch*` listeners with `{ passive: true }` unless the handler calls `preventDefault`, so the browser can scroll without waiting for JavaScript. React's own `onWheel` and `onTouchStart` are passive at the root, so when you need `preventDefault`, add a native listener with `{ passive: false }` in an effect.
- Throttle to one read per frame with `requestAnimationFrame`, as below. From React 19.3 `resize` updates are already batched to the next frame.
- Read layout before you write it. `getBoundingClientRect` or `offsetHeight` after a style change forces a synchronous layout; in a loop that is layout thrashing. Prefer `ResizeObserver` and `IntersectionObserver`, which report without forcing layout.
- Keep values that never reach the screen in `useRef`, not state: the last pointer position, a timer id, a scroll offset used only by a handler.
- Push non-urgent work such as analytics or cache writes to `requestIdleCallback`, with a `setTimeout` fallback where the browser lacks it.

```tsx
import { useSyncExternalStore } from 'react'

let scrolled = false
let frame = 0
const listeners = new Set<() => void>()

function onScroll() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const next = window.scrollY > 80
    if (next !== scrolled) { scrolled = next; listeners.forEach((notify) => notify()) }
  })
}

function subscribe(notify: () => void) {
  if (listeners.size === 0) window.addEventListener('scroll', onScroll, { passive: true })
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
    if (listeners.size === 0) window.removeEventListener('scroll', onScroll)
  }
}

// One listener however many components call this; they re-render only when the answer flips
export const usePageScrolled = () => useSyncExternalStore(subscribe, () => scrolled, () => false)
```

## Bundle size and loading

The initial bundle decides how fast the first screen is interactive. Habits that keep it small:

- Import from the module that defines a thing, not from a barrel `index.ts` that re-exports a folder.
- Check heavy dependencies before adding them (date libraries, icon sets, chart libraries); prefer ones with per-function imports.
- Load analytics, chat widgets and other third-party scripts after the app is interactive.
- Preload what the first screen needs (`preload` and `preconnect` from `react-dom`, `<link rel="preload">`).
- Run a bundle visualizer after `vite build` (for example `rollup-plugin-visualizer`, after checking it supports your Vite major) and look for duplicates and unexpected large modules.

## Worked example: a responsive search over 20,000 rows

A worked example of three fixes together: the input stays urgent, the filter runs on a deferred value, and the result list is virtualized, so typing stays smooth on a slow laptop. The empty and stale states are visible, and the count is announced:

```tsx
// src/features/files/FileSearch.tsx
import { useDeferredValue, useState } from 'react'
import { RowList } from './RowList'

type FileRow = { id: string; name: string }

export function FileSearch({ files, onOpen }: { files: readonly FileRow[] | undefined; onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  if (files === undefined) return <p role="status">Loading files…</p>
  const needle = deferred.trim().toLowerCase()
  const matches = needle === '' ? files : files.filter((f) => f.name.toLowerCase().includes(needle))
  const stale = query !== deferred
  return (
    <section aria-label="File search" style={{ display: 'grid', gridTemplateRows: 'auto auto 1fr', height: '100%' }}>
      <input type="search" aria-label="Search files" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
      <p role="status">{stale ? 'Filtering…' : `${matches.length.toLocaleString()} files`}</p>
      <div style={{ minHeight: 0, opacity: stale ? 0.6 : 1 }}>
        {matches.length === 0 ? <p>No files match “{deferred}”.</p> : <RowList rows={matches} onOpen={onOpen} />}
      </div>
    </section>
  )
}
```

- The React Compiler memoizes `matches` by `files` and `needle`, so typing re-runs the filter only after the deferred value catches up.
- `RowList` is the virtualized leaf component above; it renders about 30 rows whatever the match count.
- The status line is a live region that exists from the first render, so its text changes are announced.

## Verify React performance

A performance change is proven by the same recording before and after, on a production build, plus field data from real users. Run:

```bash
npm run build
npx vite preview --port 4173 --strictPort & PREVIEW=$!
sleep 2
npx lighthouse http://localhost:4173/ --only-categories=performance --quiet --chrome-flags=--headless --output=json --output-path=./lh.json
node -e "const r=require('./lh.json');for(const k of ['largest-contentful-paint','total-blocking-time','cumulative-layout-shift'])console.log(k, r.audits[k].displayValue)"
kill "$PREVIEW"
```

- React DevTools Profiler: record the slow interaction before and after; the commit duration of the target component drops, and "why did this render" no longer lists the removed cause.
- Chrome Performance panel with CPU throttling at 4x: no long task over 50 ms during typing in the worked example.
- In production, report Web Vitals with `web-vitals` 6 (`onINP`, `onLCP`, `onCLS`) to your analytics; lab numbers do not replace field data.
- A bundle budget in CI (`size-limit`, or a visualizer report reviewed per release) catches a dependency that doubles the first-load JavaScript.

## Pre-merge checklist for React performance

Check each point before merging a performance change.

1. A profile of a production build shows the problem before any change.
2. No request waterfalls on the slow screen; loaders or prefetch start requests early.
3. Routes and heavy widgets split with `lazy`; the first screen loads only what it shows.
4. The React Compiler on and its lint rules clean; no new manual `useMemo`, `useCallback` or `memo` for speed.
5. Expensive updates during typing run as transitions or deferred values.
6. Lists above a few hundred rows virtualized; very large ones paged from the server.
7. High-frequency data in an external store with one render per frame.
8. INP, LCP and CLS measured for real users after the change.

## Gotchas and anti-patterns in React performance

Each entry gives the symptom you see, its cause and the fix.

1. **The compiler is on but nothing is memoized.** Cause: the old `react({ babel: { plugins } })` setup, which `@vitejs/plugin-react` 6 removed. Fix: `@rolldown/plugin-babel` with `reactCompilerPreset()`.
2. **One component never shows the Memo badge.** Cause: it breaks a Rule of React or calls an incompatible library hook (`useVirtualizer`, `useReactTable`, React Hook Form's `watch`). Fix: read the lint warning; move the incompatible hook into a small leaf component.
3. **Profiling the dev server shows double renders.** Cause: Strict Mode and development checks. Fix: profile `vite preview` or a profiling build.
4. **`memo` does nothing.** Cause: a new object or function prop every render. Fix: the compiler, or memoize the props in the parent.
5. **Typing lags while a list filters.** Cause: the filter render is urgent. Fix: `useDeferredValue` for the query, and a memoized or compiled list.
6. **A lazy component remounts on every render.** Cause: `lazy()` called inside a component. Fix: module scope.
7. **The virtualized list shows blank space while scrolling fast.** Cause: overscan too small or row height estimate far off. Fix: raise `overscan`, fix `estimateSize`, or measure rows with `measureElement`.
8. **Anti-pattern: `useMemo` and `useCallback` on everything "just in case".** Symptom: harder code, no faster renders, stale values when a dependency is missed. Cause: memoization without a measurement. Fix: the React Compiler, and a profile before any manual memo.
9. **Anti-pattern: optimizing in the dev server.** Symptom: a fix that shows a big win in development and none in production. Cause: development builds are slower in different places. Fix: measure on `vite preview` or a profiling build.

## See also

- `react-virtual-lists`: virtualization in depth (variable heights, grids, infinite loading, scroll restoration).
- `react-suspense-and-concurrency`: transitions, deferred values and Suspense boundaries in depth.
- `react-realtime`: streams and high-frequency updates without re-render storms.
