---
title: Large lists and live data streams in React
author: MOZGII, Inc.
lang: en
---

# Large lists and live data streams in React

Patterns for lists with thousands of rows and for data that changes many times per second, with TanStack Virtual 3.14, TanStack Query 5 and `useSyncExternalStore`.

## Contents

This page, Large lists and live data streams in React, has these sections.

1. Choosing a strategy by list size
2. Paging a virtualized list from the server
3. Variable row heights and window scrolling
4. Virtualized grids and tables
5. CSS content-visibility as a lighter option
6. Live streams with one render per frame
7. Keyboard and screen readers in virtual lists

## Choosing a strategy by list size

Choosing a strategy for a long React list depends on the number of rows and how they arrive:

| Rows | Strategy |
|---|---|
| Under a few hundred | render them all; no virtualization |
| Hundreds to tens of thousands, already in memory | virtualize with `useVirtualizer` |
| Tens of thousands and more, on a server | page from the server (`useInfiniteQuery`) and virtualize what is loaded |
| Unbounded feed | infinite query with `maxPages` so old pages are dropped |

Holding 100,000 rows in the browser costs memory even when only 30 render. Ask the server for the visible range.

## Paging a virtualized list from the server

Paging a virtualized list from the server means loading the next page when the last virtual item comes into view. The total count comes from the pages already loaded, plus one loader row while more exist:

```tsx
export function Feed() {
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = useInfiniteQuery({
    queryKey: ['events'],
    queryFn: ({ pageParam, signal }) => http<{ items: Event[]; next: string | null }>(`/api/events?after=${pageParam ?? ''}&limit=100`, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.next,
  })
  const rows = data?.pages.flatMap((p) => p.items) ?? []
  const scrollRef = useRef<HTMLDivElement>(null)
  // oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
  const v = useVirtualizer({ count: hasNextPage ? rows.length + 1 : rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 40, overscan: 8 })

  const lastIndex = v.getVirtualItems().at(-1)?.index ?? -1
  useEffect(() => {
    if (lastIndex >= rows.length - 1 && hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [lastIndex, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div ref={scrollRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: v.getTotalSize(), position: 'relative' }}>
        {v.getVirtualItems().map((item) => (
          <div key={item.key} style={{ position: 'absolute', top: 0, left: 0, right: 0, height: item.size, transform: `translateY(${item.start}px)` }}>
            {item.index < rows.length ? <EventRow event={rows[item.index]!} /> : 'Loading more…'}
          </div>
        ))}
      </div>
    </div>
  )
}
```

For random access (jump to row 40,000), fetch a count first and load ranges by index with one query per page key (`['events', 'page', n]`).

## Variable row heights and window scrolling

Fixed heights scroll smoothest. When rows really differ in height, let the virtualizer measure them:

```tsx
<div key={item.key} data-index={item.index} ref={v.measureElement}
  style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)` }}>
  <Message message={rows[item.index]!} />
</div>
```

- Keep `estimateSize` close to the average to reduce jumps.
- To scroll with the page instead of an inner box, use `useWindowVirtualizer` and account for content above the list with `scrollMargin`.

## Virtualized grids and tables

A grid virtualizes rows and columns with two virtualizers (`horizontal: true` for columns). A table built with TanStack Table virtualizes its row model the same way as a list. Keep `<table>` semantics when possible: render a spacer `<tr>` with the height of the rows above and below the visible window instead of absolutely positioning rows, so the table stays a table for assistive technology. TanStack Table 9 is the current major; check its migration notes when upgrading from 8.

## CSS content-visibility as a lighter option

`content-visibility: auto` lets the browser skip layout and paint for off-screen elements while keeping them in the DOM, so find-in-page and accessibility keep working. It does not reduce React's render work, but for long static content (articles, settings pages, a few hundred cards) it can be enough:

```css
.card { content-visibility: auto; contain-intrinsic-size: auto 180px; }
```

## Live streams with one render per frame

A live source (WebSocket, server-sent events, a worker) can push hundreds of messages per second. Write them into a plain store, coalesce to one snapshot per animation frame, and subscribe small components with `useSyncExternalStore`:

```ts
// src/shared/lib/live-store.ts
import { useSyncExternalStore } from 'react'

export function createLiveStore<T extends { id: string }>() {
  const latest = new Map<string, T>()
  const listeners = new Set<() => void>()
  let snapshot: readonly T[] = []
  let frame = 0

  function push(item: T) {
    latest.set(item.id, item)
    if (frame) return
    frame = requestAnimationFrame(() => {
      frame = 0
      snapshot = [...latest.values()]
      for (const l of listeners) l()
    })
  }
  const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
  const useItems = () => useSyncExternalStore(subscribe, () => snapshot)
  const useItem = (id: string) => useSyncExternalStore(subscribe, () => latest.get(id))
  return { push, useItems, useItem }
}
```

- `snapshot` changes identity only when a frame flushes, so `useSyncExternalStore` does not loop.
- `useItem(id)` re-renders only the row whose item object changed, because each pushed item is a new object.
- `requestAnimationFrame` pauses in background tabs, so a hidden tab does no rendering until it is shown.
- Never animate rows on every data update; constant motion hides the changes that matter.

## Keyboard and screen readers in virtual lists

Virtual lists remove off-screen rows from the DOM, which breaks assumptions of assistive technology. Mitigations:

- Give the container a role and label (`role="list"` or `role="grid"`, `aria-label`) and each row `aria-setsize` and `aria-posinset` so position is announced correctly.
- Manage keyboard focus with roving `tabIndex` and `scrollToIndex` from the virtualizer, so arrow keys move through rows that may not be rendered yet.
- Offer search or filtering; nobody tabs through 10,000 rows.
