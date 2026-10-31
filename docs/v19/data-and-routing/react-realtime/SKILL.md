---
name: react-realtime
description: Adds live data to React apps - choosing Server-Sent Events, WebSocket, polling or a hosted service, one connection per app outside React components, reconnection with exponential backoff and jitter, heartbeats, resyncing after a gap with event ids or sequence numbers, validating every message, writing live updates into the TanStack Query cache with setQueryData or invalidation, presence and typing indicators, sharing one connection across tabs, connection status in the UI, and authentication without tokens in URLs. Use when building notifications, live dashboards, chat, collaborative presence, progress streams or live feeds, when a socket reconnects in a storm, updates arrive out of order or are lost after sleep, components open duplicate connections, or the UI re-renders on every message.
metadata:
  tags:
  - react
  - realtime
  - websocket
  - server-sent-events
  - tanstack-query
  - presence
  - reconnection
---

# React realtime

Realtime features push server changes to the browser as they happen: a notification, a changed row, another user's cursor. The transport is the easy part. The hard parts are keeping exactly one connection, reconnecting politely, not losing or duplicating events across gaps, and updating the UI without re-rendering everything on every message. This skill puts the connection outside React, feeds updates into the query cache, and shows the connection state honestly.

## Step 0: read the installed realtime libraries

Read what the project already uses for data and sockets:

```bash
node -p "['react','@tanstack/react-query','zod','partysocket','react-use-websocket','socket.io-client','ably','pusher-js','@liveblocks/react'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against `react` 19.3.1, `@tanstack/react-query` 5.105.0 and `zod` 4.6.7. The patterns use the browser's own `WebSocket` and `EventSource`; `partysocket` 1.3 is a small reconnecting WebSocket if you prefer not to write the loop yourself.

## Decision table: which realtime transport

| Need | Use | Why the others lose |
|---|---|---|
| Server-to-client only (notifications, feeds, progress, AI token streams) | Server-Sent Events (`EventSource`) | plain HTTP, auto-reconnect with `Last-Event-ID`, works through most proxies; WebSocket is two-way you do not need |
| Two-way, low latency (chat, cursors, games, collaborative editing) | WebSocket | SSE cannot send; polling adds latency and load |
| Updates every 30 s or more, or infrastructure forbids long connections | polling with `refetchInterval` in TanStack Query | a persistent connection costs more than it saves |
| Presence, rooms, history and fan-out at scale without running servers | a hosted service (Ably, Pusher, Liveblocks, PartyKit) | your own socket servers need sticky sessions and a pub/sub backbone |
| Shared document editing | a CRDT library (Yjs) over WebSocket | hand-merging concurrent edits loses data |

SSE over HTTP/1.1 is limited to six connections per origin across all tabs; serve it over HTTP/2 or HTTP/3, or share one connection between tabs.

## One connection per app, outside components

A connection is app state, not component state. Create it in a module (or a provider created once), and let components subscribe. Opening a socket inside a component's effect opens one per mounted component and reconnects on every re-mount:

| Do | Avoid |
|---|---|
| a `RealtimeClient` module that owns the socket and a subscriber list | `new WebSocket()` in `useEffect` of a list item |
| `useSyncExternalStore` for the connection status | `useState` copies of the status in many components |
| subscribe and unsubscribe to channels by name with reference counts | each component sending its own subscribe without cleanup |

Strict Mode mounts effects twice in development: subscriptions must be idempotent and cleaned up.

## Reconnection with backoff and jitter

When a connection drops, every client retries. Without delay and randomness they all reconnect at once and knock the server over again. Reconnect with exponential backoff, full jitter and a cap:

```ts
function backoff(attempt: number, baseMs = 500, capMs = 30_000): number {
  return Math.random() * Math.min(capMs, baseMs * 2 ** attempt)      // full jitter
}
```

- Reset the attempt counter only after the connection has stayed open for a while (say 10 s), so a server that accepts and immediately closes does not cause a tight loop.
- Reconnect immediately on `online` and when the tab becomes visible after being hidden, and skip retries while `navigator.onLine` is false.
- Do not retry close codes that mean "go away" (an authentication failure with a 4xxx application code): ask the user to sign in again.

## Heartbeats detect dead connections

A connection can die silently (a laptop sleeps, a proxy drops it) and the browser may not fire `close` for minutes. Send an application-level ping every 20 to 30 seconds and close the socket yourself if no message arrives within two intervals; the reconnect loop takes over. SSE servers send a comment line (`: ping`) periodically to keep proxies from timing out, but `EventSource` never hands comments to the page; to let the client detect a dead stream, send a named event (`event: ping`) and listen for it.

## Resync after a gap with event ids or sequence numbers

Messages sent while the client was disconnected are lost unless the protocol can replay them. Give every event a monotonically increasing id per stream:

- SSE: the server sets `id:`; on reconnect `EventSource` sends `Last-Event-ID`, and the server replays newer events or answers "too old, refetch".
- WebSocket: the client remembers the last sequence number and sends it when resubscribing.
- If the server cannot replay (or the gap is too old), invalidate the affected queries so TanStack Query refetches the truth.
- Drop events with a sequence number not newer than the last applied one: reconnects can deliver duplicates.

## Validate every realtime message

Messages come from the network: parse and validate them before they touch state, and ignore unknown types so an old client survives a new server:

```ts
import { z } from 'zod'
const ServerEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project.updated'), seq: z.number().int(), project: z.object({ id: z.string(), name: z.string(), status: z.enum(['active', 'archived']) }) }),
  z.object({ type: z.literal('project.deleted'), seq: z.number().int(), id: z.string() }),
  z.object({ type: z.literal('pong') }),
])
type ServerEvent = z.infer<typeof ServerEvent>
```

## Live updates into the TanStack Query cache

The query cache stays the single source of server state; realtime events only update or invalidate it. Two strategies:

| Strategy | Use when | Code |
|---|---|---|
| Patch the cache | the event carries the full new entity and the cache shape is simple | `queryClient.setQueryData(['project', id], project)` and update lists with `setQueriesData` |
| Invalidate | the event says only "something changed", or many queries depend on it | `queryClient.invalidateQueries({ queryKey: ['projects'] })` |

- Patch only queries that exist (`getQueryData` first); creating cache entries for screens nobody opened wastes memory.
- Set `staleTime` high (or `Infinity`) for data that realtime keeps fresh, so focus refetches do not race with events.
- Batch bursts: collect events for one animation frame and apply them together, or invalidate once per burst.

## Presence and typing indicators

Presence (who is here, where their cursor is) is ephemeral state: it should not go through the query cache or the database. Keep it in the realtime client as a map of user id to `{ name, colour, lastSeen, cursor }`, expire entries that have not sent a heartbeat for about 30 s, and throttle cursor broadcasts to 10 to 20 per second. Typing indicators send "typing" at most every 3 s and expire after 5 s without another. For collaborative documents, Yjs awareness does this for you (`react-rich-text-editors`).

## Worked example: a live project list with SSE, resync and status

A realtime client module that reads Server-Sent Events, validates them, patches the TanStack Query cache once per animation frame, reconnects with jittered backoff, detects a dead stream with a heartbeat, resyncs after gaps, and exposes its status to a banner. `EventSource` retries on its own after an error, but with one fixed delay (the browser's default or the server's `retry:` field), so after a server restart every client comes back in the same second. This client closes the stream on error and picks the delay itself:

```ts
// realtime.ts: one instance for the app
import { QueryClient } from '@tanstack/react-query'
import { z } from 'zod'

