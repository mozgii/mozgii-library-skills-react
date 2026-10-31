---
name: react-router-data-mode
description: Routes a client-rendered React app with React Router 8 data mode - createBrowserRouter, nested layouts and tabs as child routes, lazy routes, loaders and actions, errors as data with status, shouldRevalidate, fetchers for in-place edits, pending UI, useBlocker, middleware and router context for auth guards, a shared TanStack Query cache, memory-router tests, and hash or memory routers for desktop shells. Use when adding React Router to a Vite app, upgrading from react-router-dom or v7, writing loaders or actions, fixing extra revalidation, blank pages on reload, or lost context in loaders.
metadata:
  tags:
  - react
  - react-router
  - routing
  - loaders
  - actions
  - fetchers
  - middleware
  - data-mode
---

# React Router data mode

React Router has three modes: declarative (`<BrowserRouter>` and `<Routes>`), data (`createBrowserRouter` with loaders and actions) and framework (the Vite plugin with route modules and server rendering). This skill covers data mode in a client-rendered app: the router loads data before a route renders, handles form submissions, and revalidates after changes, all in the browser. React Router's own agent skill covers framework mode in depth; `create-react-router` 8.1+ can install it.

## Choose declarative, data or framework mode

Choosing a React Router mode decides who loads data and where the HTML comes from. Pick once per app:

| The app | Mode | Why the other modes lose |
|---|---|---|
| A client-rendered app that loads data per screen (dashboards, tools, desktop shells) | data mode: `createBrowserRouter` or `createHashRouter` with loaders and actions | declarative mode starts requests only after components mount; framework mode needs a server or a build step for HTML |
| An existing app with `<BrowserRouter>` and no loaders | declarative mode, moved route by route to data mode | rewriting every screen at once stalls feature work |
| Public pages that need SEO, server rendering, streaming or Server Components | framework mode (`react-server-components`) | a client-only app ships empty HTML until JavaScript runs |
| Typed search params and links checked at compile time matter most | consider TanStack Router (`tanstack-router`) | React Router's data mode types loaders, not every link and search param |

## Step 0: read the installed React Router

React Router 8 changed packages and defaults, and most tutorials still show v6 code. Check the version first:

```bash
node -p "require('react-router/package.json').version"          # 8.5.1 when this was written
grep -rn "react-router-dom" src package.json                     # must be empty on v8
```

React Router 8 (June 2026) needs React 19.2.7+, Vite 7+ and Node 22.22+, ships ESM only, removed the `react-router-dom` package, and made middleware always on. Check API questions against the installed types (`node_modules/react-router/dist`) and the changelog from your version forward. The package also ships its documentation for the installed version in `node_modules/react-router/docs/` (`start/`, `how-to/`, `explanation/`, `upgrading/`); each page starts with a `[MODES: ...]` marker, so read only pages that list your mode.

## Create the router once at module scope

The router object holds navigation state; create it once, outside any component, and render it with `RouterProvider` from `react-router/dom`:

```tsx
// src/app/router.tsx
import { createBrowserRouter } from 'react-router'
import { routes } from './routes'
export const router = createBrowserRouter(routes)

// src/main.tsx
import { RouterProvider } from 'react-router/dom'
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />)
```

| Router | Use it for |
|---|---|
| `createBrowserRouter` | web apps on a host with an SPA fallback to `index.html` |
| `createHashRouter` | hosts without a fallback, `file://` pages, desktop shells (Electron, Tauri) with a custom protocol: the document path never changes, so reloads on deep routes work |
| `createMemoryRouter` | tests, embedded previews, widgets inside another app |

Keep the route array in its own module (`routes.tsx`) so tests build fresh memory routers from it.

## Route tree with layouts, tabs and lazy routes

The route tree mirrors the screen's layout: a layout route renders shared chrome and an `<Outlet />`, and its children fill the outlet. Tabs are child routes, so the active tab survives reload and Back works:

```tsx
// src/app/routes.tsx
import { redirect, type RouteObject } from 'react-router'
import { RootLayout, RouteError } from './layout'
import { projectLoader, ProjectLayout, projectShouldRevalidate } from '@/features/projects/project.route'

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: RootLayout,
    ErrorBoundary: RouteError,
    HydrateFallback: () => null,
    children: [
      { index: true, loader: () => redirect('/projects') },
      { path: 'projects', lazy: { Component: async () => (await import('@/features/projects/ProjectList')).ProjectList } },
      {
        id: 'project',
        path: 'projects/:projectId',
        loader: projectLoader,
        shouldRevalidate: projectShouldRevalidate,
        Component: ProjectLayout,
        children: [
          { index: true, loader: () => redirect('overview') },
          { path: 'overview', lazy: { Component: async () => (await import('@/features/projects/Overview')).Overview } },
          { path: 'files/:fileId?', lazy: { Component: async () => (await import('@/features/projects/Files')).Files } },
          { path: 'settings', lazy: { Component: async () => (await import('@/features/projects/Settings')).Settings } },
        ],
      },
      { path: '*', Component: () => <p>Page not found</p> },
    ],
  },
]
```

- The object form of `lazy` loads each key (`Component`, `loader`, `action`) on demand. Keep layouts and their loaders eager so the shell never waits for a chunk.
- A side panel or peek view is a search param (`?peek=<id>`) read in the layout, not a second router.
- `HydrateFallback` renders while the first navigation's loaders run; without it React Router warns and the page is blank.

## Loaders and errors as data

A loader runs before its route renders and returns the route's data. Throw `data(message, { status })` for expected failures so the route's `ErrorBoundary` can show them, and let unexpected errors propagate:

```tsx
// src/features/projects/project.route.tsx
import { data, Outlet, useLoaderData, useNavigation, type LoaderFunctionArgs, type ShouldRevalidateFunction } from 'react-router'
import { http, HttpError } from '@/shared/lib/http'
import type { Project } from './types'

export async function projectLoader({ params, request }: LoaderFunctionArgs) {
  try {
    return { project: await http<Project>(`/api/projects/${params.projectId}`, { signal: request.signal }) }
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) throw data('Project not found', { status: 404 })
    throw e
  }
}

export function ProjectLayout() {
  const { project } = useLoaderData<typeof projectLoader>()
  const navigation = useNavigation()
  return (
    <main aria-busy={navigation.state !== 'idle'}>
      <title>{project.name}</title>
      <h1>{project.name}</h1>
      <Outlet />
    </main>
  )
}
```

```tsx
// src/app/layout.tsx
import { isRouteErrorResponse, useRouteError } from 'react-router'

export function RouteError() {
  const error = useRouteError()
  if (isRouteErrorResponse(error)) return <ErrorState title={`${error.status}`} message={String(error.data)} />
  return <ErrorState title="Something went wrong" message={error instanceof Error ? error.message : 'Unknown error'} />
}
```

- `http` and `HttpError` stand for the app's own fetch wrapper: it calls `fetch`, throws `new HttpError(res.status, await res.text())` when `!res.ok`, and returns the parsed JSON otherwise. Plain `fetch` resolves on 404 and 500, so without such a wrapper the error branch never runs. `Project` is the feature's own type in `src/features/projects/types.ts`: `export type Project = { id: string; name: string; archived: boolean }`.
- Pass `request.signal` to `fetch`: a navigation away aborts the loader's requests.
- A child reads a parent's data with `useRouteLoaderData('project')` instead of loading it again.
- Read search params in a loader with `new URL(request.url).searchParams`.

## Share the cache with TanStack Query

Loaders alone have no cache between navigations and no background refresh. With TanStack Query, the loader warms the query cache and the component reads it, so each piece of data is fetched once:

```tsx
export async function projectLoader({ params }: LoaderFunctionArgs) {
  await queryClient.query(projectQueries.detail(params.projectId!))     // TanStack Query 5.10x; older 5.x: ensureQueryData
  return null
}
export function ProjectLayout() {
  const { projectId } = useParams()
  const { data: project } = useSuspenseQuery(projectQueries.detail(projectId!))
  return <h1>{project.name}</h1>
}
```

