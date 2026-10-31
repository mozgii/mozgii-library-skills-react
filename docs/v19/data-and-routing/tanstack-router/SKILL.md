---
name: tanstack-router
description: Routes a React app with TanStack Router 1.x - the Vite plugin and file-based routes, the Register declaration that types every link, search params validated with Zod 4 or Valibot, path params, loaders with loaderDeps and stale-while-revalidate caching, router context with a TanStack Query client, beforeLoad guards, pending and error components, code splitting and preloading. Use when starting a type-safe React SPA, choosing between TanStack Router and React Router, adding typed search params, wiring TanStack Query into loaders, or fixing route type errors and a stale routeTree.gen.ts.
metadata:
  tags:
  - react
  - tanstack-router
  - routing
  - type-safety
  - search-params
  - loaders
  - file-based-routing
---

# TanStack Router for React

TanStack Router is a client-first router whose route tree is fully typed: links, params and search params are checked by TypeScript, and search params are parsed and validated JSON rather than strings. This skill covers `@tanstack/react-router` 1.170 with `@tanstack/router-plugin` 1.168 on Vite 8. The package itself ships detailed agent skills in `node_modules/@tanstack/react-router/skills/` and `node_modules/@tanstack/router-core/skills/` (MIT); read the matching one for deep questions, since it follows the installed version.

## Step 0: read the installed TanStack Router

TanStack Router releases often; read the version and the bundled skills index:

```bash
node -p "require('@tanstack/react-router/package.json').version"
ls node_modules/@tanstack/router-core/skills/router-core/      # data-loading, search-params, navigation, ...
```

## When to pick TanStack Router over React Router

TanStack Router and React Router are both mature; pick between them by what the app stresses:

| Need | Lean towards | Why the other loses |
|---|---|---|
| Typed links, params and search params checked at compile time | TanStack Router | React Router types loader data, but a link to a missing route still compiles |
| Rich search-param state (filters as objects, arrays, numbers) | TanStack Router | React Router hands you strings to parse and validate yourself |
| Server rendering and server actions as one framework | React Router framework mode or TanStack Start | a client router alone ships empty HTML |
| Existing React Router code, HTML-form-style actions, `useFetcher` | React Router (`react-router-data-mode`) | TanStack Router has no actions; mutations go through TanStack Query |
| Largest community and examples | React Router | fewer tutorials and answers exist for TanStack Router |

Inside TanStack Router, choose who caches route data once: with TanStack Query in the app, the loader only warms the query cache and `defaultPreloadStaleTime: 0` hands freshness to the queries; without it, the router's own cache with a per-route `staleTime` is enough. Running both caches with their own freshness rules loads data twice.

## Install with the Vite plugin

The router plugin generates `src/routeTree.gen.ts` from files in `src/routes/` and splits route code automatically. It must come before the React plugin:

```bash
npm i @tanstack/react-router
npm i -D @tanstack/router-plugin @tanstack/react-router-devtools
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
})
```

`create-vite` also offers a TanStack Router starter (`npm create vite@latest`, then React, then the TanStack Router option).

## Create the router and register its type

The `Register` declaration connects the generated route tree to every `Link`, `useNavigate` and `useSearch` in the app. Without it, links compile but are not checked:

```tsx
// src/main.tsx
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { queryClient } from './shared/lib/query-client'

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',          // preload on hover or focus of a link
  defaultPreloadStaleTime: 0,        // let TanStack Query decide freshness
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />)
```

## File-based routes

Each file in `src/routes/` is a route; the file name is the path. `$` marks a param, `_` prefixes pathless layouts, `index` is the index route, and `__root.tsx` is the root:

```
src/routes/
├── __root.tsx                    root layout, router context type
├── index.tsx                     /
├── _app.tsx                      pathless layout (auth guard, shell)
├── _app/projects.index.tsx       /projects
├── _app/projects.$projectId.tsx  /projects/:projectId
└── login.tsx                     /login
```

```tsx
// src/routes/__root.tsx
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => <Outlet />,
  notFoundComponent: () => <p>Page not found</p>,
})
```

The plugin writes the path string inside `createFileRoute('/…')`; never edit it by hand. Rename the file instead and let the plugin regenerate.

## Search params validated with a schema

Search params are typed state. Validate them on the route with a Standard Schema library; with Zod 4, pass the schema directly and use `.catch()` so a bad URL falls back instead of throwing:

```tsx
// src/routes/_app/projects.index.tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'

const search = z.object({
  q: z.string().default(''),
  status: z.enum(['active', 'archived']).default('active').catch('active'),
  page: z.number().int().min(1).default(1).catch(1),
})

export const Route = createFileRoute('/_app/projects/')({
  validateSearch: search,
  component: Projects,
})

function Projects() {
  const { q, status, page } = Route.useSearch()             // fully inferred; do not annotate
  const navigate = Route.useNavigate()
  return (
    <>
      <input value={q} onChange={(e) => navigate({ search: (s) => ({ ...s, q: e.target.value, page: 1 }), replace: true })} />
      <Link to="." search={(s) => ({ ...s, page: page + 1 })}>Next page</Link>
    </>
  )
}
```

