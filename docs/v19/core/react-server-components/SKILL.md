---
name: react-server-components
description: Builds React Server Components apps correctly - which code runs on the server and which ships to the browser, where to put 'use client' boundaries, Server Functions with 'use server' as public endpoints that validate and authorize, what may cross the boundary, streaming with Suspense, passing promises to Client Components, caching with Next.js 16 Cache Components ('use cache', cacheTag, updateTag, revalidateTag), and React Router 8 RSC mode. Use when building or reviewing a Next.js App Router or React Router RSC app, when the error says functions cannot be passed to Client Components, a secret reaches the client bundle, a Server Action needs validation, a page streams in the wrong order, when one request reads the same data twice (React cache), a component must render only in the browser (use(browser())), or when deciding whether a component should be a Server or a Client Component.
metadata:
  tags:
  - react
  - server-components
  - rsc
  - nextjs
  - react-router
  - server-functions
  - streaming
  - caching
---

# React Server Components

React Server Components (RSC) split one component tree across two environments: Server Components render ahead of time on the server and send no JavaScript to the browser, Client Components render on the server for HTML and then hydrate in the browser. The `'use client'` directive marks where the tree crosses into client code; `'use server'` marks Server Functions the client may call. RSC needs a framework that wires the bundler: Next.js App Router (stable) or React Router 8 in RSC mode (experimental). A plain Vite single-page app has no Server Components.

## Step 0: read the installed RSC framework versions

The framework decides which RSC APIs exist, so read the installed versions before writing code:

```bash
node -p "['react','react-dom','next','react-router','@react-router/dev','@vitejs/plugin-rsc','server-only'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
node <this-skill>/scripts/find-client-boundaries.mjs src     # map every 'use client' and 'use server' module
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

Written against (October 2026): `react` 19.3.1, `next` 16.4.3, `react-router` and `@react-router/dev` 8.5.1. Next.js 16 needs Node 20.9 or newer. A Server Components app must run React `19.3.1`, `19.2.9`, `19.1.10` or `19.0.9` or newer on its line, and `next` 16.4.1 or newer on the 16.4 line, because older releases have open remote code execution advisories (listed in `react-security`). React Router's RSC APIs carry the `unstable_` prefix and may change in minor releases: read its release notes before each upgrade.

## Decision table: Server Component, Client Component or Server Function

Every module in an RSC app is one of these. Default to the Server Component and move code to the client only for the reasons in the middle column:

| Code | Make it a | Because | The others lose because |
|---|---|---|---|
| Reads a database, a file or a secret; renders data | Server Component (default, no directive) | runs only on the server, ships no JS, can `await` | a Client Component would need an API route and a fetch |
| Uses state, effects, refs, event handlers, browser APIs, Context | Client Component (`'use client'`) | hooks and events exist only in the browser | a Server Component throws on `useState` |
| A mutation the UI triggers (save, delete, like) | Server Function (`'use server'`) | a typed call with no hand-written endpoint | a route handler duplicates validation and types |
| A public HTTP API, a webhook, a file download | Route handler (`app/api/*/route.ts`, a resource route) | needs a stable URL and HTTP semantics | Server Functions have generated, unstable URLs |
| A large static library (Markdown, syntax highlighting, date formatting) | Server Component | the library never reaches the bundle | importing it in a Client Component ships it to every user |

## Decision table: which RSC framework

| Situation | Pick | Why |
|---|---|---|
| New server-rendered app, RSC wanted now | Next.js 16 App Router | RSC, streaming, Server Actions and caching are stable there |
| An existing React Router framework-mode app | React Router 8 without RSC; try RSC mode on a branch | RSC mode is `unstable_` and changes in minor releases |
| A React Router app that wants Server Components in loaders only | React Router RSC framework mode, returning elements from loaders | incremental adoption, route by route |
| Client-only app behind a login, no SEO | Vite SPA, no RSC | RSC adds a server to run and secure for little gain |

## The 'use client' boundary

The `'use client'` directive marks a module, and every module it imports, as client code. Place it on the first line, before imports:

```tsx
'use client'                       // first statement of the file; a directive after an import is ignored
import { useState } from 'react'
export function LikeButton({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount)
  return <button type="button" onClick={() => setCount((c) => c + 1)}>Like ({count})</button>
}
```

- Put the boundary as low in the tree as possible: a `'use client'` on a layout turns the whole subtree into client code.
- A Server Component can render a Client Component and pass it props; a Client Component cannot import a Server Component, but it can receive one as `children` or another JSX prop.
- Context is created in a `'use client'` module. A provider with its own state stays a Client Component (`app/providers.tsx`, rendered from the server layout with `{children}` inside). From React 19.3 a Server Component can render that Context directly, as shown next.
- Third-party components that use hooks but lack the directive need a one-line re-export file with `'use client'`.

### Render Context from a Server Component in React 19.3

From React 19.3 a Server Component can import a Context from a `'use client'` module and render it with a value it loaded, so a wrapper whose only job was to forward one prop can go. Server Components still cannot create Context or read it. Below 19.3, keep the small client wrapper.

```tsx
// src/theme-context.ts holds: 'use client'; export const ThemeContext = createContext<Theme>('light')
// src/layout.tsx: a Server Component, no directive
import type { ReactNode } from 'react'
import { ThemeContext, type Theme } from './theme-context'
import { readThemeCookie } from './theme-cookie'

export default async function Layout({ children }: { children: ReactNode }) {
  const theme: Theme = await readThemeCookie()
  return <ThemeContext value={theme}>{children}</ThemeContext>
}
```

## What may cross the server-to-client boundary

Props that leave the server for a Client Component are serialized. Serializable values cross; everything else throws at render time:

| Crosses | Does not cross |
|---|---|
| strings, numbers, booleans, `null`, `undefined`, `bigint` | ordinary functions and event handlers |
| plain objects and arrays of serializable values | class instances (a Prisma model, a `URL`, an `Error` subclass with methods) |
| `Date`, `Map`, `Set`, typed arrays, `FormData` | symbols other than `Symbol.for` ones |
| JSX elements, including Server Components | DOM nodes, streams other than those React supports |
| Promises of serializable values | |
| Server Functions | |

Map database rows to plain objects with only the fields the client needs: everything you pass is visible in the page payload. React deduplicates the payload by object reference, not by value: `<List items={rows} sorted={rows.toSorted(byName)} />` sends the array contents twice for primitive items, so send `rows` once and derive the sorted copy on the client. Details and the full table: [rsc-serialization-and-caching.md](references/rsc-serialization-and-caching.md).

## Server Functions are public endpoints

A Server Function (Server Action in Next.js) is an async function marked `'use server'`, either at the top of a file or as the first line of an async function body. React turns each one into an HTTP endpoint that anyone can call with any arguments, so treat it like an API route:

```ts
'use server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/session'
import { db } from '@/lib/db'

const Rename = z.object({ id: z.uuid(), title: z.string().trim().min(1).max(120) })   // z.uuid(): RFC 9562 ids only; z.guid() for any 8-4-4-4-12 hex
export type ActionResult = { ok: true } | { ok: false; error: string }

export async function renameProject(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const session = await getSession()                                      // 1. authenticate
  if (!session) return { ok: false, error: 'Sign in again.' }
  const parsed = Rename.safeParse(Object.fromEntries(form))               // 2. validate the input
  if (!parsed.success) return { ok: false, error: 'Title must be 1 to 120 characters.' }
  const project = await db.project.findUnique({ where: { id: parsed.data.id } })
  if (project?.ownerId !== session.userId) return { ok: false, error: 'Not found.' }   // 3. authorize this row
  await db.project.update({ where: { id: project.id }, data: { title: parsed.data.title } })
  revalidatePath(`/projects/${project.id}`)
  return { ok: true }
}
```

- Return errors as data the form can show; a thrown error lands in the closest error boundary, with its message hidden in production.
- Never accept a user id, a role or a price from the client; read them from the session and the database.
- Every exported function in a `'use server'` file becomes callable, including helpers you meant to keep private: keep helpers in another file.

## Keep server code out of the client bundle

Mark modules that hold secrets or server-only libraries with the `server-only` package, so importing them from a Client Component fails the build instead of leaking:

```ts
import 'server-only'                              // build error if any client module imports this file
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
```

Environment variables without the framework's public prefix (`NEXT_PUBLIC_` in Next.js, `VITE_` under Vite) are not inlined into client code, but a Client Component that imports a server module can still pull its code in. The `client-only` package is the mirror for browser-only modules.

## Request-scoped reads with React cache

`cache` from `react` memoizes a function for the length of one server request, so a layout, a page and a deep child can each ask for the same row while the database runs once. It works only in Server Components, and React clears it for every request, so nothing leaks between users.

```ts
// src/data/project.ts
import 'server-only'
import { cache } from 'react'
import { db } from '@/lib/db'

export const getProject = cache(async (id: string) =>
  db.project.findUnique({ where: { id }, select: { id: true, title: true, ownerId: true } }),
)
```

- Define the memoized function once, at module scope, and export it. Each `cache(fn)` call makes a separate memo, so wrapping inside a component shares nothing.
- Pass primitives. Arguments are compared by identity, so a fresh `{ id }` object on each call misses.
- Thrown errors are memoized too: the same arguments rethrow the same error for the rest of the request.
- `cacheSignal()` returns an `AbortSignal` that fires when the render's cache lifetime ends; pass it to `fetch` or a query so abandoned work stops. It returns `null` outside rendering and in Client Components.

| Tool | Lifetime | Use it for |
|---|---|---|
| `cache` from `react` | one server request | the same read from several components |
| `'use cache'` in Next.js 16 | across requests, until invalidated | data many users share |
| a client cache (TanStack Query) | the browser session | data the client refetches and mutates |

## Keep request data out of module variables

Module scope on a server is shared by every request in the process, and renders overlap whenever one of them awaits. A `let currentUser` set in a layout can therefore be overwritten by another visitor before a child reads it, and the child renders the wrong person's data. This holds for Server Components and for Client Components during server rendering.

```ts
// Wrong: overlapping requests share this variable
let session: Session | null = null

// Right: one read per request, nothing shared between requests
export const getSession = cache(async () => readSession(await cookies()))
```

Pass request data down as props, or read it through a `cache`-wrapped function. Constants and static assets are fine at module scope, because they never depend on the visitor.

## Browser-only subtrees with use(browser()) in React 19.3

`browser` from `react-dom` is the supported way to skip server rendering for a component that cannot produce useful HTML. Inside a `<Suspense>` boundary, `use(browser())` stops the component on the server and leaves the boundary's fallback in the HTML, then the browser renders it normally with no hydration error. It replaces the `mounted` state set in an effect and the `typeof window` check.

```tsx
'use client'
import { Suspense, use, useState } from 'react'
import { browser } from 'react-dom'

function RecentSearches({ initial }: { initial?: string[] | undefined }) {
  if (initial === undefined) use(browser('Recent searches live in localStorage.'))
  const [items] = useState(() => initial ?? readRecentSearches())
  if (items.length === 0) return <p>No recent searches.</p>
  return <ul>{items.map((q) => <li key={q}>{q}</li>)}</ul>
}

export function SearchPanel({ initial }: { initial?: string[] }) {
  return (
    <Suspense fallback={<p role="status">Loading recent searches</p>}>
      <RecentSearches initial={initial} />
    </Suspense>
  )
}
```

- It needs a `<Suspense>` above it during server rendering; with no boundary the server render fails.
- It works in Client Components only, and only through `use`. Calling `browser()` alone does nothing, and the value is never thrown.
- Like any `use` call it may sit in a condition or after an early return, as above: with `initial` the list renders on the server, without it the fallback does.
- The optional reason is a string or a function. It becomes the `cause` of the error given to `onBrowserBailout` and is never written into the HTML; use a function when building it costs something.
- These bail-outs skip `onError` and `onRecoverableError`. To count them, pass `onBrowserBailout(error, errorInfo)` to the `react-dom/server` API you call. `abort(browser('Render timed out.'))` leaves pending boundaries to the browser: [rsc-serialization-and-caching.md](references/rsc-serialization-and-caching.md).

## Streaming with Suspense in Server Components

A Server Component that awaits data blocks only its nearest `<Suspense>` boundary: the server sends the shell first and streams each boundary's HTML as its data resolves. Put boundaries around independent slow parts, not around the whole page:

```tsx
export default function Dashboard() {
  return (
    <main>
      <h1>Dashboard</h1>
      <Suspense fallback={<StatsSkeleton />}><Stats /></Suspense>        {/* fast query */}
      <Suspense fallback={<FeedSkeleton />}><ActivityFeed /></Suspense>  {/* slow query, streams later */}
    </main>
  )
}
```

- Start independent queries before awaiting them (`const [a, b] = [getA(), getB()]`, then `await` inside children), or each `await` waits for the previous one.
- In Next.js, `loading.tsx` wraps a route segment in a Suspense boundary; `error.tsx` must be a Client Component.
- To start a query on the server and read it in a Client Component, pass the promise as a prop and read it with `use(promise)` inside a `<Suspense>`.
- In Next.js, `after()` from `next/server` runs logging or analytics once the response has finished, so a Server Action does not make the user wait for them.

## Next.js 16 Cache Components and 'use cache'

Next.js 16 makes data dynamic by default and caches only what you mark. Turn on Cache Components with `cacheComponents: true` and `partialPrefetching: true` in `next.config.ts`, then mark a cached function or component with `'use cache'`:

```ts
import { cacheLife, cacheTag } from 'next/cache'
export async function getProjects(teamId: string) {
  'use cache'
  cacheLife('hours')                       // profiles: default, seconds, minutes, hours, days, weeks, max
  cacheTag(`team:${teamId}:projects`)
  return db.project.findMany({ where: { teamId }, select: { id: true, title: true } })
}
```

| After a write, call | Where | Effect |
|---|---|---|
| `updateTag(tag)` | Server Actions only | expires the tag; the next request waits for fresh data (read-your-own-writes) |
| `revalidateTag(tag, 'max')` | Server Actions and route handlers | marks stale; visitors get stale content while it refreshes |
| `revalidatePath(path)` | Server Actions and route handlers | refreshes one path |
| `refresh()` | Server Actions | refreshes uncached data on the current page |

- `cookies()` and `headers()` belong above the cached function; give it what it needs from them as arguments.
- `middleware.ts` is deprecated in Next.js 16 and renamed `proxy.ts` with an exported `proxy` function.
- Dynamic route `params` and `searchParams` are Promises: `const { id } = await params`.

## React Router 8 RSC mode

React Router supports Server Components in framework and data mode through `unstable_reactRouterRSC` and `@vitejs/plugin-rsc` (placed after it in the Vite plugins). In RSC framework mode a route module exports `ServerComponent` instead of `default`, and loaders and actions may return React elements:

```tsx
import type { Route } from './+types/project'
import { RenameForm } from './rename-form'           // a 'use client' module