const Project = z.object({ id: z.string(), name: z.string(), status: z.enum(['active', 'archived']) })
export type Project = z.infer<typeof Project>
const Event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project.updated'), project: Project }),
  z.object({ type: z.literal('project.deleted'), id: z.string() }),
  z.object({ type: z.literal('resync') }),
])
type Ev = z.infer<typeof Event>
export type Status = 'connecting' | 'live' | 'reconnecting' | 'offline'

function patch(list: Project[], e: Ev): Project[] {
  if (e.type === 'resync') return list
  if (e.type === 'project.deleted') return list.filter((p) => p.id !== e.id)
  const i = list.findIndex((p) => p.id === e.project.id)
  return i === -1 ? [...list, e.project] : list.with(i, e.project)
}

function backoff(attempt: number, baseMs = 500, capMs = 30_000): number {
  return Math.random() * Math.min(capMs, baseMs * 2 ** attempt)      // full jitter
}

type Options = { pingMs?: number; stableMs?: number }

export function createRealtime(queryClient: QueryClient, url = '/api/events', { pingMs = 15_000, stableMs = 10_000 }: Options = {}) {
  let status: Status = 'connecting'
  const listeners = new Set<() => void>()
  const setStatus = (s: Status) => { if (s !== status) { status = s; listeners.forEach((l) => l()) } }
  let source: EventSource | null = null
  let attempt = 0, lastSeen = 0, lastEventId = '', stopped = true
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined
  let watchdog: ReturnType<typeof setInterval> | undefined
  let pending: Ev[] = []
  let frame: number | undefined
  let flushTimer: ReturnType<typeof setTimeout> | undefined

  function receive(raw: string) {
    let parsed: Ev
    try { const r = Event.safeParse(JSON.parse(raw)); if (!r.success) return; parsed = r.data } catch { return }
    pending.push(parsed)
    if (frame !== undefined) return
    frame = requestAnimationFrame(flush)                       // a burst becomes one cache write and one commit
    flushTimer = setTimeout(flush, 500)                        // rAF pauses in hidden tabs; the timer flushes there
  }

  function cancelFlush() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    clearTimeout(flushTimer); frame = undefined
  }

  function flush() {
    cancelFlush()
    const batch = pending; pending = []
    if (batch.some((e) => e.type === 'resync')) { void queryClient.invalidateQueries({ queryKey: ['projects'] }); return }
    queryClient.setQueryData<Project[]>(['projects'], (list) => list && batch.reduce(patch, list))  // no list: nobody views it
  }

  function close() {
    source?.close(); source = null                             // close() also stops EventSource's own fixed-delay retry
    clearTimeout(stableTimer); clearInterval(watchdog)
  }

  function scheduleReconnect() {
    close()
    if (stopped) return
    if (!navigator.onLine) { setStatus('offline'); return }   // the online event reconnects
    setStatus('reconnecting')
    clearTimeout(retryTimer)
    retryTimer = setTimeout(connect, backoff(attempt++))       // spread out: no two clients pick the same delay
  }

  function connect() {
    close()
    // a new EventSource does not send Last-Event-ID (only its own retries do), so pass the last id in the URL
    const target = new URL(url, location.href)
    if (lastEventId) target.searchParams.set('lastEventId', lastEventId)
    source = new EventSource(target, { withCredentials: true })  // cookies authenticate; no token in the URL
    source.onopen = () => {
      setStatus('live'); lastSeen = Date.now()
      stableTimer = setTimeout(() => { attempt = 0 }, stableMs)  // reset the backoff only once the stream stays up
      void queryClient.invalidateQueries({ queryKey: ['projects'] })  // catch up after any gap
    }
    source.onmessage = (e) => { lastSeen = Date.now(); if (e.lastEventId) lastEventId = e.lastEventId; receive(e.data) }
    source.addEventListener('ping', () => { lastSeen = Date.now() })   // the server sends `event: ping` every pingMs
    source.onerror = scheduleReconnect
    watchdog = setInterval(() => {                               // a half-open stream after sleep or a proxy drop
      if (status === 'live' && Date.now() - lastSeen > pingMs * 2) scheduleReconnect()
    }, pingMs / 2)                                              // ticks twice per ping: replaced 2 to 2.5 pingMs after silence
  }

  const reconnectNow = () => { if (stopped) return; clearTimeout(retryTimer); attempt = 0; connect() }
  const onOffline = () => { clearTimeout(retryTimer); close(); setStatus('offline') }
  const onVisible = () => { if (document.visibilityState === 'visible' && status !== 'live') reconnectNow() }

  return {
    start() {
      stopped = false; connect()
      addEventListener('online', reconnectNow); addEventListener('offline', onOffline)
      document.addEventListener('visibilitychange', onVisible)
    },
    stop() {
      stopped = true; clearTimeout(retryTimer); close(); cancelFlush(); pending = []
      removeEventListener('online', reconnectNow); removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
    },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
    getStatus: () => status,
  }
}
export type Realtime = ReturnType<typeof createRealtime>
```

The server's side of this contract: an `id:` on every event, replay from the `lastEventId` query parameter (or the `Last-Event-ID` header) when it can, and `event: ping` with an empty `data:` line every 15 seconds. A comment line (`: ping`) keeps proxies from timing out but never reaches the page, so the watchdog cannot see it.

```tsx
// live-projects.tsx
import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Project, Realtime } from './realtime'