- With Zod 3, use `zodValidator()` and `fallback()` from `@tanstack/zod-adapter`; Zod 3's `.catch()` through the adapter loses the types.
- Keep search state minimal; defaults are omitted from the URL only if you add `stripSearchParams` middleware. `retainSearchParams` is its opposite: it keeps chosen params across navigations, such as a workspace filter.
- Child routes inherit search params only from a parent that declares `validateSearch`.
- Search params are serialized to the URL, so pass an ISO string rather than a `Date` object.

## Loaders, loaderDeps and caching

A route `loader` runs before the route renders. Its results are cached stale-while-revalidate, keyed by path and `loaderDeps`; with TanStack Query, let the query cache own freshness and make the loader warm it:

```tsx
// src/routes/_app/projects.$projectId.tsx
export const Route = createFileRoute('/_app/projects/$projectId')({
  loader: ({ context, params }) => context.queryClient.query(projectQueries.detail(params.projectId)),
  pendingComponent: () => <Skeleton lines={6} />,
  errorComponent: ({ error, reset }) => <ErrorState message={error.message} onRetry={reset} />,
  component: ProjectPage,
})

function ProjectPage() {
  const { projectId } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectQueries.detail(projectId))
  return <h1>{project.name}</h1>
}
```

- `projectQueries.detail(id)` is a `queryOptions({ queryKey: ['projects', 'detail', id], queryFn })` object shared by the loader and the component, so both read one cache entry.
- Loaders do not see search params unless declared: `loaderDeps: ({ search: { page } }) => ({ page })`, then `loader: ({ deps }) => …`. Return only what the loader uses; returning the whole `search` object reloads on every unrelated param.
- Without TanStack Query, set `staleTime` on the route (default 0: reload in the background on every match).
- `queryClient.query` is the TanStack Query 5.10x method; older 5.x code uses `ensureQueryData` (`react-data-fetching`).
- `notFound()` thrown in a loader renders the nearest `notFoundComponent`.

## Guards with beforeLoad

`beforeLoad` runs before the loader, parent first, and can redirect or add to the context of child routes. A pathless layout route guards a whole section:

```tsx
// src/routes/_app.tsx
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const user = await session.currentUser()
    if (!user) throw redirect({ to: '/login', search: { next: location.href } })
    return { user }                                  // children read context.user, typed
  },
  component: () => <AppShell><Outlet /></AppShell>,
})
```

A client guard only hides screens; the API must still authorize each request.

## Navigation and preloading

Navigation APIs are typed against the route tree: `to` must be a real path and `params` and `search` must match it.

```tsx
<Link to="/projects/$projectId" params={{ projectId: p.id }} preload="intent">{p.name}</Link>
const navigate = useNavigate()
await navigate({ to: '/projects/$projectId', params: { projectId: id } })
```

- Inside a route component, `Route.useParams()`, `Route.useSearch()` and `Route.useNavigate()` are narrowed to that route. In shared components use `getRouteApi('/path')` or `useSearch({ from: '/path' })`.
- `useBlocker({ shouldBlockFn: () => dirty, withResolver: true })` guards unsaved changes.

## Code splitting

With `autoCodeSplitting: true` the plugin moves each route's component, pending and error components into separate chunks and keeps the loader in the main chunk, so data starts loading before the component code arrives. Manual splitting uses `.lazy.tsx` files with `createLazyFileRoute`; prefer the automatic mode.

## Worked example: a typed list route with every state

A worked example of one file route: search params validated with fallbacks, a loader keyed by the params it uses, a pending component, an error component that retries through the router, an empty state, and typed links that only change the search:

```tsx
// src/routes/_app/invoices.index.tsx
import { createFileRoute, Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { invoiceQueries, PAGE_SIZE } from '@/features/invoices/api'

const search = z.object({
  status: z.enum(['open', 'paid']).default('open').catch('open'),
  page: z.number().int().min(1).default(1).catch(1),
})

export const Route = createFileRoute('/_app/invoices/')({
  validateSearch: search,
  loaderDeps: ({ search: { status, page } }) => ({ status, page }),
  loader: ({ context, deps }) => context.queryClient.query(invoiceQueries.list(deps)),
  pendingComponent: () => <div role="status" aria-label="Loading invoices"><TableSkeleton rows={8} /></div>,
  errorComponent: InvoicesError,
  component: Invoices,
})

function InvoicesError({ error }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <div role="alert">
      <p>Invoices could not be loaded. {error.message}</p>
      <button type="button" onClick={() => void router.invalidate()}>Try again</button>
    </div>
  )
}

function Invoices() {
  const { status, page } = Route.useSearch()
  const { data: invoices } = useSuspenseQuery(invoiceQueries.list({ status, page }))
  return (
    <section aria-labelledby="invoices-title">
      <h1 id="invoices-title">Invoices</h1>
      <nav aria-label="Invoice status">
        <Link to="." search={(s) => ({ ...s, status: 'open', page: 1 })} activeProps={{ 'aria-current': 'page' }}>Open</Link>{' '}
        <Link to="." search={(s) => ({ ...s, status: 'paid', page: 1 })} activeProps={{ 'aria-current': 'page' }}>Paid</Link>
      </nav>
      {invoices.length === 0
        ? <EmptyState title={status === 'open' ? 'No open invoices' : 'No paid invoices yet'} />
        : <InvoiceTable rows={invoices} />}
      <Link to="." search={(s) => ({ ...s, page: page + 1 })} disabled={invoices.length < PAGE_SIZE}>Next page</Link>
    </section>
  )
}
```