`projectQueries.detail(id)` is a `queryOptions({ queryKey: ['projects', 'detail', id], queryFn })` object defined once per feature, so the loader and the component use the same key. After a mutation, invalidate the query; the component re-renders from the cache without a router revalidation. Details: `react-data-fetching`.

## Control revalidation with shouldRevalidate

After every navigation and every action, React Router re-runs the loaders of all matched routes by default. A layout loader that only depends on its path param should skip tab and search-param changes:

```ts
export const projectShouldRevalidate: ShouldRevalidateFunction = ({ currentUrl, nextUrl, formMethod, defaultShouldRevalidate }) =>
  formMethod !== undefined || currentUrl.href === nextUrl.href || currentUrl.pathname.split('/')[2] !== nextUrl.pathname.split('/')[2]
    ? defaultShouldRevalidate
    : false
```

- Keep revalidation after actions (`formMethod` set) unless you are sure the action cannot change this loader's data.
- To revalidate from outside (a WebSocket event), call `useRevalidator().revalidate()`. The URL does not change, so the `href` test above lets it through.

## Actions and fetchers for changes

An action handles a submission to its route. A `<Form>` or `useSubmit` navigates to the action; a fetcher calls an action or loader without navigating, which suits in-place edits (rename, toggle, like):

```tsx
import { useFetcher, type ActionFunctionArgs } from 'react-router'
import { http } from '@/shared/lib/http'

export async function renameAction({ request, params }: ActionFunctionArgs) {
  const { name } = (await request.json()) as { name: string }
  if (!name.trim()) return { error: 'Name is required' }
  await http(`/api/projects/${params.projectId}`, { method: 'PATCH', body: JSON.stringify({ name }) })
  return { ok: true }
}

export function RenameField({ name }: { name: string }) {
  const fetcher = useFetcher<typeof renameAction>()
  const shown = (fetcher.json as { name?: string } | undefined)?.name ?? name     // optimistic value while pending
  return (
    <>
      <input defaultValue={shown} aria-invalid={!!fetcher.data?.error}
        onBlur={(e) => { if (e.currentTarget.value !== name) void fetcher.submit({ name: e.currentTarget.value }, { method: 'post', encType: 'application/json' }) }} />
      {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
    </>
  )
}
```

- Return validation errors from the action (`{ error }`) instead of throwing; throwing goes to the error boundary.
- `encType: 'application/json'` sends a JSON body; without it the action reads `await request.formData()`.
- Client-side validation is a convenience; the server validates again.

## Pending UI and unsaved changes

Pending UI tells the user something is happening without flashing spinners for fast responses:

- Global: `useNavigation().state !== 'idle'` drives a top progress bar; show it only after about 150 ms.
- Per control: `fetcher.state` (`'submitting'`, `'loading'`) disables or labels that control only.
- Links: `<NavLink>` exposes `isPending` for the link being navigated to.
- Unsaved changes: `const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)`, then render a confirm dialog when `blocker.state === 'blocked'` and call `blocker.proceed()` or `blocker.reset()`.
- `<ScrollRestoration />` in the root layout restores scroll on Back.

## Middleware and router context for guards

Middleware runs before loaders and actions on each navigation and can redirect or put values into the router context. It is always on in React Router 8, and loaders read context with `context.get(key)`:

```ts
import { createContext, redirect, RouterContextProvider, type MiddlewareFunction } from 'react-router'

export const userContext = createContext<User | null>(null)

export const requireUser: MiddlewareFunction = async ({ request, context }, next) => {
  const user = await session.currentUser()
  if (!user) throw redirect(`/login?next=${encodeURIComponent(new URL(request.url).pathname)}`)
  context.set(userContext, user)
  return next()
}

// on the protected layout route: { path: 'app', middleware: [requireUser], loader: ({ context }) => ({ user: context.get(userContext) }), ... }
export const router = createBrowserRouter(routes, { getContext: () => new RouterContextProvider() })
```

