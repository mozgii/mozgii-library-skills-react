---
name: react-data-fetching
description: Loads and changes server data in React with TanStack Query 5 - QueryClient defaults, query keys and queryOptions, the new queryClient.query method that replaces fetchQuery, prefetchQuery and ensureQueryData, mutations with invalidation and optimistic updates, Suspense queries, infinite lists, push invalidation from WebSocket or server-sent events, plus React 19 use with promises and non-HTTP transports. Use when fetching data in components, replacing useEffect fetching, sharing a cache with route loaders, keeping several tabs or windows in sync, adding optimistic UI, paging, or when a query never runs, refetches too often or shows stale data.
metadata:
  tags:
  - react
  - data-fetching
  - tanstack-query
  - react-query
  - suspense
  - mutations
  - optimistic-ui
  - cache
---

# React data fetching with TanStack Query

Server data is a cache, not component state: it belongs to the server, it goes stale, and many components read it at once. TanStack Query (React Query) 5 owns that cache in React apps: it deduplicates requests, caches by key, refetches when data goes stale and tracks loading and error states. This skill covers `@tanstack/react-query` 5.105 with React 19.3. Routing loaders that share this cache are in `react-router-data-mode` and `tanstack-router`.

## Step 0: read the TanStack Query version

TanStack Query 5.10x deprecated several `QueryClient` methods, so the version decides what to write:

```bash
node -p "require('@tanstack/react-query/package.json').version"     # 5.105.0 when this was written
```

From 5.10x, `queryClient.query(options)` replaces `fetchQuery` and `prefetchQuery`, `queryClient.query({ ...options, staleTime: 'static' })` replaces `ensureQueryData`, and `queryClient.infiniteQuery` replaces the three infinite variants. The old methods still work and will be removed in v6. On older 5.x versions, keep the old names. Coming from v4 (`cacheTime`, `isLoading`, positional arguments): `react-migrations`.

## Choose how a screen loads data

Choosing how a screen loads server data depends on who needs the data first and how it changes. Most screens take the first row:

| Situation | Use | Why the alternatives lose |
|---|---|---|
| A component shows server data | `useQuery` with `queryOptions` | `useEffect` + `useState` has no cache, no deduplication, no retry and races on fast changes |
| A route needs data before it renders | a loader that calls `queryClient.query`, the component reads `useSuspenseQuery` | fetching only in the component starts after its code loads: a waterfall |
| Loading and error UI belong to the layout, not each component | `useSuspenseQuery` under `<Suspense>` and an error boundary | `useQuery` makes every component check `isPending` and `isError` itself |
| "Load more" or infinite scroll | `useInfiniteQuery` with `maxPages` and both page-param functions | page arrays kept in `useState` lose the cache and grow without bound |
| A change to server data | `useMutation`, then `setQueryData` or `invalidateQueries` | calling `refetch()` by hand misses the other screens that show the same data |
| The server can say what changed | push invalidation and a long `staleTime` | polling sends requests when nothing changed and lags when something did |
| Many messages per second (prices, cursors, progress) | an external store, one render per frame (`react-realtime`) | a cache write per message re-renders every subscriber |
| A promise already created by a framework or loader | `use(promise)` | it has no cache or refetch, so it is wrong for app data |
| The app already uses Redux Toolkit | RTK Query | a second cache library means two sources of truth for the same records |

SWR 2 is a smaller alternative for read-mostly apps; TanStack Query ships more in the box (mutation state, official devtools, persistence plugins), which is why this skill uses it.

## Install and set up the QueryClient

One `QueryClient` per app holds the cache. Create it at module scope and provide it at the root:

```bash
npm i @tanstack/react-query
npm i -D @tanstack/react-query-devtools @tanstack/eslint-plugin-query
```

```tsx
// src/shared/lib/query-client.ts
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: 2, refetchOnWindowFocus: true },
  },
})
```