export async function loader({ params }: Route.LoaderArgs) {
  return { project: await getProject(params.id) }
}
export function ServerComponent({ loaderData }: Route.ServerComponentProps) {
  return <><h1>{loaderData.project.title}</h1><RenameForm id={loaderData.project.id} /></>
}
```

`ServerErrorBoundary`, `ServerLayout` and `ServerHydrateFallback` are the server counterparts of the usual exports. Start from the `unstable_rsc-framework-mode` template rather than converting by hand.

## Worked example: a Next.js project page with streaming, an action and every state

A Server Component page that streams the project list, a Client Component form that calls a validated Server Action with pending and error states, and an error boundary:

```tsx
// app/projects/page.tsx (Server Component)
import { Suspense } from 'react'
import { getSession } from '@/lib/session'
import { getProjects } from '@/lib/projects'
import { RenameForm } from './rename-form'

export default function ProjectsPage() {
  return (
    <main aria-labelledby="projects-title">
      <h1 id="projects-title">Projects</h1>
      <Suspense fallback={<p role="status">Loading projects…</p>}>
        <ProjectList />
      </Suspense>
    </main>
  )
}

async function ProjectList() {
  const session = await getSession()                       // reads cookies: inside the boundary, or Cache Components fails the build
  if (!session) return <p>Please <a href="/login">sign in</a> to see your projects.</p>
  const projects = await getProjects(session.teamId)       // plain objects: { id, title }
  if (projects.length === 0) return <p>No projects yet. Create one to get started.</p>
  return (
    <ul>
      {projects.map((p) => <li key={p.id}><RenameForm id={p.id} title={p.title} /></li>)}
    </ul>
  )
}
```

```tsx
// app/projects/rename-form.tsx
'use client'
import { useActionState, useId } from 'react'
import { renameProject, type ActionResult } from './actions'

