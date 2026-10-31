---
title: React concurrency patterns
author: MOZGII, Inc.
lang: en
---

# React concurrency patterns

Recipes that combine Suspense, Transitions, deferred values and Activity in real screens. Sources: react.dev reference pages for `Suspense`, `use`, `useTransition`, `startTransition`, `useDeferredValue` and `Activity`, and the React 19, 19.2 and 19.3 release notes.

## Route-level Suspense boundaries with a router

A router navigation is a Transition in React Router data mode and in TanStack Router, so a route that suspends keeps the previous page on screen while it loads. Put one boundary in the root layout for the first load, and read the router's pending state for the hint:

```tsx
function RootLayout() {
  const navigation = useNavigation()                       // React Router
  return (
    <>
      <TopBar />
      <div aria-busy={navigation.state !== 'idle'} className={navigation.state !== 'idle' ? 'opacity-70' : ''}>
        <Suspense fallback={<PageSkeleton />}><Outlet /></Suspense>
      </div>
    </>
  )
}
```

Use the router's own loaders for route data where possible: they start fetching before the route component renders, while `use()` inside the component starts only when it renders.

## Transition errors and Actions

An async function passed to the `startTransition` from `useTransition` is an Action. If it throws, the error goes to the nearest error boundary of the component that started it. The standalone `startTransition` imported from `react` belongs to no component, so an error there goes to `reportGlobalError` instead, and no boundary sees it. For errors the user can fix (validation, conflicts), catch them inside the Action and put them in state instead:

```tsx
const [error, setError] = useState<string | null>(null)
const [isPending, startTransition] = useTransition()

function onArchive() {
  startTransition(async () => {
    const res = await fetch(`/api/projects/${id}/archive`, { method: 'POST' })
    if (!res.ok) { setError('Could not archive. Try again.'); return }
    startTransition(() => { setError(null); navigate('/projects') })
  })
}
```

`useActionState` and `<form action>` handle the same flow for forms, with the pending flag and the previous state built in (`react-forms`).

## Transition types for animations

React 19.3's `addTransitionType(type)` labels the current Transition, so a `<ViewTransition>` can choose an animation by cause (a forward navigation slides left, a back navigation slides right). Call it inside `startTransition` before the state update. The animation details belong to the `react-animation` skill.

## Independent Transitions in React 19.3

Before React 19.3, Transitions started at about the same time were batched into one render, so a slow one held back a fast one. From 19.3 each Transition renders independently: a fast filter change commits while a slow tab change is still loading. Code that relied on two Transitions committing together must move both updates into one `startTransition` call.

## Prefetch on hover with Activity or a cache warm-up

Two ways to make the next screen instant:

- **Warm the cache**: on `pointerenter` or `focus` of a link, call the data cache's prefetch (`queryClient.prefetchQuery` or the 5.10x `queryClient.query`) so the promise is ready before the click.
- **Pre-render hidden**: render the likely next panel inside `<Activity mode="hidden">`; it renders at low priority, its data starts loading, and switching to `"visible"` shows it at once.

Pre-rendering costs CPU and memory; keep it for one or two likely targets.

## Suspense with TanStack Query

`useSuspenseQuery` suspends until data exists and never returns `undefined` data, so the component has no loading branch. Errors throw to the error boundary; use `QueryErrorResetBoundary` (or `useQueryErrorResetBoundary`) with `react-error-boundary` so the retry button refetches:

```tsx
<QueryErrorResetBoundary>
  {({ reset }) => (
    <ErrorBoundary onReset={reset} FallbackComponent={ErrorPanel}>
      <Suspense fallback={<ListSkeleton />}><ProjectList /></Suspense>
    </ErrorBoundary>
  )}
</QueryErrorResetBoundary>
```

Two `useSuspenseQuery` calls in one component run one after the other (the first suspends before the second starts). Use `useSuspenseQueries` to start them together, or prefetch both in a loader.

## Avoid flashing a fallback for fast loads

A fallback that appears for 50 ms and disappears looks like a flicker. React already throttles how often Suspense boundaries reveal content: the Suspense reveal throttle (`FALLBACK_THROTTLE_MS`, 300 ms in react-dom 19.3.1) holds a reveal until 300 ms after the most recent fallback was shown, so content that resolves in between is committed in one batch. It holds back reveals only (the retry that replaces a fallback with content); it never delays showing a fallback. For a Transition there is no fallback at all, only `isPending`; delay the pending hint with CSS so fast updates show nothing:

```css
[aria-busy='true'] { animation: show-busy 0s 200ms forwards; opacity: 1; }
@keyframes show-busy { to { opacity: 0.6; } }
```

## Testing Suspense and Transitions

In Testing Library, `findBy*` queries wait for suspended content; wrap custom updates in `act` only when not using user-event. To test a Transition's pending UI, make the fetch a promise you resolve by hand, assert the old content and the `aria-busy` state, then resolve and assert the new content.
