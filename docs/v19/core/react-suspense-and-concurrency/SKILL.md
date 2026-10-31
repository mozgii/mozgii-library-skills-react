---
name: react-suspense-and-concurrency
description: Uses React 19's concurrent features on purpose - reading promises with use() from a stable cache, placing Suspense boundaries so loading states reveal in a sensible order, keeping the old screen visible with startTransition and useTransition instead of flashing a fallback, useDeferredValue for input that drives a slow render, Activity to pre-render or keep hidden UI alive, and pairing every boundary with an error boundary. Use when a page flashes spinners, a fallback replaces content the user was reading, typing lags behind a slow list, use() suspends forever or refetches in a loop, tabs lose their state, or when deciding between a transition, a deferred value and a plain state update.
metadata:
  tags:
  - react
  - suspense
  - concurrency
  - transitions
  - use
  - usedeferredvalue
  - activity
  - streaming
---

# React Suspense and concurrent rendering

Concurrent rendering lets React prepare a new screen without blocking the current one. Three tools decide what the user sees while that happens: a `<Suspense>` boundary shows a fallback for content that is not ready, a Transition keeps the old content visible while the new content renders, and a deferred value lets urgent input update first. Used together they replace most hand-written loading flags. This skill covers client code; Server Components streaming is the `react-server-components` skill.

## Step 0: read the React version for Suspense features

What Suspense and Transitions do depends on the minor version, so read it first:

```bash
node -p "['react','react-dom','@tanstack/react-query','react-router','react-error-boundary'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against `react` 19.3.1. `use` and async Transitions arrived in 19.0, `<Activity>` in 19.2. In 19.3 independent Transitions render separately instead of being batched into one render, and `useDeferredValue` no longer sticks on an old value. `<SuspenseList>` is still experimental: do not use it in production code.

## Decision table: which concurrency tool

Pick by what the user should see while new content is not ready:

| Situation | Use | Why the others lose |
|---|---|---|
| First load of a region with no previous content | `<Suspense fallback>` around it | a Transition has no old content to keep |
| Switching tab, page or filter where old content exists | `startTransition` (or the router's navigation, which is one) | a plain update replaces the screen with the fallback |
| Typing into a field that drives an expensive render | `useDeferredValue(query)` | a Transition needs you to own the setter; debouncing delays even fast renders |
| A button that runs an async mutation | `useTransition` with an async function (Action) | a manual `isLoading` flag forgets the error and race cases |
| Hidden panel that should keep state or load ahead | `<Activity mode="hidden">` | unmounting loses state; CSS hiding keeps effects running |
| Data fetching itself | a cache that returns a stable promise (TanStack Query, the router, a framework) | `use(fetch(...))` in render creates a new promise each render |

## Read a promise with use() from a stable cache

`use(promise)` suspends the component until the promise settles and returns its value; a rejected promise throws to the nearest error boundary. The promise must be the same object across renders, so create it outside render and cache it:

```tsx
import { use } from 'react'

const cache = new Map<string, Promise<User>>()
export function fetchUser(id: string): Promise<User> {
  let p = cache.get(id)
  if (!p) {
    p = fetch(`/api/users/${encodeURIComponent(id)}`).then((r) => {
      if (!r.ok) throw new Error(`User ${id}: HTTP ${r.status}`)
      return r.json() as Promise<User>
    })
    cache.set(id, p)
  }
  return p
}

function UserName({ id }: { id: string }) {
  const user = use(fetchUser(id))       // same promise for the same id, so no loop
  return <span>{user.name}</span>
}
```

- In real apps let a data library own the cache: TanStack Query's `useSuspenseQuery`, a router loader, or a framework passing a promise from the server.
- Unlike hooks, `use` may be called inside `if` and loops; it still must be called during render, not in an event handler.
- `use(Context)` reads a context, also conditionally.

## Place Suspense boundaries where the layout can wait

A `<Suspense>` boundary shows its fallback while any child below it suspends, and reveals all its children together. Boundaries decide the loading sequence:

| Pattern | Result |
|---|---|
| One boundary around the page | nothing shows until the slowest part is ready |
| One boundary per independent region | regions appear as they finish; layout can jump |
| Nested boundaries (shell, then details) | the shell appears first, details fill in; the usual best |
| A boundary per list item | many spinners; usually too fine |

```tsx
<Suspense fallback={<PageSkeleton />}>          {/* outer: header and summary */}
  <ProjectHeader id={id} />
  <Suspense fallback={<TableSkeleton rows={8} />}>   {/* inner: slow table */}
    <ProjectTasks id={id} />
  </Suspense>