export function RenameForm({ id, title }: { id: string; title: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(renameProject, null)
  const inputId = useId()
  const errorId = `${inputId}-error`
  const failed = state?.ok === false
  return (
    <form action={action} aria-busy={pending}>
      <input type="hidden" name="id" value={id} />
      <label htmlFor={inputId}>Title</label>
      <input id={inputId} name="title" defaultValue={title} required maxLength={120}
        aria-invalid={failed} aria-describedby={failed ? errorId : undefined} />
      <button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      <p id={errorId} role="alert">{failed ? state.error : ''}</p>
    </form>
  )
}
```

```tsx
// app/projects/error.tsx (must be a Client Component)
'use client'
export default function ProjectsError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <div role="alert">
      <p>Projects could not be loaded.</p>
      <button type="button" onClick={() => retry()}>Try again</button>  {/* retry re-fetches; reset would not */}
    </div>
  )
}
```

The action is the `renameProject` function from the Server Functions section. In production the `error` prop carries only a `digest`; log the full error on the server and look it up by that digest.

## Verify the RSC boundaries and actions

Prove the boundaries and the actions behave before merging:

```bash
node <this-skill>/scripts/find-client-boundaries.mjs src   # exit 1 when a client module imports server code, directly or through a local module
                                                           # or a 'use server' file exports a non-async value (export const f = async ... passes)
