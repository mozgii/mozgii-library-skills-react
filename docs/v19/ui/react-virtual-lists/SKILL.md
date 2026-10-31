---
name: react-virtual-lists
description: Renders long lists, feeds, grids and chat logs in React with TanStack Virtual 3 so only the visible rows exist in the DOM - fixed and measured row heights, window scrolling, infinite scroll with TanStack Query's useInfiniteQuery, chat-style lists anchored to the end with anchorTo, followOnAppend and isAtEnd, prepending older history without a jump, grids and masonry with lanes, scroll restoration, keyboard and screen reader access, and when virtualization is not worth it. Use when a list of hundreds or thousands of items scrolls slowly, a feed needs infinite loading, a chat or log view must stick to the newest message, rows of different heights overlap or jump, or scroll position is lost after navigation.
metadata:
  tags:
  - react
  - virtualization
  - tanstack-virtual
  - infinite-scroll
  - chat
  - lists
  - performance
---

# React virtual lists

A virtual list renders only the rows inside the viewport plus a small overscan, and positions them inside a container as tall as the whole list. Ten thousand rows cost the same as thirty. TanStack Virtual is headless: it computes which items to render and where; you render the markup. This skill covers lists, feeds and chat views; virtual rows inside a data table are in the `react-data-tables` skill.

## Step 0: read the installed TanStack Virtual version

The chat and anchoring options are recent, so read the version first:

```bash
node -p "['@tanstack/react-virtual','@tanstack/virtual-core','@tanstack/react-query','react'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against `@tanstack/react-virtual` 3.14.24 (with `@tanstack/virtual-core` 3.19.9). End anchoring for chat (`anchorTo: 'end'`, `followOnAppend`, `scrollEndThreshold`, `scrollToEnd()`, `isAtEnd()`, `getDistanceFromEnd()`) arrived in virtual-core 3.16.0, shipped with react-virtual 3.13.26; on older versions, upgrade instead of hand-writing scroll compensation.

## Decision table: virtualize or not, and with what

| Situation | Use | Why the others lose |
|---|---|---|
| Fewer than about 200 simple rows | plain rendering | virtualization adds complexity and breaks find-in-page for no gain |
| Long page of cards that scrolls with the document | `content-visibility: auto` with `contain-intrinsic-size` | keeps find-in-page and anchors; no JS, but every row is still in the DOM |
| Hundreds to millions of rows in a scroll box | `useVirtualizer` from TanStack Virtual | rendering all rows blocks the main thread and uses memory |
| A list that scrolls with the window (feed, search results) | `useWindowVirtualizer` | a nested scroll box breaks the page's own scrolling and mobile toolbars |
| Chat, logs, AI streaming output | `useVirtualizer` with `anchorTo: 'end'` and `followOnAppend` | `column-reverse` tricks break keyboard order and selection |
| Ready-made list with sticky groups and chat built in, no headless control needed | `react-virtuoso` 4 | gives less control over markup |
| Fixed-size rows, smallest API | `react-window` 2 | no dynamic measurement or chat anchoring of the same depth |

## TanStack Virtual for a fixed-height list

The scroll container needs a fixed height and `overflow: auto`; an inner element as tall as `getTotalSize()`; and absolutely positioned rows:

```tsx
import { useVirtualizer } from '@tanstack/react-virtual'