- Middleware runs whenever any matched loader runs, even when a parent's `shouldRevalidate` skipped the parent loader. Keep it cheap; fetch data in loaders.
- A client-side guard hides screens; the API must still check every request.

## View transitions between routes

React Router 8.5 deprecated its own view transition APIs (`viewTransition` props, `useViewTransitionState`) in favour of React's `<ViewTransition>`, stable in React 19.3; they will be removed in v9. Wrap the outlet of a persistent layout:

```tsx
import { ViewTransition } from 'react'
export function RootLayout() {
  return <ViewTransition><Outlet /></ViewTransition>
}
```

Do not set `useTransitions={false}` on the router, because `<ViewTransition>` animates only updates inside a transition. Animation details: `react-animation`.

## Worked example: a searchable list route with in-place archive

A worked example of one screen in data mode: a GET `<Form>` puts the search in the URL so the loader re-runs, the screen shows a busy state for its own navigation, an empty state names the next action, and each row archives in place through a fetcher with an optimistic label and an inline error. Loader failures go to the route's `ErrorBoundary`:

```tsx
// src/features/projects/ProjectList.tsx  ({ path: 'projects', loader: projectListLoader, Component: ProjectList })
import { Form, Link, useFetcher, useLoaderData, useNavigation, type LoaderFunctionArgs } from 'react-router'
import { http } from '@/shared/lib/http'
import type { Project } from './types'

export async function projectListLoader({ request }: LoaderFunctionArgs) {
  const q = new URL(request.url).searchParams.get('q') ?? ''
  return { q, projects: await http<Project[]>(`/api/projects?${new URLSearchParams({ q })}`, { signal: request.signal }) }
}

export function ProjectList() {
  const { q, projects } = useLoaderData<typeof projectListLoader>()
  const navigation = useNavigation()
  const searching = navigation.state === 'loading' && navigation.location.pathname === '/projects'
  return (
    <section aria-labelledby="projects-title" aria-busy={searching}>
      <h1 id="projects-title">Projects</h1>
      <Form method="get" role="search">
        <label htmlFor="q">Search projects</label> <input id="q" name="q" type="search" defaultValue={q} />
        <button type="submit">Search</button>
      </Form>
      <p role="status">{searching ? 'Searching…' : `${projects.length} projects`}</p>
      {projects.length === 0
        ? <p>{q ? `No projects match “${q}”.` : 'No projects yet.'} <Link to="/projects/new">Create a project</Link></p>
        : <ul>{projects.map((p) => <ProjectRow key={p.id} project={p} />)}</ul>}
    </section>
  )
}

function ProjectRow({ project }: { project: Project }) {
  const fetcher = useFetcher<{ error?: string }>()                 // action: { path: 'projects/:projectId/archive', action: archiveAction }
  const archived = fetcher.formData ? fetcher.formData.get('archived') === 'true' : project.archived
  const id = encodeURIComponent(project.id)
  return (
    <li>
      <Link to={`/projects/${id}/overview`}>{project.name}</Link>
      <fetcher.Form method="post" action={`/projects/${id}/archive`}>
        <input type="hidden" name="archived" value={String(!archived)} />
        <button type="submit" disabled={fetcher.state !== 'idle'}>{archived ? 'Restore' : 'Archive'} {project.name}</button>
      </fetcher.Form>
      {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
    </li>
  )
}
```

After the archive action returns, React Router revalidates `projectListLoader`, so the list reflects the server; the optimistic label covers the round trip.

## Test routes with a memory router

Route tests build a memory router from the exported `routes`, mock the network (MSW) and drive navigation through the router object or user events. Code for settling, error assertions and revalidation counts: [patterns.md](references/patterns.md).

```tsx
const router = createMemoryRouter(routes, { initialEntries: ['/projects/p1/overview'] })
render(<RouterProvider router={router} />)
expect(await screen.findByRole('heading', { name: 'Apollo' })).toBeInTheDocument()
```

## Desktop shells: Electron and Tauri notes

