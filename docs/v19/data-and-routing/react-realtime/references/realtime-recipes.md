---
title: Realtime recipes for React
author: MOZGII, Inc.
lang: en
---

# Realtime recipes for React

Complete code for the realtime cases beyond a simple Server-Sent Events feed: a reconnecting WebSocket client with heartbeats and channels, presence, one connection shared across tabs, SSE with custom headers, authentication, and testing. Sources: the WHATWG HTML standard (Server-Sent Events, BroadcastChannel), RFC 6455 (WebSocket), MDN, and the Playwright documentation for `routeWebSocket`.

## Reconnecting WebSocket client with heartbeats and channels

A client that owns one WebSocket, reconnects with backoff and jitter, pings to detect dead connections, re-subscribes to channels after reconnecting, and lets React read its status through `useSyncExternalStore`:

```ts
type Status = 'connecting' | 'open' | 'reconnecting' | 'offline' | 'unauthorized'
type Handler = (data: unknown) => void

export function createSocket(url: string, opts: { pingMs?: number; stableMs?: number } = {}) {
  const pingMs = opts.pingMs ?? 25_000, stableMs = opts.stableMs ?? 10_000
  let ws: WebSocket | null = null, status: Status = 'connecting', attempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined, pingTimer: ReturnType<typeof setInterval> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined, lastSeen = 0, stopped = false
  const statusListeners = new Set<() => void>()
  const channels = new Map<string, Set<Handler>>()          // channel -> handlers

  const setStatus = (s: Status) => { if (s !== status) { status = s; statusListeners.forEach((l) => l()) } }
  const send = (msg: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg)) }

  function open() {
    if (stopped) return
    ws = new WebSocket(url)
    ws.onopen = () => {
      setStatus('open'); lastSeen = Date.now()
      stableTimer = setTimeout(() => { attempt = 0 }, stableMs)            // reset backoff only after a stable period
      for (const ch of channels.keys()) send({ type: 'subscribe', channel: ch })
      pingTimer = setInterval(() => {
        if (Date.now() - lastSeen > pingMs * 2) ws?.close(4000, 'heartbeat timeout')   // half-open: force reconnect
        else send({ type: 'ping' })
      }, pingMs)
    }
    ws.onmessage = (e) => {
      lastSeen = Date.now()
      let msg: { channel?: string; data?: unknown }
      try { msg = JSON.parse(String(e.data)) } catch { return }
      if (msg.channel) channels.get(msg.channel)?.forEach((h) => h(msg.data))
    }
    ws.onclose = (e) => {
      clearInterval(pingTimer); clearTimeout(stableTimer); ws = null
      if (stopped) return
      if (e.code === 4401) { setStatus('unauthorized'); return }          // app-defined: do not retry, ask to sign in
      if (!navigator.onLine) { setStatus('offline'); return }
      setStatus('reconnecting')
      const delay = Math.random() * Math.min(30_000, 500 * 2 ** attempt++)
      retryTimer = setTimeout(open, delay)
    }
  }
  // 4401 means signed out: online and visibility never retry it; stop() and start() again after sign-in
  const reconnectNow = () => { if (status === 'unauthorized') return; clearTimeout(retryTimer); if (!ws) { attempt = 0; open() } }
  const onVisible = () => { if (document.visibilityState === 'visible') reconnectNow() }

  return {
    start() { stopped = false; setStatus('connecting'); open(); addEventListener('online', reconnectNow); document.addEventListener('visibilitychange', onVisible) },
    stop() { stopped = true; clearTimeout(retryTimer); clearInterval(pingTimer); ws?.close(1000); removeEventListener('online', reconnectNow); document.removeEventListener('visibilitychange', onVisible) },
    subscribe(channel: string, handler: Handler) {
      let set = channels.get(channel)
      if (!set) { set = new Set(); channels.set(channel, set); send({ type: 'subscribe', channel }) }
      set.add(handler)
      return () => { set!.delete(handler); if (set!.size === 0) { channels.delete(channel); send({ type: 'unsubscribe', channel }) } }
    },
    send,
    onStatus(l: () => void) { statusListeners.add(l); return () => statusListeners.delete(l) },
    getStatus: () => status,
  }
}
```

A hook that subscribes a component to one channel, with cleanup that survives Strict Mode's double mount:

```tsx
export function useChannel(socket: ReturnType<typeof createSocket>, channel: string, onMessage: (data: unknown) => void) {
  const handler = useEffectEvent(onMessage)
  useEffect(() => socket.subscribe(channel, (d) => handler(d)), [socket, channel])
}
```

## Presence with heartbeats and expiry

Presence state is a map that expires entries; render it from an external store so only the avatars re-render:

