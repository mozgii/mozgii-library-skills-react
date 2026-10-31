---
title: TanStack Query patterns and recipes
author: MOZGII, Inc.
lang: en
---

# TanStack Query patterns and recipes

Supporting code for TanStack Query 5.105 in React: an HTTP helper that throws on errors, auth headers, polling, offline mutations, streams of frequent updates, and a test setup.

## Contents

This page, TanStack Query patterns and recipes, has these sections.

1. HTTP helper that throws typed errors
2. Validating responses with a schema
3. Auth headers and 401 handling
4. Polling and refetch intervals
5. Global error toasts with QueryCache callbacks
6. Offline mutations and persistence
7. High-frequency updates outside the cache
8. Testing components that use queries

## HTTP helper that throws typed errors

A fetch wrapper turns HTTP failures into thrown errors with a status, so TanStack Query's `isError`, retries and error boundaries see them:

```ts
// src/shared/lib/http.ts
export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message) }
}

export async function http<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => undefined)
    throw new HttpError(res.status, `HTTP ${res.status} ${res.statusText}`, body)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}
```

Do not retry client errors: `retry: (count, error) => !(error instanceof HttpError && error.status < 500) && count < 2`.

## Validating responses with a schema

A cast (`as T`) trusts the server blindly. Parse the response with a schema at the boundary so a changed API fails loudly in one place:

```ts
import { z } from 'zod'

const Invoice = z.object({ id: z.string(), number: z.string(), total: z.number(), status: z.enum(['draft', 'sent', 'paid']) })
export type Invoice = z.infer<typeof Invoice>

export const invoiceDetail = (id: string) => queryOptions({
  queryKey: ['invoices', 'detail', id],
  queryFn: async ({ signal }) => Invoice.parse(await http<unknown>(`/api/invoices/${id}`, { signal })),
})
```

## Auth headers and 401 handling

Add the token in the HTTP helper, not in every query function. On a 401, clear the session and send the user to sign in once, from the cache's error callback:

```ts
import { QueryCache, QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof HttpError && error.status === 401) session.signOut({ redirect: '/login' })
    },
  }),
})
```

Prefer an HttpOnly cookie set by the server over a token in JavaScript memory or storage; then the helper needs only `credentials: 'include'`.

## Polling and refetch intervals

Polling refetches on an interval while the component is mounted; it stops in background tabs by default:

```ts
useQuery({ ...jobQueries.status(jobId), refetchInterval: (query) => (query.state.data?.done ? false : 2000) })
```

The function form stops polling once the job finishes. Push invalidation (SKILL.md) is better when the server can send events.

## Global error toasts with QueryCache callbacks

Show one toast per failed background refetch, but only when the screen already has data (otherwise the component shows its own error state):

```ts
queryCache: new QueryCache({
  onError: (error, query) => {
    if (query.state.data !== undefined) toast.error(`Could not refresh: ${error.message}`)
  },
}),
```

The callbacks on `QueryCache` and `MutationCache` run once per query or mutation, unlike `onError` in `useQuery` options, which v5 removed for this reason.

## Offline mutations and persistence

Mutations made offline pause (with the default `networkMode: 'online'`) and resume when the connection returns. To survive a reload, persist the cache and give paused mutations a default function by key:

```ts
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'

queryClient.setMutationDefaults(['todos', 'add'], { mutationFn: addTodo })
const persister = createAsyncStoragePersister({ storage: window.localStorage })

<PersistQueryClientProvider client={queryClient} persistOptions={{ persister, maxAge: 24 * 60 * 60_000 }}
  onSuccess={() => queryClient.resumePausedMutations()}>
  <App />
</PersistQueryClientProvider>
```

Set `gcTime` at least as long as `maxAge`, or entries are collected before they are persisted.

## High-frequency updates outside the cache

Progress bars, cursors and live metrics can arrive many times per second. Writing each message into the query cache re-renders every observer per message. Keep such streams in a small external store and publish at most one snapshot per animation frame:

```ts
// src/shared/lib/progress-store.ts
import { useSyncExternalStore } from 'react'

export type Progress = { id: string; done: number; total: number }
const latest = new Map<string, Progress>()
const listeners = new Set<() => void>()
let snapshot: readonly Progress[] = []
let frame = 0

export function pushProgress(p: Progress) {
  latest.set(p.id, p)
  if (frame) return
  frame = requestAnimationFrame(() => {        // many messages, one render per frame
    frame = 0
    snapshot = [...latest.values()]
    for (const l of listeners) l()
  })
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }   // one stable function: an inline one resubscribes every render
export const useProgress = () => useSyncExternalStore(subscribe, () => snapshot)
```

`requestAnimationFrame` pauses in hidden tabs, so a background tab renders nothing until shown. When a job finishes, invalidate its query so the final result comes from the cache.

## Testing components that use queries

Each test gets a fresh `QueryClient` with retries off, so tests do not share cache or wait for retries. Mock the network with MSW (`react-testing`):

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'

export function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
  return { client, ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>) }
}

test('shows the invoice number', async () => {
  renderWithQuery(<InvoiceDetail id="42" />)
  expect(await screen.findByRole('heading', { name: /invoice 2026-042/i })).toBeInTheDocument()
})
```