</Suspense>
```

- Fallbacks should match the final layout's size (skeletons), so content does not jump when it arrives.
- When a component suspends, React 19 commits the nearest fallback at once and then pre-renders the suspended siblings, so sibling requests still start early.
- React throttles reveals: content that resolves soon after a fallback appeared is committed no sooner than 300 ms after that fallback was shown (`FALLBACK_THROTTLE_MS` in react-dom 19.3.1), so nested boundaries finishing close together appear in one step instead of popping in one by one. A fallback can therefore stay up to 300 ms longer than the data takes; that is by design, not a slow request.
- Every Suspense boundary needs an error boundary at or above it; a rejected promise otherwise unmounts the whole root.

## Keep the old screen with startTransition

An update inside `startTransition` is marked non-urgent: if it causes a component to suspend, React keeps showing the current content instead of the fallback, and `isPending` is true meanwhile. Use it for navigation and tab switches:

```tsx
const [tab, setTab] = useState<'overview' | 'activity'>('overview')
const [isPending, startTransition] = useTransition()

<TabButton selected={tab === 'activity'} onClick={() => startTransition(() => setTab('activity'))}>Activity</TabButton>
<div aria-busy={isPending} style={{ opacity: isPending ? 0.6 : 1 }}>
  <Suspense fallback={<Spinner />}>{tab === 'overview' ? <Overview /> : <ActivityFeed />}</Suspense>
</div>
```

- Already-visible content stays; a boundary that has never shown content still shows its fallback.
- Transition updates can be interrupted by urgent ones (typing), so they must be pure renders.
- Since React 19, the function may be async (an Action): `startTransition(async () => { await save(); startTransition(() => setTab('done')) })`. After an `await`, wrap further state updates in another `startTransition` if they must stay non-urgent.
- Controlled inputs must not be updated in a Transition; the input would lag. Update the input urgently and defer what it drives.

## useDeferredValue for input that drives a slow render

`useDeferredValue(value)` returns the previous value during urgent renders and catches up in a background render. The input re-renders immediately; the expensive child re-renders when React has time, and suspending in that background render keeps the old results visible:

```tsx
const [query, setQuery] = useState('')
const deferredQuery = useDeferredValue(query)
const isStale = query !== deferredQuery

<input value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" />
<div style={{ opacity: isStale ? 0.6 : 1 }}><Results query={deferredQuery} /></div>
```

- The slow child must skip re-rendering when its props do not change: the React Compiler memoizes it automatically; without the compiler wrap it in `memo`.
- `useDeferredValue(value, initialValue)` renders `initialValue` first (for example `''`), then the real value in the background.
- It does not reduce network requests; debounce the request separately if the server must not see every keystroke.

## Activity to keep hidden UI alive or load it ahead

`<Activity mode="hidden">` hides its children with `display: none`, keeps their state and DOM, cleans up their effects, and renders them at low priority. Switching back to `"visible"` restores the UI instantly:

```tsx
<Activity mode={tab === 'editor' ? 'visible' : 'hidden'}><Editor /></Activity>
<Activity mode={tab === 'preview' ? 'visible' : 'hidden'}><Preview /></Activity>
```

- Hidden Activity pre-renders: data a hidden child suspends on starts loading before the user opens it.
- Effects stop while hidden, so a hidden video keeps playing only if it is not tied to an effect; pause media in an effect cleanup.
- Keep only a few large subtrees hidden; each one holds its DOM in memory.
- From React 19.3 portals inside a hidden Activity hide with it, its errors stay away from the visible UI, and `useSyncExternalStore` catches changes made while hidden.

## Worked example: a responsive search page with every state

A search page whose input never lags, whose results keep showing while new ones load, with loading, error, empty and stale states and screen reader announcements:

```tsx
import { Suspense, use, useDeferredValue, useState } from 'react'
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'

type Hit = { id: string; title: string }
const cache = new Map<string, Promise<Hit[]>>()
function search(q: string): Promise<Hit[]> {
  const key = q.trim().toLowerCase()
  let p = cache.get(key)
  if (!p) {
    p = fetch(`/api/search?q=${encodeURIComponent(key)}`).then(async (r) => {
      if (!r.ok) throw new Error(`Search failed (HTTP ${r.status})`)
      return (await r.json()) as Hit[]
    })
    p.catch(() => cache.delete(key))           // let a retry refetch after an error
    cache.set(key, p)
  }
  return p
}