In a desktop shell each window is its own renderer with its own router. Use `createHashRouter` when pages load from a custom protocol or `file://`, so reloads never ask the protocol handler for a route path; open a new window at a route by asking the main process to load `index.html#/projects/p1`. Small single-purpose windows (a progress panel, a quick search) need no router at all. Loaders call the app's IPC client instead of `fetch`; map its error codes to `data(…, { status })` the same way.

## Verify React Router data mode

Routing is proven by memory-router tests of the route tree, a clean import scan, and a reload on a deep link of the production build. Run:

```bash
grep -rn "react-router-dom" src package.json      # must print nothing on v8
npx tsc -b && npx vitest run src/app              # route tests: a 404 path, one action, the revalidation rule
npm run build
npx vite preview --port 4173 --strictPort & PREVIEW=$!
sleep 2; curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:4173/projects/p1/overview; kill "$PREVIEW"   # 200 with an SPA fallback
```

- Count loader calls in a test (an MSW handler counter): switching tabs inside a project must not call the project loader again.
- Throw a 404 from a loader in a test and assert the route `ErrorBoundary` text with `findByRole`.
- On the real host, reload a deep route; a 404 there means the host lacks the SPA fallback (`react-build-and-deploy`).

## Pre-merge checklist for React Router data mode

Check each point before merging routing changes.

1. Imports from `react-router` and `RouterProvider` from `react-router/dom`; no `react-router-dom`.
2. Router created once at module scope; `routes` exported separately for tests.
3. Browser router with an SPA fallback on the host, or a hash router where there is none.
4. Layouts eager, leaf screens lazy; `HydrateFallback` on the root.
5. Loaders pass `request.signal`, throw `data(…, { status })` for expected failures, and every layout has an `ErrorBoundary`.
6. `shouldRevalidate` on layout loaders that do not depend on child params or search.
7. In-place edits use fetchers; validation errors are returned, not thrown.
8. Guards in middleware, data in loaders; the API checks auth again.
9. Route tests cover a 404 path, one action and the revalidation rule.

## Gotchas and anti-patterns in React Router data mode

Each entry gives the symptom you see, its cause and the fix.

1. **`Cannot find module 'react-router-dom'`.** Cause: v8 removed the package. Fix: import from `react-router`; `RouterProvider` and `HydratedRouter` from `react-router/dom`.
2. **Reload on a deep route shows the host's 404.** Cause: the host has no SPA fallback. Fix: rewrite all paths to `index.html`, or use `createHashRouter`.
3. **Every tab click refetches the layout.** Cause: default revalidation. Fix: `shouldRevalidate` on the layout.
4. **`context.user` is undefined in a loader.** Cause: code from v6 or v7 treats `context` as a plain object; in v8 it is a `RouterContextProvider`. Fix: `createContext()` keys with `context.set` and `context.get`.
5. **Blank screen and a "No HydrateFallback" warning on first load.** Cause: the root route has loaders and nothing to render while they run. Fix: add `HydrateFallback` to the root route.
6. **Navigation state resets on every render.** Cause: router created inside a component. Fix: module scope.
7. **An id containing `/` or `#` breaks the URL.** Cause: an unencoded param. Fix: `generatePath` or `href()`, which encode params, or `encodeURIComponent`.
8. **Expensive calls run on every search-param change.** Cause: work placed in middleware. Fix: move it into a loader with `shouldRevalidate`.
9. **A failed lazy import stays failed until reload.** Cause: versions before 8.5.1 cached rejected `lazy` imports. Fix: upgrade; 8.5.1 retries them.
10. **Anti-pattern: `useEffect` fetching inside route components.** Symptom: a spinner after every navigation and a waterfall from parent to child. Cause: requests start after render. Fix: loaders, or loaders that warm TanStack Query.

## See also

- `react-server-components`: framework mode, server rendering and React Server Components.
- `tanstack-router`, `react-data-fetching`, `react-animation` (route transitions), `react-build-and-deploy` (SPA fallback on hosts).