export function ConnectionBanner({ realtime }: { realtime: Realtime }) {
  const status = useSyncExternalStore(realtime.subscribe, realtime.getStatus, () => 'connecting' as const)
  if (status === 'live') return null
  const text = status === 'offline' ? 'You are offline. Changes from others will appear when you reconnect.'
    : status === 'reconnecting' ? 'Reconnecting… the list may be out of date.' : 'Connecting…'
  return <p role="status" aria-live="polite" className="banner">{text}</p>
}

export function LiveProjects({ realtime }: { realtime: Realtime }) {
  const q = useQuery({
    queryKey: ['projects'],
    queryFn: async ({ signal }): Promise<Project[]> => {
      const r = await fetch('/api/projects', { signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json()
    },
    staleTime: Infinity,                                    // events keep it fresh
  })
  return (
    <section aria-labelledby="live-title">
      <h2 id="live-title">Projects</h2>
      <ConnectionBanner realtime={realtime} />
      {q.isPending ? <p role="status">Loading projects…</p>
        : q.isError ? <div role="alert">Projects could not be loaded. <button type="button" onClick={() => q.refetch()}>Retry</button></div>
        : q.data.length === 0 ? <p>No projects yet.</p>
        : <ul>{q.data.map((p) => <li key={p.id}>{p.name} <span>({p.status})</span></li>)}</ul>}
    </section>
  )
}
```

Create the client once next to the `QueryClient` (`const realtime = createRealtime(queryClient); realtime.start()`), and pass it down or put it in context. Replay goes through the `lastEventId` parameter; the refetch on every open covers servers that cannot replay. A WebSocket version with backoff, heartbeats, channel subscriptions and presence: [realtime-recipes.md](references/realtime-recipes.md).

## Verify realtime behaviour

- Open two browsers; a change in one appears in the other within a second, without a full refetch (check the network panel).
- DevTools "Offline" for 30 s, then back online: the banner shows offline then disappears, and the list catches up.
- Restart the server: clients reconnect with spread-out delays, not all in the same second (server logs show the reconnects spread over up to 0.5, 1, 2, 4 seconds and more as attempts grow, capped at 30 s). In a unit test with fake timers and a fake `EventSource`, fire `error` on two clients with different `Math.random` values and assert two different reconnect delays.
- Answer `/api/events` with a 500 for a minute: the banner says "Reconnecting…", and the gaps between attempts grow instead of staying at one fixed delay.
- Stop sending `ping` from the server: the stream is closed once two `pingMs` intervals pass without a message, at the next watchdog tick (every `pingMs / 2`), so 30 to 37.5 s after the last message with the default 15 s; the new one opens after the first backoff delay (up to 0.5 s), so 30 to 38 s after the last message. Sleep the laptop for five minutes: on wake the stream is replaced within one tick plus that delay, about 8 s at most. In the fake-timer test, open the stream, send nothing, and assert a new `EventSource` exists after `advance(38_000)` and not after `advance(29_999)`; with `Math.random` stubbed to return 0, it already exists after `advance(37_500)`.
- Burst batching: in the same test, deliver 100 messages before the next animation frame and assert `setQueryData` ran once with all 100 applied.
- Reconnect after missing events: the new request carries `?lastEventId=<last id>`, and the list matches the server.
- Send a malformed and an unknown event type from the server: the client ignores them without errors.
- React DevTools Profiler during a burst of 100 events: one commit per frame, not 100.

## Gotchas and anti-patterns in realtime React

Each gotcha names the symptom, its cause and the fix.

1. **Several sockets open for one user.** Cause: the connection is created in a component effect. Fix: one client per app, created outside React; components subscribe.
2. **All clients reconnect in the same second after a deploy.** Cause: fixed retry delays. Fix: exponential backoff with full jitter and a cap.
3. **Updates are missing after the laptop sleeps.** Cause: no replay and no refetch after reconnect. Fix: event ids or sequence numbers, and invalidate on reconnect.
4. **An old event overwrites newer data.** Cause: out-of-order or duplicate delivery. Fix: compare sequence numbers or `updatedAt` before applying.
5. **The tab freezes during bursts.** Symptom: the Profiler shows one commit per message. Cause: a state update per message. Fix: queue messages and patch the cache once per animation frame, with a timer as the fallback in hidden tabs where `requestAnimationFrame` pauses.
6. **The access token appears in server and proxy logs.** Cause: the token in the WebSocket URL query string. Fix: cookie authentication on the same site, or a short-lived single-use ticket fetched just before connecting.
7. **SSE stops working with more than six tabs open.** Cause: the HTTP/1.1 per-origin connection limit. Fix: HTTP/2, or one connection shared through a `BroadcastChannel` leader tab.
8. **The UI says "live" while nothing arrives.** Cause: a half-open connection without heartbeats. Fix: ping and close after two missed intervals.

## Pre-merge checklist for realtime features

1. The transport fits the need (SSE for server push, WebSocket for two-way, polling for slow data).
2. One connection per app, created outside components; subscriptions are cleaned up.
3. Reconnection uses backoff with jitter, a cap, and online and visibility triggers.
4. Heartbeats detect dead connections; a gap triggers replay or refetch.
5. Every message is validated; unknown types are ignored; stale ones are dropped.
6. Updates flow into the query cache, batched; presence stays out of the cache.
7. The UI shows connecting, reconnecting and offline states; tokens never travel in URLs.

See also: react-data-fetching, react-ai-chat-ui, react-rich-text-editors, react-pwa-and-offline, react-auth-flows.
