---
title: RSC serialization, caching and React Router RSC setup
author: MOZGII, Inc.
lang: en
---

# RSC serialization, caching and React Router RSC setup

Longer notes for React Server Components: exactly what React serializes across the boundary, how to pass data from server to client safely, the Next.js 16 cache model, and how React Router's experimental RSC mode is wired. Sources: react.dev reference pages for `'use client'` and `'use server'`, the Next.js 16 API reference, the React Router "React Server Components" how-to.

## Serializable props for Client Components

React serializes the props a Server Component passes to a Client Component into the RSC payload. These values are supported:

| Type | Notes |
|---|---|
| `string`, `number`, `bigint`, `boolean`, `undefined`, `null` | |
| `symbol` registered with `Symbol.for` | unregistered symbols fail |
| Arrays, plain objects, `Map`, `Set` | contents must be serializable too; object prototypes must be `Object.prototype` or `null` |
| `Date` | arrives as a `Date` |
| `ArrayBuffer`, typed arrays, `FormData` | |
| JSX elements and Server Components | render on the server, arrive as UI |
| `Promise` of a serializable value | read it with `use()` in the Client Component |
| Server Functions | callable from the client |

Not supported: functions that are not Server Functions, class instances (including ORM models and `Error` subclasses), DOM nodes, `WeakMap`, and closures over server state.

## Shape data for the client deliberately

The RSC payload is readable by anyone who loads the page. Select only what the client renders, at the query:

```ts
// returns { id, title, updatedAt } only; never the owner's email or internal flags
const projects = await db.project.findMany({ where: { teamId }, select: { id: true, title: true, updatedAt: true } })
```

React's taint APIs (`experimental_taintObjectReference`, `experimental_taintUniqueValue`) can mark an object or a token as forbidden to pass to the client, so a mistake throws instead of leaking. They are experimental: use them as a second line of defence behind deliberate selects, not instead of them.

## Handing a promise from the server to a Client Component

A Server Component can start a query without awaiting it and pass the promise down. The client reads it with `use()` inside a Suspense boundary, so the server streams the result when it is ready:

```tsx
// server
export default function Page() {
  const commentsPromise = getComments()             // not awaited
  return <Suspense fallback={<p role="status">Loading comments…</p>}><Comments commentsPromise={commentsPromise} /></Suspense>
}
```

```tsx
// client
'use client'
import { use } from 'react'
export function Comments({ commentsPromise }: { commentsPromise: Promise<Comment[]> }) {
  const comments = use(commentsPromise)
  return comments.length === 0 ? <p>No comments yet.</p> : <ul>{comments.map((c) => <li key={c.id}>{c.body}</li>)}</ul>
}
```

A rejected promise throws to the nearest error boundary. Never create the promise inside the Client Component during render: it is recreated on every render and suspends forever.

## Report and abort browser-only rendering in React 19.3

`onBrowserBailout` reports each subtree that `use(browser())` or a `browser` abort left for the browser. Those cases skip `onError` and `onRecoverableError`, so without it they stay invisible in production. It receives an `Error` whose `cause` is your reason, and `errorInfo.componentStack`. Without a `<Suspense>` boundary the server render fails instead, and the normal error callbacks fire.

```tsx
import { browser } from 'react-dom'
import { renderToPipeableStream } from 'react-dom/server'

const stream = renderToPipeableStream(<App />, {
  onShellReady() {
    stream.pipe(res)
    setTimeout(() => stream.abort(browser('The server render timed out.')), 8_000)   // pending boundaries finish in the browser
  },
  onBrowserBailout(error, errorInfo) {
    metrics.count('ssr.browser_bailout', { stack: errorInfo.componentStack })
  },
})
```

With APIs that take an `AbortSignal`, pass the value to the controller: `controller.abort(browser('...'))`. The reason may be a function, such as `() => new Error('...')`, which gives it a stack and runs only on the server; React never writes the reason into the HTML.

## Server Functions: file-level and inline

A Server Function is declared in one of two ways:

- **File level**: `'use server'` as the first line of a module. Every export must be an async function, and each becomes callable from the client.
- **Inline**: `'use server'` as the first line of an async function inside a Server Component. It closes over server values; Next.js encrypts closed-over values sent to the client, but do not close over secrets anyway.

Server Functions are called with `POST` requests. Use them for mutations; for reads, fetch in the Server Component. Frameworks typically process one Server Function call at a time and do not cache the result, so a slow action delays the next and reads through actions are slow.

## Server Functions in forms and progressive enhancement

Passing a Server Function to `<form action>` works before hydration: the browser submits the form, the server runs the action and renders the result. With `useActionState`, the action receives the previous state as its first argument and the `FormData` as its second, and the hook returns `[state, formAction, isPending]`. Use `useFormStatus` in a submit button inside the form to read its pending state.

## Next.js 16 cache model in one page

With `cacheComponents: true`, Next.js prerenders a static shell for each route, and anything dynamic streams in through Suspense. Data is dynamic unless marked `'use cache'`:

| API | Purpose |
|---|---|
| `'use cache'` | caches a function's or component's return value, keyed by its arguments and closed-over values |
| `'use cache: private'` | per-user cache allowed to read cookies and headers; never shared between users |
| `'use cache: remote'` | a platform cache handler instead of memory; costs a network round trip |
| `cacheLife(profile)` | how long: `default`, `seconds`, `minutes`, `hours`, `days`, `weeks`, `max`, or custom profiles in config |
| `cacheTag(tag)` | labels the entry for invalidation; tags are case-sensitive, at most 256 characters |
| `updateTag(tag)` | in a Server Action: expire now, next request waits for fresh data |
| `revalidateTag(tag, 'max')` | stale-while-revalidate; usable in route handlers; calling it without a profile is deprecated |
| `refresh()` | in a Server Action: re-render uncached data on the current page |

When Cache Components are on, Next.js keeps recently visited routes mounted in a hidden React `<Activity>`, so state such as form inputs survives back navigation and effects re-run when the route shows again. Cache Components need the Node.js runtime: remove `export const runtime` from route segments.

## React Router RSC setup

React Router's RSC support is experimental in both framework and data mode. Framework mode in `vite.config.ts`:

```ts
import { defineConfig } from 'vite'
import { unstable_reactRouterRSC as reactRouterRSC } from '@react-router/dev/vite'
import rsc from '@vitejs/plugin-rsc'
export default defineConfig({ plugins: [reactRouterRSC(), rsc()] })
```

- A route exports `ServerComponent` (server) or `default` (client), never both; `ServerErrorBoundary`, `ServerLayout` and `ServerHydrateFallback` mirror the client exports.
- `clientLoader` and `clientAction` still work beside a `ServerComponent`.
- Loaders and actions may return JSX; in an RSC app they are mainly for status codes and redirects.
- The server build's default export is a `(request: Request) => Promise<Response>` handler; adapt it to Node with `createRequestListener` from `@remix-run/node-fetch-server`.
- Start from the templates: `npx create-react-router@latest --template remix-run/react-router-templates/unstable_rsc-framework-mode` (or `unstable_rsc-data-mode-vite`).

## Moving a client app towards Server Components

Move one route at a time, starting from the leaves of the data flow:

1. Make the route a Server Component that fetches its data directly; delete the client fetch and its loading state.
2. Extract each interactive part into a small `'use client'` component that receives plain props.
3. Turn mutations into Server Functions with validation and authorization; revalidate the affected data.
4. Add `server-only` to modules with secrets and run the build.
5. Measure the client bundle before and after: the gain is the libraries that no longer ship.
