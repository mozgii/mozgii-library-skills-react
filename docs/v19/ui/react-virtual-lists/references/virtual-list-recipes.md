---
title: Virtual list recipes with TanStack Virtual
author: MOZGII, Inc.
lang: en
---

# Virtual list recipes with TanStack Virtual

Complete recipes for the virtual list cases that need more than the basics: a chat view, grids and masonry, sticky group headers, horizontal lists, scroll restoration and keyboard navigation. Sources: the TanStack Virtual API reference and its Chat guide (virtual-core 3.16 and newer).

## Chat view with history loading and a jump-to-latest button

A chat view opens at the newest message, loads older messages when the reader nears the top, keeps the visible message still during the prepend, and follows new messages only when pinned to the end:

```tsx
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

type Message = { id: string; author: string; body: string }

export function ChatLog({ messages, hasOlder, loadingOlder, onLoadOlder }: {
  messages: Message[]; hasOlder: boolean; loadingOlder: boolean; onLoadOlder: () => void
}) {
  const parentRef = useRef<HTMLDivElement>(null)
  // oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    getItemKey: (i) => messages[i]!.id,
    anchorTo: 'end',
    followOnAppend: true,
    scrollEndThreshold: 80,
    overscan: 6,
  })
  const pinned = virtualizer.isAtEnd()                       // the virtualizer re-renders on scroll
  const newest = messages.at(-1)
  const firstIndex = virtualizer.getVirtualItems()[0]?.index ?? 0
  useEffect(() => {
    if (firstIndex < 5 && hasOlder && !loadingOlder) onLoadOlder()
  }, [firstIndex, hasOlder, loadingOlder, onLoadOlder])
  useLayoutEffect(() => { virtualizer.scrollToEnd() }, [virtualizer])

  return (
    <div style={{ position: 'relative' }}>
      {/* outside the scroller: a line added inside would shift every message under the reader */}
      <p role="status" style={{ position: 'absolute', top: 0, insetInline: 0, zIndex: 1, margin: 0 }}>{loadingOlder ? 'Loading earlier messages…' : ''}</p>
      <p role="status" className="sr-only">{newest ? `${newest.author}: ${newest.body}` : ''}</p>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scroller with no focusable child needs Tab focus to scroll by keyboard */}
      <div ref={parentRef} role="region" aria-label="Messages" tabIndex={0} style={{ height: '60vh', overflow: 'auto' }}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => {
            const m = messages[row.index]!
            return (
              <div key={row.key} ref={virtualizer.measureElement} data-index={row.index}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` }}>
                <p><strong>{m.author}</strong>: {m.body}</p>
              </div>
            )
          })}
        </div>
      </div>
      {!pinned && (
        <button type="button" style={{ position: 'absolute', bottom: 12, right: 12 }}
          onClick={() => virtualizer.scrollToEnd({ behavior: 'smooth' })}>Jump to latest</button>
      )}
    </div>
  )
}
```

The scroller is not a live region: scrolling mounts rows, so `role="log"` or `aria-live` on it would announce old messages as the reader moves. The separate `role="status"` line holds only the newest message, so history loading and scrolling stay silent. For AI replies that stream token by token, do not announce every token: that line says "Assistant is replying", then "Reply finished".

The scroller's `tabIndex={0}` is correct and stays. Oxlint's `no-noninteractive-tabindex` cannot see that the element scrolls, while axe's `scrollable-region-focusable` requires keyboard access to it, so that one line carries the disable comment.

## Grids and masonry layouts with lanes

The `lanes` option splits a vertical list into columns; each item goes to the shortest lane. Set the cross-axis position from `row.lane`:

```tsx
const lanes = 3
// oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
const virtualizer = useVirtualizer({ count: photos.length, getScrollElement: () => parentRef.current, estimateSize: () => 240, lanes, gap: 12 })
// item style
// { position: 'absolute', top: 0, left: `calc(${(row.lane * 100) / lanes}% + ${row.lane * 4}px)`, width: `calc(${100 / lanes}% - 8px)`, transform: `translateY(${row.start}px)` }
```

For a uniform grid (all cells the same size), virtualize rows of N cells instead: `count = Math.ceil(items.length / columns)` and render a row of cells per virtual item. Recompute `columns` from the container width with a ResizeObserver.

## Sticky group headers

To keep the current group's header visible, include its index in the rendered range with `rangeExtractor`, and render it with `position: sticky` instead of absolute:

```tsx
const activeHeader = useRef(0)
// oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
const virtualizer = useVirtualizer({
  /* … */
  rangeExtractor: useCallback((range) => {
    activeHeader.current = [...headerIndexes].reverse().find((i) => range.startIndex >= i) ?? 0
    const next = new Set([activeHeader.current, ...defaultRangeExtractor(range)])
    return [...next].sort((a, b) => a - b)
  }, [headerIndexes]),
})
```

`defaultRangeExtractor` is exported by `@tanstack/react-virtual`.

## Horizontal virtual lists

Set `horizontal: true`; `estimateSize` then returns widths, `getTotalSize()` is the inner width, and rows use `translateX`. Give the scroll element a fixed width and `overflow-x: auto`.

## Scroll restoration after navigation

Save the measured sizes and the offset when leaving, and pass them back on return, so the list reopens exactly where it was even with variable heights:

```tsx
const saved = readSessionJson<{ offset: number; cache: VirtualItem[] }>(`scroll:${key}`)
// oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
const virtualizer = useVirtualizer({ /* … */ initialOffset: saved?.offset, initialMeasurementsCache: saved?.cache })
useEffect(() => () => {
  writeSessionJson(`scroll:${key}`, { offset: virtualizer.scrollOffset ?? 0, cache: virtualizer.takeSnapshot() })
}, [virtualizer, key])
```

`takeSnapshot()` returns only measured items; the rest fall back to `estimateSize`. Wrap session storage access in try and catch: it can throw in private windows.

## Keyboard navigation in a virtual listbox

For a selectable list (`role="listbox"`), keep focus on the container and track the active option with `aria-activedescendant`, so the active option does not need to keep DOM focus while it scrolls out:

- Arrow keys change `activeIndex` and call `virtualizer.scrollToIndex(activeIndex, { align: 'auto' })`.
- Each rendered option gets `id={`opt-${item.id}`}`, `role="option"`, `aria-selected`.
- The container sets `aria-activedescendant` to the active option's id only when that option is rendered; `scrollToIndex` guarantees it is.

## Performance notes for very large lists

- Keep row components cheap: no heavy hooks or context reads per row. The React Compiler skips the component that calls `useVirtualizer`, so extract a `Row` component; the compiler memoizes that one while its props stay the same.
- `contain: strict` on the scroll element limits layout work to the box.
- `directDomUpdates: true` (React adapter) writes positions straight to the DOM and re-renders React only when the visible range changes; it requires absolutely positioned rows and `virtualizer.containerRef` on the inner element. Set it once at mount.
- `useFlushSync: false` lets React batch scroll updates under the React 19 scheduler if `flushSync` warnings appear.