```tsx
// src/app/providers.tsx
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

<QueryClientProvider client={queryClient}>
  <App />
  <ReactQueryDevtools initialIsOpen={false} />
</QueryClientProvider>
```

- `staleTime` (default 0) is how long data counts as fresh; fresh data is served from cache without a request. Most apps want 10 to 60 seconds, not 0.
- `gcTime` (default 5 minutes) is how long unused data stays in memory.
- The ESLint plugin (`@tanstack/eslint-plugin-query`) catches missing key dependencies; in Oxlint-only projects, follow the key rule in the next section by hand.

## Query keys and queryOptions

Two different filters showing the same cached data in React Query means the filter is missing from the query key:
the cache is keyed by `queryKey`, so every input of `queryFn` (filters, page, sort) must be in the key.

Define keys and query functions together with `queryOptions`, per feature, so a key can never miss an input:

```ts
// src/features/invoices/api.ts
import { queryOptions } from '@tanstack/react-query'
import { http } from '@/shared/lib/http'

export const invoiceQueries = {
  all: () => ['invoices'] as const,
  list: (filters: { status: string; page: number }) =>
    queryOptions({
      queryKey: [...invoiceQueries.all(), 'list', filters],
      queryFn: ({ signal }) => http<Invoice[]>(`/api/invoices?status=${encodeURIComponent(filters.status)}&page=${filters.page}`, { signal }),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: [...invoiceQueries.all(), 'detail', id],
      queryFn: ({ signal }) => http<Invoice>(`/api/invoices/${encodeURIComponent(id)}`, { signal }),
      staleTime: 60_000,
    }),
}
```

- Keys are arrays, hierarchical from general to specific, so `['invoices']` invalidates every invoice query at once.
- `queryOptions` types the data everywhere the options are used: `useQuery`, `useSuspenseQuery`, `queryClient.query`, `getQueryData`.
- Pass `signal` to `fetch`, so leaving a screen cancels its requests.
- `fetch` does not reject on HTTP errors; the `http` helper must throw on `!res.ok`, or errors arrive as data. Helper: [query-patterns.md](references/query-patterns.md).

## Read data with useQuery

`useQuery` subscribes a component to one cache entry and returns its state. Handle every state the screen can be in:

```tsx
import { useQuery } from '@tanstack/react-query'

function InvoiceDetail({ id }: { id: string }) {
  const { data, isPending, isError, error, isFetching } = useQuery(invoiceQueries.detail(id))
  if (isPending) return <Skeleton lines={4} />
  if (isError) return <ErrorState message={error.message} />
  return <InvoiceView invoice={data} refreshing={isFetching} />
}
```

- `isPending`: no data yet. `isFetching`: a request is running, possibly a background refetch while old data shows.
- Dependent query: `enabled: !!userId`, or pass `skipToken` as `queryFn` when an input is missing, which keeps types sound.
- Transform with `select: (data) => data.filter(...)`; components re-render only when the selected result changes.
- Keep the previous page on screen while the next loads: `placeholderData: keepPreviousData`.

## Suspense queries

`useSuspenseQuery` suspends until data exists, so the component always has `data` and loading and error UI move to `<Suspense>` and an error boundary:

```tsx
<ErrorBoundary fallbackRender={({ resetErrorBoundary }) => <RetryPanel onRetry={resetErrorBoundary} />} onReset={reset}>
  <Suspense fallback={<Skeleton lines={4} />}>
    <InvoiceDetail id={id} />
  </Suspense>
</ErrorBoundary>

function InvoiceDetail({ id }: { id: string }) {
  const { data } = useSuspenseQuery(invoiceQueries.detail(id))   // data is never undefined
  return <InvoiceView invoice={data} />
}
```

- `reset` comes from `useQueryErrorResetBoundary()` (or `<QueryErrorResetBoundary>`), so retrying after an error refetches instead of re-throwing the cached error.
- Two `useSuspenseQuery` calls in one component run one after the other (a waterfall). Use `useSuspenseQueries` or start both with `usePrefetchQuery` above the boundary.
- Error boundaries: `react-error-handling`.