function Results({ query }: { query: string }) {
  if (query.trim() === '') return <p>Type to search projects.</p>
  const hits = use(search(query))
  if (hits.length === 0) return <p role="status">No projects match “{query}”.</p>
  return (
    <>
      <p role="status" className="sr-only">{hits.length} results</p>
      <ul>{hits.map((h) => <li key={h.id}>{h.title}</li>)}</ul>
    </>
  )
}

function SearchError({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert">
      <p>{error instanceof Error ? error.message : 'Search failed.'}</p>
      <button type="button" onClick={resetErrorBoundary}>Try again</button>
    </div>
  )
}

export function SearchPage() {
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const stale = query !== deferred
  return (
    <section aria-labelledby="search-title">
      <h1 id="search-title">Search</h1>
      <label htmlFor="q">Project name</label>
      <input id="q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      <div aria-busy={stale} style={{ opacity: stale ? 0.6 : 1, transition: 'opacity 150ms' }}>
        <ErrorBoundary FallbackComponent={SearchError} resetKeys={[deferred]}>
          <Suspense fallback={<p role="status">Searching…</p>}>
            <Results query={deferred} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </section>
  )
}
```

The first search shows "Searching…"; later searches keep the previous results dimmed until the new ones arrive, because the deferred render suspends in the background. `resetKeys` clears the error when the query changes. More patterns (route-level boundaries, transitions with routers, Action errors): [concurrency-patterns.md](references/concurrency-patterns.md).

## Verify Suspense and transitions

Check the loading behaviour, not only the final screen:

- Throttle the network to "Slow 4G" in DevTools and walk each flow: the old content stays during tab and filter changes; skeletons match the final layout.
- Record a Performance profile while typing into the search field: the input's frames stay under 50 ms while the list renders in a separate low-priority pass in React's Scheduler track.
- In a test, make the fetch reject and assert the error boundary's message and retry button (`findByRole('alert')`).
- Run with Strict Mode on: a `use()` promise created in render shows up as a suspend loop.

## Gotchas and anti-patterns in Suspense and concurrency

Each gotcha names the symptom, its cause and the fix.

1. **The component suspends forever or refetches in a loop.** Cause: `use(fetch(...))` or a promise created during render. Fix: get the promise from a cache keyed by its inputs.
2. **A spinner replaces content the user was reading.** Cause: the update that suspended was urgent. Fix: wrap it in `startTransition` or use the router's navigation, which is a Transition.
3. **The input lags while typing.** Cause: the input's own state is set inside a Transition, or the slow child re-renders on every keystroke. Fix: update the input urgently and pass `useDeferredValue(query)` to a memoized child.
4. **The whole page went blank on one failed request.** Cause: no error boundary above the Suspense boundary. Fix: pair each boundary with an `ErrorBoundary` and a retry.
5. **A retry shows the same error.** Cause: the rejected promise stays in the cache. Fix: delete it on rejection or use a library that does.
6. **Layout jumps when content arrives.** Cause: fallbacks smaller than the content. Fix: skeletons with the final size.
7. **A hidden tab keeps polling.** Cause: work in a `setInterval` outside an effect, or a hidden subtree that is merely CSS-hidden. Fix: `<Activity mode="hidden">` with the polling in an effect.
8. **State updated after an `await` is urgent again.** Cause: updates after the first `await` in an Action leave the Transition. Fix: wrap them in another `startTransition`.
9. **`This library called use() to suspend in a previous render but did not call use() when it finished.`** Cause: `use` sat behind a condition that turned false once the data arrived; React 19.3 warns about it in development. Fix: call `use` on every render of that path with the same settled promise.

## Pre-merge checklist for Suspense and concurrency

1. Every `use(promise)` reads from a cache; no promise is created in render.
2. Every Suspense boundary has an error boundary with a retry above it.
3. Navigation, tab and filter changes run in Transitions; old content stays visible with a pending hint.
4. Input that drives slow renders uses `useDeferredValue`; the input itself is never in a Transition.
5. Fallbacks are skeletons sized like the content; live regions announce results.
6. Hidden panels use `<Activity>` with media paused in effect cleanups.
7. Flows checked on a throttled network and in Strict Mode.

See also: react-data-fetching, react-performance, react-error-handling, react-server-components, react-router-data-mode.