npx next build                                             # fails on server-only imports in client code and on bad serialization
npx next build --debug-prerender                           # Next.js 16: shows why a route could not prerender
```

- Open the page with JavaScript disabled: server-rendered content must still show; only client widgets stop working.
- Call each Server Action with a forged payload (another user's id, an empty title) from a test and assert it refuses.
- In the browser's network panel, check that no secret, internal field or full database row appears in the RSC payload.

## Gotchas and anti-patterns in Server Components

Each gotcha names the symptom, its cause and the fix.

1. **`Functions cannot be passed directly to Client Components`.** Cause: a Server Component passed `onClick` or a callback prop. Fix: move the handler into the Client Component, or pass a Server Function.
2. **The directive has no effect.** Cause: `'use client'` sits after an import or a comment block with code. Fix: make it the first statement of the file.
3. **The whole app became client code and the bundle grew.** Cause: `'use client'` on a layout or a provider file that imports pages. Fix: keep providers in a small client file that renders `{children}`; push boundaries down to the leaves.
4. **A secret appears in the browser bundle.** Cause: a Client Component imports a module that reads it. Fix: `import 'server-only'` in that module and pass only derived values.
5. **"createContext is not a function" in a Server Component.** Cause: Context created on the server. Fix: create it in a `'use client'` module; from React 19.3 a Server Component may then render it with a value.
6. **Hydration mismatch on dates or random ids.** Cause: `new Date()`, `Math.random()` or locale formatting differ between server and browser. Fix: render on the server only, pass the value as a prop, or use `useId`.
7. **A Server Action updates another user's row.** Cause: trusting an id from the form without an ownership check. Fix: authenticate, validate with a schema and authorize the row inside the action.
8. **`updateTag` throws in a route handler.** Cause: `updateTag` works only in Server Actions. Fix: use `revalidateTag(tag, 'max')` there.
9. **A cached function shows one user's data to another.** Cause: reading cookies inside `'use cache'` or caching per-user data without the user in the arguments. Fix: read request data outside and pass it in; keep per-user data uncached.
10. **One visitor sees another visitor's name, with no cache in sight.** Cause: request data kept in a module variable while renders overlap. Fix: pass it as props or read it through a `cache`-wrapped function.
11. **`use(browser())` fails the server render.** Cause: no `<Suspense>` above the component. Fix: wrap it in a boundary with a useful fallback.

## Pre-merge checklist for Server Components

1. Each `'use client'` is the first statement and sits at a leaf, not a layout.
2. Props crossing to the client are plain, minimal and free of secrets.
3. Every Server Function authenticates, validates with a schema, authorizes the row and returns errors as data.
4. Server-only modules import `server-only`; the build passes.
5. Slow data sits behind its own `<Suspense>` with a fallback; empty and error states render.
6. Cached functions take every input as an argument and are invalidated after writes; no mutable module variable holds request data.
7. `find-client-boundaries.mjs` reports no client module importing server code, either itself or through a local module it imports (it follows relative, `@/` and `~/` imports one level; deeper chains are left to `server-only` and the build).

See also: react-suspense-and-concurrency, react-forms, react-security, react-error-handling, react-auth-flows.