```ts
type Peer = { id: string; name: string; colour: string; cursor?: { x: number; y: number }; seen: number }
export function createPresence(socket: ReturnType<typeof createSocket>, room: string, me: Omit<Peer, 'seen'>) {
  const peers = new Map<string, Peer>()
  let snapshot: Peer[] = []
  const listeners = new Set<() => void>()
  const publish = () => { snapshot = [...peers.values()]; listeners.forEach((l) => l()) }
  const unsub = socket.subscribe(`presence:${room}`, (d) => {
    const p = d as Peer
    if (p.id === me.id) return
    peers.set(p.id, { ...p, seen: Date.now() }); publish()
  })
  const beat = setInterval(() => {
    socket.send({ type: 'presence', room, peer: me })
    const cutoff = Date.now() - 30_000
    let changed = false
    for (const [id, p] of peers) if (p.seen < cutoff) { peers.delete(id); changed = true }
    if (changed) publish()
  }, 10_000)
  return {
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l) },
    getSnapshot: () => snapshot,                     // stable array between changes: required by useSyncExternalStore
    dispose: () => { clearInterval(beat); unsub() },
  }
}
```

Throttle cursor updates (`requestAnimationFrame` plus a 50 ms minimum gap) before sending them, and render remote cursors with CSS transforms, not layout properties.

## Share one connection across tabs

Each tab opening its own socket multiplies server load and, for SSE over HTTP/1.1, hits the six-connection limit. Elect one leader tab with the Web Locks API and relay messages with `BroadcastChannel`:

```ts
const bus = new BroadcastChannel('realtime')
navigator.locks.request('realtime-leader', () => new Promise<void>(() => {
  // this tab holds the lock until it closes: it owns the connection
  const source = new EventSource('/api/events', { withCredentials: true })
  source.onmessage = (e) => { bus.postMessage(e.data); handle(e.data) }
}))
bus.onmessage = (e) => handle(e.data)              // follower tabs receive relayed events
```

When the leader tab closes, the lock is released and another tab acquires it and connects. A `SharedWorker` is an alternative where supported.

## Server-Sent Events with custom headers

`EventSource` cannot set headers; it sends cookies only. When the API needs an `Authorization` header (a different origin with bearer tokens), read the stream with `fetch` and parse the SSE format yourself:

```ts
export async function streamEvents(url: string, token: string, onEvent: (ev: { id?: string; event?: string; data: string }) => void, signal: AbortSignal, lastId?: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream', ...(lastId ? { 'Last-Event-ID': lastId } : {}) }, signal })
  if (!res.ok || !res.body) throw new Error(`SSE failed: HTTP ${res.status}`)
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let sep: number
    while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const block = buffer.slice(0, sep); buffer = buffer.slice(sep).replace(/^\r?\n\r?\n/, '')
      const ev: { id?: string; event?: string; data: string } = { data: '' }
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(':')) continue                       // comment / heartbeat
        const [field, ...rest] = line.split(':'); const v = rest.join(':').replace(/^ /, '')
        if (field === 'data') ev.data += (ev.data ? '\n' : '') + v
        else if (field === 'id') ev.id = v
        else if (field === 'event') ev.event = v
      }
      if (ev.data) onEvent(ev)
    }
  }
}
```

You now own reconnection: wrap the call in the same backoff loop and pass the last seen id.

## Authenticating realtime connections

- Same-site app: rely on the session cookie (`SameSite=Lax` or `Strict`, `HttpOnly`); check the `Origin` header on the WebSocket upgrade to block cross-site WebSocket hijacking.
- Cross-site API: fetch a short-lived, single-use ticket over HTTPS (`POST /api/realtime-ticket`), then send it as the first WebSocket message; the server closes the socket if the first message is not a valid ticket within a few seconds.
- Never put a long-lived access token in the URL: URLs end up in logs and browser history.
- When the session expires, the server closes with an application code (for example 4401); the client stops retrying, ignores the `online` and visibility triggers while its status is `unauthorized`, and asks the user to sign in. After sign-in, `stop()` and `start()` open a fresh socket.

## Rendering high-frequency updates

For data that changes many times a second (prices, progress, cursors), keep the latest values in an external store and let each row subscribe to its own key with `useSyncExternalStore`, so one update re-renders one row. Coalesce updates to one notification per animation frame. Charts and canvases should read the store in their own animation loop instead of through React state.

## Testing realtime code with Playwright

Playwright's `page.routeWebSocket(url, handler)` intercepts WebSocket connections, so a test can play the server: send messages, close with a code, and assert the UI. For SSE, `page.route` can fulfil `/api/events` with a `text/event-stream` body. Unit-test the client module with a fake `WebSocket` class injected in place of the global, and fake timers for the backoff and heartbeat.