## Load in route loaders with queryClient.query

Route loaders start requests before the component renders; sharing the query cache means the loader and the component never fetch twice. Use `queryClient.query` in the loader and the same options in the component:

```ts
// React Router data mode loader
export async function invoiceLoader({ params }: LoaderFunctionArgs) {
  await queryClient.query({ ...invoiceQueries.detail(params.id!), staleTime: 'static' })   // cached data is used as is
  return null
}
// component: useSuspenseQuery(invoiceQueries.detail(id)) reads the warm cache
```

- `queryClient.query(options)` returns cached data while it is fresh and fetches otherwise; it rejects on error, so the router's error boundary handles failures.
- `staleTime: 'static'` returns any cached data, however old (what `ensureQueryData` did). Leave it out to respect the query's `staleTime`.
- Prefetch without awaiting (what `prefetchQuery` did): `void queryClient.query(opts).catch(() => {})`.

## Change data with useMutation

A mutation sends a change and then updates the cache. The simplest correct update is invalidation: mark related queries stale and let the active ones refetch:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'

function PayButton({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const pay = useMutation({
    mutationFn: () => http<Invoice>(`/api/invoices/${id}/pay`, { method: 'POST' }),
    onSuccess: (invoice) => {
      queryClient.setQueryData(invoiceQueries.detail(id).queryKey, invoice)       // the server returned it: use it
      return queryClient.invalidateQueries({ queryKey: invoiceQueries.all() })    // lists may have changed
    },
  })
  return <button disabled={pay.isPending} onClick={() => pay.mutate()}>{pay.isPending ? 'Paying…' : 'Pay'}</button>
}
```

- Returning the invalidation promise from `onSuccess` keeps `isPending` true until fresh data has arrived.
- Show mutation errors next to the control (`pay.isError`, `pay.error`); a mutation error does not reach an error boundary unless `throwOnError` is set.
- Share mutation definitions with `mutationOptions`, like `queryOptions`.

## Optimistic updates

An optimistic update shows the result before the server confirms it. The light way renders from the mutation's `variables` while it is pending; the cache way edits the cache and rolls back on error:

```tsx
// Light: no cache surgery; the pending item shows from variables
const add = useMutation({ mutationFn: addTodo, onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }) })
{add.isPending && <TodoRow todo={{ id: 'pending', title: add.variables.title }} pending />}
```

```ts
// Cache: edit, remember, roll back
useMutation({
  mutationFn: toggleTodo,
  onMutate: async (id: string, ctx) => {
    await ctx.client.cancelQueries({ queryKey: ['todos'] })
    const previous = ctx.client.getQueryData<Todo[]>(['todos'])
    ctx.client.setQueryData<Todo[]>(['todos'], (old) => old?.map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
    return { previous }
  },
  onError: (_e, _id, result, ctx) => ctx.client.setQueryData(['todos'], result?.previous),
  onSettled: (_d, _e, _id, _r, ctx) => ctx.client.invalidateQueries({ queryKey: ['todos'] }),
})
```

Use the cache way when several components show the changed data; the light way when only one place does. React's own `useOptimistic` fits form Actions (`react-forms`).

## Infinite and paged lists

`useInfiniteQuery` loads pages and concatenates them for "load more" and infinite scroll:

```tsx
const feed = useInfiniteQuery({
  queryKey: ['feed'],
  queryFn: ({ pageParam, signal }) => http<{ items: Post[]; prev: string | null; next: string | null }>(`/api/feed?cursor=${encodeURIComponent(pageParam ?? '')}`, { signal }),
  initialPageParam: null as string | null,
  getNextPageParam: (last) => last.next,
  getPreviousPageParam: (first) => first.prev,    // without it, pages dropped by maxPages never come back
  maxPages: 10,                                   // bound memory on endless feeds
})
const posts = feed.data?.pages.flatMap((p) => p.items) ?? []
```

Combine with a virtualized list for thousands of rows (`react-performance`). For numbered pages, use a normal query keyed by page with `placeholderData: keepPreviousData`.

## Keep clients in sync with push invalidation

Push invalidation keeps every open tab or window current without polling: the server sends which data changed, and the client invalidates those keys. It works over WebSocket, server-sent events, `BroadcastChannel` between tabs, or a desktop app's IPC:

```ts
// src/shared/lib/live-invalidation.ts
export function connectInvalidation(url: string) {
  const events = new EventSource(url)                     // server sends { "keys": [["invoices"], ["invoices","detail","42"]] }
  events.addEventListener('changed', (e) => {
    const { keys } = JSON.parse((e as MessageEvent<string>).data) as { keys: unknown[][] }
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey })
  })
  return () => events.close()
}
```

- With push in place, raise `staleTime` (even to `Infinity`) and drop `refetchOnWindowFocus`: data changes only when the server says so.
- The writer's own mutation can skip manual invalidation, because the push reaches the writer too.
- Not every write path can publish events (another system writes the database). Keep a finite `staleTime` there.

## Non-HTTP transports and networkMode

TanStack Query works with any promise, not only HTTP: IndexedDB, a Web Worker, a WebSocket request, an Electron or Tauri IPC call. Its default `networkMode: 'online'` pauses queries while `navigator.onLine` is false, which is wrong when the transport does not use the network:

```ts
new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always', retry: false },     // IPC or local DB: never pause, a retry returns the same error
    mutations: { networkMode: 'always' },
  },
})
```

Symptom of the wrong mode: queries stuck with `fetchStatus: 'paused'` when Wi-Fi drops, though the data source is local.

## React 19 use with a promise

React's `use(promise)` reads a promise inside a component and suspends until it settles. The promise must be created outside render (by a parent, a loader or a cache), or each render makes a new one and suspends forever:

```tsx
function Page() {
  const [commentsPromise] = useState(() => fetchComments(postId))     // created once
  return <Suspense fallback={<Spinner />}><Comments promise={commentsPromise} /></Suspense>
}
function Comments({ promise }: { promise: Promise<Comment[]> }) {
  const comments = use(promise)
  return <ul>{comments.map((c) => <li key={c.id}>{c.text}</li>)}</ul>
}
```

`use` has no cache, refetch or invalidation; it fits promises from a framework or loader. For app data, a query cache is the better default.

## Worked example: an invoice screen with every state

A worked example screen reads a paged list with `useQuery`, keeps the previous page on screen while the next loads, and renders pending, error, empty and success with roles a screen reader announces:

```tsx
// src/features/invoices/InvoicesScreen.tsx
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { invoiceQueries } from './api'

