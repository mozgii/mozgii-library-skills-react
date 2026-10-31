---
title: React Router data mode patterns
author: MOZGII, Inc.
lang: en
---

# React Router data mode patterns

Supporting patterns for React Router 8 data mode: where route code lives, route handles for breadcrumbs, memory-router tests, and batching loader calls with `dataStrategy`.

## Contents

This page, React Router data mode patterns, has these sections.

1. Route modules and file layout
2. Route handles for breadcrumbs and titles
3. Memory-router tests with MSW
4. One request per navigation with dataStrategy
5. Declarative mode to data mode migration

## Route modules and file layout

A route module is one file per screen that exports its loader, action, `shouldRevalidate` and component; the route table only assembles them. A screen is then one file to read or delete:

```
src/
  app/
    routes.tsx        the RouteObject[] array (exported for tests)
    router.tsx        createBrowserRouter(routes, options)
    layout.tsx        RootLayout, RouteError
  features/projects/
    project.route.tsx projectLoader, projectShouldRevalidate, ProjectLayout
    Overview.tsx      lazy tab
    Files.tsx         lazy tab
    rename.action.ts  renameAction
```

- Give routes that others read an explicit `id` (`id: 'project'`); `useRouteLoaderData('project')` depends on it. Never depend on generated ids.
- Lazy keys: `lazy: { Component, loader, action }`, each an async function returning that one export, so a loader can be fetched before the component's chunk.

## Route handles for breadcrumbs and titles

A route `handle` is static data attached to a route; `useMatches()` returns every matched route with its handle and loader data, so the root layout can build breadcrumbs:

```tsx
// on routes: handle: { crumb: (data: { project: Project }) => data.project.name }
import { Link, useMatches } from 'react-router'

export function Breadcrumbs() {
  const crumbs = useMatches()
    .filter((m) => typeof (m.handle as { crumb?: unknown } | undefined)?.crumb === 'function')
    .map((m) => ({ to: m.pathname, label: (m.handle as { crumb: (d: unknown) => string }).crumb(m.loaderData) }))
  return (
    <nav aria-label="Breadcrumb">
      <ol>{crumbs.map((c, i) => <li key={c.to}>{i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}</li>)}</ol>
    </nav>
  )
}
```

For the document title, React 19's `<title>` rendered inside the deepest route component is simpler than a handle.

## Memory-router tests with MSW

Route tests run the real route table against a mocked network. MSW intercepts `fetch`, so loaders run unchanged (`react-testing` has the MSW setup):

```tsx
// src/features/projects/project.route.test.tsx
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { http, HttpResponse } from 'msw'
import { render, screen } from '@testing-library/react'
import { server } from '@/test/server'
import { routes } from '@/app/routes'

test('unknown project shows the 404 message', async () => {
  server.use(http.get('/api/projects/:id', () => HttpResponse.json({ message: 'nope' }, { status: 404 })))
  const router = createMemoryRouter(routes, { initialEntries: ['/projects/missing/overview'] })
  render(<RouterProvider router={router} />)
  expect(await screen.findByText('Project not found')).toBeInTheDocument()
})

test('switching tabs does not reload the project', async () => {
  let calls = 0
  server.use(http.get('/api/projects/:id', () => { calls++; return HttpResponse.json({ id: 'p1', name: 'Apollo' }) }))
  const router = createMemoryRouter(routes, { initialEntries: ['/projects/p1/overview'] })
  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { name: 'Apollo' })
  await router.navigate('/projects/p1/settings')
  await screen.findByRole('heading', { name: /settings/i })
  expect(calls).toBe(1)
})
```

- Build a new router per test from `routes`; a shared router carries state between tests.
- Drive navigation with `router.navigate` for routing logic and with `userEvent` clicks for component behaviour.
- `router.state` exposes `navigation`, `loaderData`, `actionData` and `errors` for direct assertions.

## One request per navigation with dataStrategy

Each matched loader runs on its own, so a three-level route makes three requests. When profiling shows request overhead dominating, `dataStrategy` receives all matches of a navigation and can resolve them from one combined request:

```ts
export const router = createBrowserRouter(routes, {
  async dataStrategy({ matches, request }) {
    const toRun = matches.filter((m) => m.shouldCallHandler())
    if (request.method !== 'GET') {                               // an action runs on its own route, never through the bundle
      return Object.fromEntries(await Promise.all(toRun.map(async (m) => [m.route.id, await m.resolve()] as const)))
    }
    if (toRun.length === 0) return {}
    const bundle = await http<Record<string, unknown>>(`/api/route-bundle?ids=${toRun.map((m) => m.route.id).join(',')}&url=${encodeURIComponent(request.url)}`)
    return Object.fromEntries(toRun.map((m) => [m.route.id, { type: 'data', result: bundle[m.route.id] }]))
  },
})
```

`dataStrategy` also runs for actions, so the recipe hands those to `m.resolve()` and bundles only GET requests. `m.shouldCallHandler()` replaces the deprecated `m.shouldLoad`. Do this only after measuring; the default is simpler and parallel requests over HTTP/2 are cheap. `dataStrategy` is also where to add per-route caching or instrumentation across all loaders.

## Declarative mode to data mode migration

Moving from `<BrowserRouter>` and `<Routes>` to data mode is incremental: wrap the existing tree in a single splat route first, then move routes out one by one.

```tsx
const router = createBrowserRouter([{ path: '*', Component: LegacyApp }])   // LegacyApp renders the old <Routes>
```

Then, per screen: move it to its own route object, move its `useEffect` fetching into a `loader` (or a query warmed by the loader), and its submit handlers into an `action` or fetcher. `useNavigate`, `useParams`, `Link` and `useSearchParams` keep working unchanged.