function UserList({ users }: { users: User[] }) {
  const parentRef = useRef<HTMLDivElement>(null)
  // oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
  const virtualizer = useVirtualizer({
    count: users.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    getItemKey: (i) => users[i]!.id,
    overscan: 8,
  })
  return (
    <div ref={parentRef} style={{ height: 480, overflow: 'auto' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div key={row.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: row.size, transform: `translateY(${row.start}px)` }}>
            {users[row.index]!.name}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- `getItemKey` with a stable id keeps measurements and React state attached to the right item when the list reorders.
- `overscan` renders extra rows above and below; raise it if fast scrolling shows blank space.
- `scrollToIndex(i, { align: 'center' })` and `scrollToOffset(px)` move programmatically.

## Dynamic row heights with measureElement

When rows differ in height, give a good `estimateSize` and let the virtualizer measure each rendered row. Pass `measureElement` as the row's ref and the index as `data-index`, and let the row size itself (no fixed `height`):

```tsx
{virtualizer.getVirtualItems().map((row) => (
  <div key={row.key} ref={virtualizer.measureElement} data-index={row.index}
    style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` }}>
    <Comment comment={comments[row.index]!} />
  </div>
))}
```

- An estimate close to the typical height keeps the scrollbar from jumping as rows are measured.
- Rows that change height later (an image loads, a row expands) are re-measured through a ResizeObserver.
- Use the `gap` option for spacing between rows instead of margins, which `measureElement` does not count.

## Window scrolling with useWindowVirtualizer

A feed that scrolls with the page uses the window as the scroll element. When the list does not start at the top of the page, pass its offset as `scrollMargin` and subtract it when positioning:

```tsx
const listRef = useRef<HTMLDivElement>(null)
const [scrollMargin, setScrollMargin] = useState(0)
useLayoutEffect(() => { setScrollMargin(listRef.current?.offsetTop ?? 0) }, [])     // refs are read after commit, never during render
// oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
const virtualizer = useWindowVirtualizer({ count: posts.length, estimateSize: () => 320, scrollMargin })
// row style: transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`
```

## Infinite scroll with useInfiniteQuery

Infinite scroll loads the next page when the last rendered row comes into view. Flatten the pages, add one extra row for the loader, and fetch when that row is rendered:

```tsx
const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
  queryKey: ['posts'],
  queryFn: ({ pageParam, signal }) => getPosts({ cursor: pageParam, signal }),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.nextCursor,
})
const rows = data?.pages.flatMap((p) => p.items) ?? []
// oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
const virtualizer = useVirtualizer({ count: hasNextPage ? rows.length + 1 : rows.length, /* … */ })
const lastIndex = virtualizer.getVirtualItems().at(-1)?.index ?? -1
useEffect(() => {
  if (lastIndex >= rows.length - 1 && hasNextPage && !isFetchingNextPage) void fetchNextPage()
}, [lastIndex, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage])
```

Use cursor pagination, not page numbers, so inserts on the server do not duplicate or skip rows. Keep a "Load more" button as a fallback for keyboard users and when a fetch fails.

## Chat-style lists anchored to the end

Chat, logs and AI streams add new items at the bottom, load history at the top, and should follow new output only when the reader is already at the bottom. TanStack Virtual does this with end anchoring:

```tsx
// oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
const virtualizer = useVirtualizer({
  count: messages.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 72,
  getItemKey: (i) => messages[i]!.id,       // required: index keys cannot tell a prepend from an append
  anchorTo: 'end',                           // keeps the visible message still when older ones are prepended
  followOnAppend: true,                      // follow new messages only if already at the end
  scrollEndThreshold: 80,                    // within 80 px of the end counts as pinned
  overscan: 6,
})
useLayoutEffect(() => { virtualizer.scrollToEnd() }, [virtualizer])   // open at the latest message
```

- A streaming reply that grows the last message keeps the view pinned while the user is at the end.
- Show a "Jump to latest" button when `!virtualizer.isAtEnd()`; it calls `virtualizer.scrollToEnd({ behavior: 'smooth' })`.
- Use normal item order and a normal scroll box: no `flex-direction: column-reverse`, no inverted transforms.

The full chat component with history loading and the jump button: [virtual-list-recipes.md](references/virtual-list-recipes.md).

## Worked example: an infinite, accessible activity feed

An activity feed in a scroll box with measured rows, infinite loading, and loading, error, empty and end states:

```tsx
import { useEffect, useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'

type Activity = { id: string; actor: string; text: string; at: string }
type Page = { items: Activity[]; nextCursor: string | null }

async function getActivity(cursor: string | null, signal: AbortSignal): Promise<Page> {
  const res = await fetch(`/api/activity?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { signal })
  if (!res.ok) throw new Error(`Activity failed: HTTP ${res.status}`)
  return res.json() as Promise<Page>
}

export function ActivityFeed() {
  const parentRef = useRef<HTMLDivElement>(null)
  const { data, isPending, isError, refetch, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = useInfiniteQuery({
    queryKey: ['activity'],
    queryFn: ({ pageParam, signal }) => getActivity(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  })
  const items = data?.pages.flatMap((p) => p.items) ?? []
  // oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
  const virtualizer = useVirtualizer({
    count: hasNextPage ? items.length + 1 : items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    getItemKey: (i) => items[i]?.id ?? 'loader',
    overscan: 6,
  })
  const lastIndex = virtualizer.getVirtualItems().at(-1)?.index ?? -1
  useEffect(() => {
    if (lastIndex >= items.length - 1 && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [lastIndex, items.length, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])

  if (isPending) return <p role="status">Loading activity…</p>
  if (isError && items.length === 0) return <div role="alert"><p>Activity could not be loaded.</p><button type="button" onClick={() => refetch()}>Retry</button></div>
  if (items.length === 0) return <p>No activity yet.</p>

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the articles are tabIndex -1, so the scroller needs Tab focus to scroll by keyboard
    <div ref={parentRef} role="feed" aria-busy={isFetchingNextPage} aria-label="Activity" tabIndex={0}
      style={{ height: 'min(70vh, 640px)', overflow: 'auto', contain: 'strict' }}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => {
          const item = items[row.index]
          return (
            <div key={row.key} ref={virtualizer.measureElement} data-index={row.index}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start}px)` }}>
              {item ? (
                <article aria-posinset={row.index + 1} aria-setsize={hasNextPage ? -1 : items.length} tabIndex={-1}>
                  <p><strong>{item.actor}</strong> {item.text}</p>
                  <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time>
                </article>
              ) : isFetchNextPageError ? (
                <div role="alert">Could not load more. <button type="button" onClick={() => fetchNextPage()}>Try again</button></div>
              ) : (
                <p role="status">Loading more…</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

`role="feed"` with `aria-posinset` and `aria-setsize` (`-1` when the total is unknown) tells screen readers each article's position although most are not in the DOM. The loader row turns into a retry row when a page fails, so the list never fetches in a loop. In TanStack Query 5 a failed `fetchNextPage` puts the whole query in the error state while keeping the loaded pages, so the full-page error shows only when there is nothing to keep.

## Verify virtual lists

- Load 10,000 items and scroll fast in a Performance recording: frames stay near 16 ms and the DOM holds only tens of rows (`document.querySelectorAll('[data-index]').length`).
- Resize the window and expand a row: no overlap, no gap, no jump at the top.
- For chat: scroll up, let a message arrive (the view stays), scroll to the end (new messages follow), load history (the visible message stays in place).
- Keyboard: Tab into the list and move through items; the focused item stays rendered while focused.
- Navigate away and back: scroll position restores (see the snapshot recipe in the reference).

## Gotchas and anti-patterns in virtual lists

Each gotcha names the symptom, its cause and the fix.

1. **Nothing renders.** Cause: the scroll container has no fixed height, so it grows to fit and the virtualizer sees no viewport. Fix: give it a height (`height`, `max-height` with flex, or `100dvh` minus chrome) and `overflow: auto`.
2. **Rows overlap or leave gaps.** Cause: variable heights without `measureElement`, or a fixed `height` on measured rows, or margins between rows. Fix: `ref={virtualizer.measureElement}` with `data-index`, no fixed height, `gap` instead of margins.
3. **The list jumps when older messages load.** Cause: index keys or a start-anchored list. Fix: `getItemKey` from ids and `anchorTo: 'end'`.
4. **New messages pull the reader away from history.** Cause: scrolling to the bottom on every append. Fix: `followOnAppend` with `scrollEndThreshold`, plus a "Jump to latest" button.
5. **Infinite scroll fetches in a loop after an error.** Cause: the effect fires again while the loader row is visible. Fix: stop when `isFetchNextPageError` and show a retry row.
6. **Ctrl+F does not find off-screen rows.** Cause: virtualized rows are not in the DOM. Fix: provide in-app search, or use `content-visibility: auto` for lists under a few thousand rows.
7. **Focus is lost while scrolling with the keyboard.** Cause: the focused row scrolled out and unmounted. Fix: keep the focused index in `rangeExtractor`'s output, or manage focus with roving `tabIndex` and `scrollToIndex`.
8. **Blank rows flash during fast scrolls.** Cause: expensive rows. Fix: raise `overscan`, simplify row rendering, extract a `Row` component (the React Compiler skips the component that calls `useVirtualizer`, but memoizes a `Row` it renders), or try `directDomUpdates: true` to skip React renders on scroll.

## Pre-merge checklist for virtual lists

1. Virtualization is justified by size; short lists render plainly.
2. The scroll element has a fixed height and `overflow: auto`, or the window virtualizer with `scrollMargin` is used.
3. `getItemKey` uses stable ids; variable rows use `measureElement` with `data-index`.
4. Infinite loading uses cursors, stops on errors and offers a retry and a manual "Load more".
5. Chat views use `anchorTo: 'end'`, `followOnAppend` and a "Jump to latest" control.
6. Loading, error, empty and end-of-list states render; the list has a role and positions for screen readers.
7. Checked with 10,000 items, fast scrolling, resizing and keyboard navigation.

See also: react-performance, react-data-tables, react-data-fetching, react-ai-chat-ui, react-realtime.