export function InvoicesScreen({ status, page }: { status: 'open' | 'paid'; page: number }) {
  const invoices = useQuery({ ...invoiceQueries.list({ status, page }), placeholderData: keepPreviousData })

  if (invoices.isPending) return <div role="status" aria-label="Loading invoices"><TableSkeleton rows={8} /></div>
  if (invoices.isError) {
    return (
      <div role="alert">
        <p>Invoices could not be loaded. {invoices.error.message}</p>
        <button type="button" onClick={() => void invoices.refetch()}>Try again</button>
      </div>
    )
  }
  if (invoices.data.length === 0) return <EmptyState title={status === 'open' ? 'No open invoices' : 'No paid invoices yet'} />
  return (
    <section aria-label="Invoices" aria-busy={invoices.isFetching}>
      {invoices.isPlaceholderData && <p role="status">Loading page {page}…</p>}
      <InvoiceTable rows={invoices.data} dimmed={invoices.isPlaceholderData} />
    </section>
  )
}
```

The full feature (the `api.ts` with a Zod-checked response, a pay mutation with its inline error, and MSW tests for each state): [invoice-screen-example.md](references/invoice-screen-example.md).

## Verify data fetching

Data fetching is proven when each state renders in a test, the network shows one request per key, and no effect-based fetching is left. Run:

```bash
npx tsc -b && npx oxlint --deny-warnings
npx vitest run src/features/invoices                     # MSW tests: pending, error + retry, empty, success
grep -rl "useEffect" src | xargs grep -l "fetch(" 2>/dev/null   # files to review for leftover effect fetching
```

- Count requests in a test: an MSW handler that increments a counter, two components with the same `queryOptions`, `expect(calls).toBe(1)`.
- In the browser, React Query Devtools shows each key, its fresh or stale state and observers; going back to a screen inside `staleTime` sends no request in the Network tab.
- On ESLint, `@tanstack/eslint-plugin-query` (`exhaustive-deps`) fails a key that misses an input of `queryFn`.

## Pre-merge checklist for data fetching

Check each point before merging code that reads or writes server data.

1. One `QueryClient` at module scope; a non-zero `staleTime` chosen on purpose.
2. Keys and functions defined together with `queryOptions`; every input of `queryFn` is in the key.
3. `signal` passed to the request; HTTP errors thrown, not returned.
4. Each screen handles pending, error, empty and success; background refetch shown subtly.
5. Loaders use `queryClient.query` (5.10x) and components read the same options.
6. Mutations update or invalidate the cache; errors shown next to the control.
7. Long lists use infinite queries with `maxPages` and `getPreviousPageParam`, or a virtualized list.
8. `networkMode: 'always'` for non-network transports.
9. No `useEffect` + `useState` fetching left in components.

## Gotchas and anti-patterns in TanStack Query

Each entry gives the symptom you see, its cause and the fix.

1. **Two filters show the same data.** Cause: the filter is used in `queryFn` but missing from `queryKey`. Fix: put every input in the key.
2. **Every mount refetches.** Cause: default `staleTime: 0`. Fix: set a `staleTime` that matches how fast the data changes.
3. **Errors render as data.** Cause: `fetch` resolves on 404 and 500. Fix: throw when `!res.ok`.
4. **Query stuck in `paused`.** Cause: `networkMode: 'online'` with a local transport or offline device. Fix: `networkMode: 'always'` for local sources.
5. **Deprecation warnings for `ensureQueryData` or `prefetchQuery`.** Cause: TanStack Query 5.10x deprecated them. Fix: `queryClient.query(...)`, with `staleTime: 'static'` for the ensure behaviour.
6. **Retry after an error does nothing in a Suspense tree.** Cause: the error boundary resets but the query keeps its error. Fix: pass `reset` from `useQueryErrorResetBoundary` to the boundary's `onReset`.
7. **Waterfall of spinners.** Cause: sequential `useSuspenseQuery` calls or nested components each fetching. Fix: `useSuspenseQueries`, prefetch in the loader, or hoist the queries.
8. **Optimistic update flickers back.** Cause: an in-flight refetch overwrote the optimistic data. Fix: `cancelQueries` in `onMutate` before writing.
9. **Anti-pattern: copying query data into `useState`.** Symptom: the screen keeps old values after a refetch or invalidation. Cause: the copy no longer follows the cache. Fix: read `data` directly; derive with `select` or during render.
10. **Anti-pattern: `new QueryClient()` inside a component.** Symptom: the cache empties and every query refetches on each render of that component. Cause: a new client per render. Fix: create it at module scope (or once with `useState(() => new QueryClient())` in tests and server rendering).
11. **Anti-pattern: `refetch()` with new parameters.** Symptom: changing a filter shows old results. Cause: `refetch` reruns the same key. Fix: change the key (state in the key), never call `refetch` to switch inputs.

More recipes (HTTP helper, query key factories, auth headers, polling, offline, testing setup): [query-patterns.md](references/query-patterns.md).

## See also

- `react-realtime`: WebSocket and server-sent event streams, presence and high-frequency updates.
- `react-suspense-and-concurrency`: Suspense boundaries, transitions and streaming reveals around queries.
- `react-error-handling`, `react-router-data-mode`, `tanstack-router`, `react-state-management`.