- `router.invalidate()` re-runs the loaders and clears the route's error, so Try again fetches again instead of showing the cached failure.
- A URL such as `?status=bogus&page=-3` renders the open invoices on page 1, because `.catch()` replaces bad values.

## Verify TanStack Router

Routing is proven when the generated tree is current, the types check, and a memory-history test renders a route from a hostile URL. Run:

```bash
npx vite build                                  # runs the router plugin, regenerating src/routeTree.gen.ts
git diff --exit-code src/routeTree.gen.ts       # CI: fails when someone committed a stale tree
npx tsc -b                                      # links, params and search checked against the tree
npx vitest run src/routes
```

```tsx
test('bad search params fall back to defaults', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createRouter({ routeTree, context: { queryClient }, history: createMemoryHistory({ initialEntries: ['/invoices?status=bogus&page=-3'] }) })
  render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)   // MSW serves /api; mock the _app guard's session
  expect(await screen.findByRole('heading', { name: 'Invoices' })).toBeInTheDocument()
  expect(router.state.location.search).toMatchObject({ status: 'open', page: 1 })
})
```

- In the browser, TanStack Router Devtools show each match, its loader state and the parsed search object.

## Pre-merge checklist for TanStack Router

Check each point before merging routing changes.

1. Router plugin listed before the React plugin; `routeTree.gen.ts` generated and committed or regenerated in CI.
2. `Register` declared; no `as` casts on params, search or loader data.
3. Every route with search params has `validateSearch` with defaults and `.catch()` fallbacks.
4. Loaders warm TanStack Query, components read with `useSuspenseQuery`; or route `staleTime` set on purpose.
5. Search params that a loader needs declared in `loaderDeps`.
6. Guards in `beforeLoad` on pathless layouts; the API checks again.
7. `pendingComponent`, `errorComponent` and `notFoundComponent` defined where the default is not good enough.
8. `npx tsc -b` and `vite build` both pass after any route rename.

## Gotchas and anti-patterns in TanStack Router

Each entry gives the symptom you see, its cause and the fix.

1. **Links accept any string.** Cause: missing `Register` declaration. Fix: declare `interface Register { router: typeof router }`.
2. **Route path does not match after moving a file.** Cause: the path string in `createFileRoute` was edited by hand or the generator did not run. Fix: rename the file, run the dev server or build to regenerate.
3. **Search param types become `unknown`.** Cause: Zod 3 `.catch()` through `zodValidator()`. Fix: `fallback()` from the adapter, or Zod 4 passed directly.
4. **Loader ignores filter changes.** Cause: search params not declared in `loaderDeps`. Fix: return the params the loader uses from `loaderDeps` and read them from `deps`.
5. **Data loads twice.** Cause: the router's own cache and TanStack Query both decide freshness. Fix: `defaultPreloadStaleTime: 0` and let queries own `staleTime`.
6. **Type checking gets slow in big apps.** Cause: wide `from`-less hooks resolve against every route. Fix: use `Route.useSearch()` or `from`, as the bundled `type-safety` skill describes.
7. **`Invalid hook call` from `beforeLoad` or a loader.** Cause: these run outside React, so `useAuth()` cannot work there. Fix: pass auth through router context, and render the auth provider above `<RouterProvider>`.
8. **Try again in an error component shows the same error.** Cause: the error is cached on the match. Fix: `router.invalidate()` (and the query error reset when queries throw in components).
9. **Anti-pattern: editing `routeTree.gen.ts` by hand.** Symptom: changes vanish on the next build, or types disagree with routes. Cause: the file is generated. Fix: change the route files and let the plugin regenerate it.
10. **Anti-pattern: annotating `Route.useSearch()` results with your own types.** Symptom: a renamed param still compiles where it is read. Cause: the annotation replaced the inferred type. Fix: let inference flow from `validateSearch`.

## See also

- `react-router-data-mode` (the alternative), `react-data-fetching` (query options shared with loaders).
- `react-auth-flows`: sign-in and session handling behind `beforeLoad` guards.
- `react-server-components`: server rendering, which TanStack Start or React Router framework mode add.
