---
name: react-pwa-and-offline
description: Turns a React app into a reliable Progressive Web App with vite-plugin-pwa 2 and Workbox 7 - the web app manifest and icons, generateSW or injectManifest, precaching the app shell, runtime caching strategies per request type, the SPA navigation fallback, an update prompt with useRegisterSW instead of silent stale code, the install prompt and iOS install instructions, offline state in the UI, TanStack Query persistence and paused mutations for offline data, storage quota and persistence, and how to remove a broken service worker. Use when making an app installable or usable offline, adding a service worker, users keep seeing an old version after a deploy, the app breaks offline or on deep links, adding an install button, or caching API responses.
metadata:
  tags:
  - react
  - pwa
  - service-worker
  - offline
  - vite-plugin-pwa
  - workbox
  - manifest
  - caching
---

# React PWA and offline

A Progressive Web App adds two files to a web app: a manifest that makes it installable, and a service worker that sits between the app and the network and can answer from a cache. The service worker is powerful and long-lived: a bad caching rule keeps serving old code after every deploy. Build it with a generator, choose a caching strategy per kind of request, tell users when an update is ready, and keep a way to remove it.

## Step 0: read the installed PWA tooling

The plugin's options and Node requirement changed in its 2.0 release, so check versions first:

```bash
node -p "['vite','vite-plugin-pwa','workbox-window','workbox-build','@vite-pwa/assets-generator','@tanstack/react-query','@tanstack/react-query-persist-client'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
node <this-skill>/scripts/check-manifest.mjs dist              # after a build: manifest fields, icons, service worker, links
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

Written against (October 2026): `vite-plugin-pwa` 2.0.0 (needs Node 20.19 or newer; supports Vite 3 to 8; Workbox 7.4.1), `workbox-window` 7.4.1, `@vite-pwa/assets-generator` 2.0.0, `@tanstack/react-query` and its persist packages 5.105.0. vite-plugin-pwa 1.3 added Vite 8 support and the `onNeedReload` callback.

## Decision table: how much PWA the app needs

| Goal | Build | Why more loses |
|---|---|---|
| Installable icon and standalone window only | manifest + a minimal service worker that precaches the shell | runtime caches add staleness risk with no benefit |
| Loads instantly and works on flaky networks | precached app shell + runtime caching for assets and some API reads | full offline writes need conflict handling you may not need |
| Full offline use (field apps, notes) | the above + persisted query cache + queued mutations + conflict rules | |
| Push notifications, background sync | `injectManifest` with your own service worker code | `generateSW` cannot add custom event handlers |

## Decision table: generateSW or injectManifest

| Mode | Pick when | Loses when |
|---|---|---|
| `strategies: 'generateSW'` (default) | precache plus runtime caching rules are all you need | you need push, background sync or custom fetch logic |
| `strategies: 'injectManifest'` | you write `src/sw.ts` with Workbox modules; the plugin injects the precache list | more code to own and test |

## Caching strategies per request type

Each request type gets the strategy that matches how it changes:

| Request | Strategy | Why |
|---|---|---|
| Build assets with content hashes (`/assets/*.js`, `.css`) | precache (or CacheFirst) | a hashed file never changes; a new build has new names |
| `index.html` and navigations | precached shell, revalidated by the update flow | serving a stale shell is fine only if the update prompt replaces it |
| API reads that may be shown stale (lists, profiles) | NetworkFirst with a short timeout, or StaleWhileRevalidate | fresh when online, something when offline |
| Images and fonts from a CDN | CacheFirst with expiration (max entries, max age) | rarely change; cap the cache size |
| Auth endpoints, mutations, payments, anything per-user and sensitive | NetworkOnly (no cache) | caching them leaks data between users or replays actions |

## vite-plugin-pwa configuration for a React SPA

The plugin generates the manifest and the service worker from `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',                       // ask before activating new code; 'autoUpdate' reloads silently
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/', name: 'Acme Projects', short_name: 'Projects', start_url: '/', scope: '/',
        display: 'standalone', theme_color: '#1d4ed8', background_color: '#ffffff',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/auth\//],     // never answer API or auth URLs with the shell
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.startsWith('/api/projects'), handler: 'NetworkFirst',
            options: { cacheName: 'api-projects', networkTimeoutSeconds: 4, expiration: { maxEntries: 50, maxAgeSeconds: 86_400 } } },
          { urlPattern: ({ request }) => request.destination === 'image', handler: 'CacheFirst',
            options: { cacheName: 'images', expiration: { maxEntries: 200, maxAgeSeconds: 30 * 86_400 } } },
        ],
      },
      devOptions: { enabled: false },                // test the service worker on a production build
    }),
  ],
})
```

- Generate icons from one SVG with `@vite-pwa/assets-generator` (or the plugin's `pwaAssets` option).
- Serve `sw.js` and `index.html` with `Cache-Control: no-cache` so browsers check for updates; hashed assets can be cached for a year.
- Cached API responses are stored per URL, not per user: never cache personalized responses unless the cache is cleared on sign-out.

## Clear per-user caches on sign-out

The `api-projects` runtime cache above holds one user's projects, and Cache Storage belongs to the browser profile, not the session: after sign-out, the next person on that browser would see them offline. Name every cache that holds per-user responses with an `api-` prefix, and delete them with `caches.delete` when the user signs out, together with the query cache:

```ts
// src/auth/sign-out.ts
import type { QueryClient } from '@tanstack/react-query'

const PERSONAL_CACHE_PREFIX = 'api-'      // api-projects and any later per-user runtime cache

export async function clearPersonalCaches(): Promise<string[]> {
  if (!('caches' in window)) return []
  const names = (await caches.keys()).filter((name) => name.startsWith(PERSONAL_CACHE_PREFIX))
  await Promise.all(names.map((name) => caches.delete(name)))
  return names
}

export async function signOut(queryClient: QueryClient): Promise<void> {
  try {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
  } finally {                             // clear even when the logout request fails or the device is offline
    queryClient.clear()
    await clearPersonalCaches()
    location.assign('/login')
  }
}
```

- Shell, image and font caches (`images` here, and the precache) stay: they hold nothing personal and keep the login page working offline.
- If the query cache is persisted to IndexedDB, delete that key in the same `finally` (`await del('app-query-cache')` with `idb-keyval`).
- Clear on every way a session ends: the sign-out button, a 401 that ends the session, and a sign-out in another tab.

## The update prompt with useRegisterSW

With `registerType: 'prompt'`, a new service worker waits until the app tells it to take over. Show a prompt so users get the new version without losing work:

```tsx
import { useRegisterSW } from 'virtual:pwa-register/react'

const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
  onRegisteredSW(_url, registration) {
    if (registration) setInterval(() => { void registration.update() }, 60 * 60 * 1000)   // check hourly for long-lived tabs
  },
  onRegisterError(error) { reportError(error) },
})
```

`updateServiceWorker(true)` activates the waiting worker and reloads. Add `"types": ["vite-plugin-pwa/react"]` (or a `/// <reference types="vite-plugin-pwa/react" />`) so TypeScript knows the virtual module.

## The install prompt and iOS installation

Chromium browsers fire `beforeinstallprompt` when the app is installable; save the event, show your own Install button, and call `prompt()` on click. Safari never fires it: on iOS and iPadOS users install with Share, then Add to Home Screen, so show those instructions instead of a button. Hide the button once `appinstalled` fires or when `matchMedia('(display-mode: standalone)')` matches.

## Offline data with TanStack Query persistence

The service worker keeps the app loading; the query cache keeps data available:

- Persist the cache to IndexedDB with `PersistQueryClientProvider` from `@tanstack/react-query-persist-client` and `createAsyncStoragePersister` from `@tanstack/query-async-storage-persister` (with `idb-keyval` as storage). Set `gcTime` at least as long as `maxAge`, and a `buster` string per release.
- Mutations made offline are paused (the default `networkMode: 'online'`); with persisted mutations and `mutationDefaults`, call `queryClient.resumePausedMutations()` after restore, and they run when the connection returns.
- Decide conflict rules for offline writes before building them: last write wins, server versions with rejection, or merge.
- Ask for persistent storage with `navigator.storage.persist()` for apps whose offline data matters; check space with `navigator.storage.estimate()`.

The full persistence setup, a custom service worker with background sync, and push notifications: [offline-data-and-custom-sw.md](references/offline-data-and-custom-sw.md).

## Worked example: update prompt, install button and offline banner

An app-level component that tells users when they are offline, when the app is ready offline, when an update is waiting, and offers installation where the browser allows it:

```tsx
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const subscribeOnline = (cb: () => void) => { addEventListener('online', cb); addEventListener('offline', cb); return () => { removeEventListener('online', cb); removeEventListener('offline', cb) } }
const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
const isStandalone = () => matchMedia('(display-mode: standalone)').matches
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function PwaStatus() {
  const online = useOnline()
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [updating, setUpdating] = useState(false)
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => { if (navigator.onLine) void reg.update() }, 3_600_000) },
    onRegisterError(e) { console.error('Service worker registration failed', e) },
  })

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvent(e as InstallEvent) }
    const onInstalled = () => { setInstalled(true); setInstallEvent(null) }
    addEventListener('beforeinstallprompt', onPrompt)
    addEventListener('appinstalled', onInstalled)
    return () => { removeEventListener('beforeinstallprompt', onPrompt); removeEventListener('appinstalled', onInstalled) }
  }, [])

  async function install() {
    if (!installEvent) return
    await installEvent.prompt()
    const { outcome } = await installEvent.userChoice
    if (outcome === 'accepted') setInstalled(true)
    setInstallEvent(null)                       // the event can be used only once
  }

  return (
    <div className="pwa-status">
      <div role="status">                                 {/* mounted first, so what appears inside it is announced */}
        {!online && <p className="banner banner-warning">You are offline. Changes are saved on this device and sent when you reconnect.</p>}
        {offlineReady && (
          <div className="toast">
            <p>The app is ready to work offline.</p>
            <button type="button" onClick={() => setOfflineReady(false)}>OK</button>
          </div>
        )}
        {needRefresh && (
          <div className="toast">
            <p>A new version is available.</p>
            <button type="button" disabled={updating} onClick={() => { setUpdating(true); void updateServiceWorker(true) }}>
              {updating ? 'Updating…' : 'Reload to update'}
            </button>
            <button type="button" onClick={() => setNeedRefresh(false)}>Later</button>
          </div>
        )}
      </div>
      {!installed && installEvent && <button type="button" onClick={install}>Install app</button>}
      {!installed && !installEvent && isIOS() && (
        <details><summary>Install on iPhone or iPad</summary><p>Tap Share, then “Add to Home Screen”.</p></details>
      )}
    </div>
  )
}
```

The update prompt never reloads by itself, so unsaved form input is safe; "Later" leaves the old version running until the next visit. It is a status message and not an `alertdialog`, because that role promises a dialog that takes focus, and this one must not interrupt.

## Verify the PWA

```bash
npm run build                                            # service workers run on the production build
node <this-skill>/scripts/check-manifest.mjs dist        # exit 1 on missing fields, icons or service worker
npx vite preview --port 4173 --strictPort &              # in the background, or the next line never runs
npx @lhci/cli@0.15.1 collect --url=http://localhost:4173/ && npx @lhci/cli@0.15.1 assert --preset=lighthouse:recommended   # or a Lighthouse run in DevTools
kill %1
```

- DevTools Application: the manifest has no warnings; the service worker is activated; caches contain the shell.
- Offline checkbox in DevTools: reload `/`, then a deep link (`/projects/42`); both render from the shell; API calls show the offline UI.
- Deploy a change: the update prompt appears within an hour or on the next load; "Reload to update" shows the new version.
- Sign in, open the projects list, sign out: the Cache Storage list in DevTools' Application panel shows no `api-projects` (in the console, `(await caches.keys()).filter((n) => n.startsWith('api-'))` prints `[]`), while `images` and the precache remain. Repeat with DevTools Offline on during sign-out: the caches are still deleted.

## Gotchas and anti-patterns in PWAs

Each gotcha names the symptom, its cause and the fix.

1. **Users see the old version for days after a deploy.** Cause: `sw.js` or `index.html` served with long cache headers, or an update flow that never activates the waiting worker. Fix: `no-cache` on both; an update prompt or `autoUpdate`; hourly `registration.update()`.
2. **API calls return the HTML shell.** Cause: `navigateFallback` without a denylist answers every navigation-like request. Fix: `navigateFallbackDenylist` for `/api/` and auth paths.
3. **The page reloads while the user types.** Cause: `registerType: 'autoUpdate'` reloads when a new worker activates. Fix: `'prompt'` for apps with forms.
4. **Another user's data appears offline.** Cause: personalized API responses cached by URL. Fix: NetworkOnly for personal data, or give those caches an `api-` prefix and delete them with `caches.delete` on sign-out.
5. **The install button never appears on iOS.** Cause: Safari has no `beforeinstallprompt`. Fix: show Add to Home Screen instructions on iOS.
6. **Deep links 404 offline.** Cause: no navigation fallback, or the shell not precached. Fix: precache `index.html` and set `navigateFallback`.
7. **A broken service worker cannot be removed.** Cause: no kill switch. Fix: deploy with `selfDestroying: true` (the plugin unregisters itself) or a no-op worker that calls `self.registration.unregister()`.
8. **Offline edits vanish after a reload.** Cause: mutations kept only in memory. Fix: persist paused mutations with `mutationDefaults` and resume them after restore.

## Pre-merge checklist for a PWA

1. The manifest has `id`, names, `start_url`, `scope`, `display`, colours, 192 and 512 icons and a maskable icon.
2. Every request type has a deliberate strategy; auth and mutations are not cached, and personal data is either not cached or kept in an `api-` cache that sign-out deletes with `caches.delete`.
3. `navigateFallback` serves the shell for navigations only; API paths are denied.
4. Updates use a prompt (or a reasoned `autoUpdate`); `sw.js` and `index.html` are served `no-cache`.
5. Offline state, install options and the iOS path are shown in the UI.
6. Offline data uses a persisted query cache with a buster; offline writes have conflict rules.
7. `check-manifest.mjs` passes and offline deep links work on a production build; a kill switch is documented.

See also: react-build-and-deploy, react-data-fetching, react-realtime, react-performance.
