---
title: Offline data and custom service workers
author: MOZGII, Inc.
lang: en
---

# Offline data and custom service workers

Recipes for PWAs that keep working without a network: persisting the TanStack Query cache, queuing mutations offline, a custom service worker with `injectManifest`, background sync, push notifications, clearing caches on sign-out, and removing a service worker safely. Sources: the vite-plugin-pwa guide, the Workbox 7 module documentation, the TanStack Query 5 persistence documentation, and MDN (Service Worker API, Storage API, Push API).

## Persist the TanStack Query cache to IndexedDB

The persisted cache restores data on startup, before the network answers, and keeps it available offline. IndexedDB holds more than `localStorage` and does not block the main thread:

```tsx
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister'
import { get, set, del } from 'idb-keyval'

const queryClient = new QueryClient({
  defaultOptions: { queries: { gcTime: 1000 * 60 * 60 * 24, staleTime: 60_000, networkMode: 'offlineFirst' } },
})
const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: 'app-query-cache',
  throttleTime: 1000,
})

<PersistQueryClientProvider
  client={queryClient}
  persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24, buster: import.meta.env.VITE_APP_VERSION }}
  onSuccess={() => { void queryClient.resumePausedMutations() }}
>
  <App />
</PersistQueryClientProvider>
```

- `gcTime` must be at least `maxAge`, or queries are garbage-collected before they are written.
- Change `buster` on each release whose data shapes changed; old caches are discarded.
- Exclude sensitive queries with `dehydrateOptions: { shouldDehydrateQuery: (q) => defaultShouldDehydrateQuery(q) && q.meta?.persist !== false }`, importing `defaultShouldDehydrateQuery` from `@tanstack/react-query`. The option replaces the default, so without that call failed and pending queries persist too.
- Clear the persisted cache on sign-out (`await del('app-query-cache')` and `queryClient.clear()`).

## Queue mutations made offline

A mutation started offline is paused, not failed. To survive a reload, the mutation function must be known by key, because functions cannot be stored:

```ts
queryClient.setMutationDefaults(['todos', 'add'], {
  mutationFn: (todo: NewTodo) => api.post('/api/todos', todo),
  onMutate: async (todo) => { /* optimistic insert with a temporary id */ },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
})
// in a component
useMutation({ mutationKey: ['todos', 'add'] })
```

After the cache restores, `resumePausedMutations()` runs queued mutations in order. Send a client-generated id (a UUID) with each create, so a retry after a lost response does not create duplicates; the server treats the id as an idempotency key.

## Conflict rules for offline edits

Two devices can edit the same record while offline. Choose a rule per data type before shipping:

| Rule | How | Fits |
|---|---|---|
| Last write wins | server accepts the latest `updatedAt` | personal settings, single-user notes |
| Version check | client sends the version it edited; server rejects stale writes with 409; UI offers to reload or overwrite | shared records, forms |
| Field-level merge | server merges changed fields only | records where different fields change independently |
| CRDT | Yjs or Automerge documents | collaborative text and lists |

## A custom service worker with injectManifest

Switch the plugin to `strategies: 'injectManifest'` with `srcDir: 'src'` and `filename: 'sw.ts'` when you need code in the worker. The plugin injects the precache list at `self.__WB_MANIFEST`:

```ts
/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { NetworkFirst, CacheFirst, NetworkOnly, type StrategyOptions } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { BackgroundSyncPlugin } from 'workbox-background-sync'

declare const self: ServiceWorkerGlobalScope
type Plugin = NonNullable<StrategyOptions['plugins']>[number]   // Workbox's plugin classes declare hooks that include undefined
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/auth\//] }))
registerRoute(({ url }) => url.pathname.startsWith('/api/projects'), new NetworkFirst({ cacheName: 'api-projects', networkTimeoutSeconds: 4 }))
registerRoute(({ request }) => request.destination === 'image', new CacheFirst({ cacheName: 'images', plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 86400 }) as Plugin] }))
registerRoute(({ url, request }) => url.pathname.startsWith('/api/') && request.method === 'POST',
  new NetworkOnly({ plugins: [new BackgroundSyncPlugin('api-queue', { maxRetentionTime: 24 * 60 }) as Plugin] }), 'POST')

self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') void self.skipWaiting() })
```

The `SKIP_WAITING` message handler is what `updateServiceWorker(true)` sends with the prompt flow; keep it in a custom worker.

## Background sync in the service worker

`BackgroundSyncPlugin` stores failed POST requests in IndexedDB and replays them when the browser fires a `sync` event. The Background Sync API exists only in Chromium browsers; Workbox falls back to replaying when the service worker next starts. Do not combine it with TanStack Query's paused mutations for the same requests, or writes are sent twice: pick one queue.

## Push notifications

Push needs a custom worker, a VAPID key pair, and the user's permission, asked after a user action (never on page load):

```ts
const reg = await navigator.serviceWorker.ready
const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(import.meta.env.VITE_VAPID_PUBLIC_KEY) })
await fetch('/api/push/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) })
```

The worker shows the notification in its `push` handler (`self.registration.showNotification(title, { body, data: { url } })`) and opens the URL in `notificationclick`. On iOS and iPadOS, web push works only for apps added to the home screen.

## Clear caches on sign-out

Runtime caches are shared by every user of the browser profile. On sign-out, delete caches that may hold personal data:

```ts
const names = await caches.keys()
await Promise.all(names.filter((n) => n.startsWith('api-')).map((n) => caches.delete(n)))
```

## Remove a service worker safely

A service worker survives deploys until it is replaced. To remove one (a broken release, or dropping the PWA), deploy a worker that unregisters itself: vite-plugin-pwa's `selfDestroying: true` generates it. Keep it deployed for weeks, since users come back at different times. Never simply delete `sw.js`: browsers keep the installed worker while the file returns 404 errors.

## Storage quota and eviction

Browsers give each origin a share of disk and may evict non-persistent storage under pressure. Call `navigator.storage.persist()` after the user shows intent (for example, enables offline mode), check `navigator.storage.estimate()` before downloading large data, and handle `QuotaExceededError` when writing: tell the user and drop the oldest cached data first.
