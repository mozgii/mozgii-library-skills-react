---
name: react-error-handling
description: Handles errors in React apps - where error boundaries catch and where they do not, react-error-boundary 6 with reset and retry, placing boundaries per route and per widget, errors from event handlers and async code, Actions and transitions that reach boundaries, TanStack Query and router error integration, root-level onCaughtError and onUncaughtError reporting, and user-facing error states. Use when a render error blanks the page, when adding an error boundary or error reporting, when a retry button does not recover, or when errors in handlers or promises go unnoticed.
metadata:
  tags:
  - react
  - error-boundary
  - react-error-boundary
  - errors
  - suspense
  - reporting
  - resilience
---

# React error handling

An error thrown while React renders unmounts the whole tree up to the nearest error boundary; with no boundary, the page goes blank. Error handling in React is therefore about placing boundaries so one broken widget does not take down the screen, getting errors from handlers and async code to a place the user sees, and reporting all of them. This skill covers React 19.3 with `react-error-boundary` 6.1.

## Step 0: read the installed React and error packages

Where errors go depends on the React version (root error options arrived in React 19) and on which data and error libraries are installed. Read them from the project root:

```bash
node -p "['react','react-dom','react-error-boundary','@tanstack/react-query','react-router','@sentry/react'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `react` 19.3.1, `react-error-boundary` 6.1.6 (peer range React 18 or 19), `@tanstack/react-query` 5.105.0, `react-router` 8.5.1, `@sentry/react` 11.10.0.

## Choose inline errors, a boundary or a report

Choosing where an error goes depends on whether it was expected and whether the user can act on it. Every error takes one row:

| The failure | Handle it with | Why the alternatives lose |
|---|---|---|
| Expected and fixable by the user (validation, 409 conflict, 4xx) | state shown next to the control | a boundary replaces the form the user needs to fix it |
| Unexpected while rendering or loading data for one area | the nearest error boundary around that widget or route | `try`/`catch` cannot wrap rendering, and per-component checks miss cases |
| Unexpected in an event handler or a promise | `showBoundary(error)`, or work inside the `startTransition` that `useTransition` returns | otherwise it is swallowed and the button just stops working |
| A background refetch failed while good data is on screen | keep the data, add a small "could not refresh" notice | replacing working content with an error punishes the user for a blip |
| Nothing below caught it | a root boundary with a reload action | without it the page goes blank |
| Any of the above | one report from the root options (`onCaughtError`, `onUncaughtError`) | reporting in every boundary sends duplicates and misses errors with no boundary |

## What error boundaries catch

An error boundary catches errors thrown while rendering, in lifecycle methods, and in constructors of the components below it. It does not catch:

| Error source | How to handle it |
|---|---|
| Event handlers (`onClick`) | `try`/`catch` in the handler, show state; or pass it to a boundary with `showBoundary` |
| Async code (`setTimeout`, promise callbacks) | catch and set state; or `showBoundary` |
| Functions passed to the `startTransition` from `useTransition`, or to a form Action | caught: React rethrows them to the nearest boundary |
| Functions passed to the standalone `startTransition` imported from `react` | not caught: it has no component to throw in, so React calls `reportGlobalError` (`window.reportError`); catch inside the function |
| Errors inside the boundary component itself | the next boundary up |
| Server rendering | the framework's error handling |

A Suspense query (`useSuspenseQuery`) or `use(promise)` that rejects throws during render, so a boundary catches it.

## react-error-boundary component

React has no hook API for boundaries; writing one needs a class. The `react-error-boundary` package provides a ready component with reset support:

```bash
npm i react-error-boundary
```

```tsx
import type { ReactNode } from 'react'
import { ErrorBoundary, getErrorMessage } from 'react-error-boundary'

export function WidgetBoundary({ children, name }: { children: ReactNode; name: string }) {
  return (
    <ErrorBoundary
      fallbackRender={({ error, resetErrorBoundary }) => (
        <div role="alert" className="widget-error">
          <p>{name} could not be shown.</p>
          {import.meta.env.DEV && <pre>{getErrorMessage(error)}</pre>}
          <button type="button" onClick={resetErrorBoundary}>Try again</button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  )
}
```

- The raw message shows only in development (`import.meta.env.DEV` in Vite); in production users see what failed and one action, never a message that may hold paths, SQL or tokens.
- No `onError` here: the root's `onCaughtError` already reports every caught error with its `componentStack`, so reporting in the boundary too sends it twice. Use `onError(error, info)` (it gets `info.componentStack`) only in an app without root reporting.
- `fallbackRender` receives `error` and `resetErrorBoundary`; `FallbackComponent` takes a component with the same props; `fallback` takes static JSX.
- `resetKeys={[userId]}` resets the boundary automatically when a key changes, such as navigating to another record.
- `onReset` clears whatever caused the error (a bad cache entry, a store value) before the children render again.
- The type of `error` is `unknown` in version 6; `getErrorMessage(error)` turns anything thrown into a string.

## Where to place error boundaries

Boundaries go at the granularity where a failure should be contained. Three levels cover most apps:

1. **App root**: a last-resort full-page fallback with a reload button, so the user never sees a blank page.
2. **Route or screen**: each route's `ErrorBoundary` (React Router) or `errorComponent` (TanStack Router) keeps the navigation and layout alive when one screen fails.
3. **Independent widget**: a chart, a feed, a third-party embed. If the rest of the screen works without it, wrap it.

Put a boundary around a `<Suspense>` that loads data, so the loading and failed states of one area live together:

```tsx
<WidgetBoundary name="Revenue chart">
  <Suspense fallback={<ChartSkeleton />}>
    <RevenueChart />
  </Suspense>
</WidgetBoundary>
```

## Errors from event handlers and async code

Errors in handlers and promises do not reach boundaries on their own. Most belong in local state next to the control that failed; serious ones can be sent to the nearest boundary with `useErrorBoundary`:

```tsx
import { useErrorBoundary } from 'react-error-boundary'

function ExportButton() {
  const [error, setError] = useState<string | null>(null)
  const { showBoundary } = useErrorBoundary()
  async function handleExport() {
    setError(null)
    try { await exportReport() }
    catch (e) {
      if (e instanceof HttpError && e.status < 500) setError('The report is too large to export.')   // expected: show inline
      else showBoundary(e)                                                                               // unexpected: boundary
    }
  }
  return <>{error && <p role="alert">{error}</p>}<button onClick={handleExport}>Export</button></>
}
```

`HttpError` here is the app's own error class with an HTTP `status`, thrown by its fetch wrapper on a non-2xx response. In React 19, an async function passed to `startTransition` from `useTransition` has its thrown errors delivered to the nearest boundary, which removes the `try`/`showBoundary` boilerplate for unexpected failures.

## Errors in Actions and forms

Form Actions (`<form action>`, `useActionState`) separate expected and unexpected failures by how they leave the function: return validation and business errors as state so they show next to fields; let unexpected errors throw so the boundary shows them. The `react-forms` skill has the full pattern.

## TanStack Query and router errors

TanStack Query and router errors either render inline or throw to an error boundary, depending on the library and its options:

- `useQuery` returns `isError` and `error`; render them in place. Set `throwOnError: true` (or a function such as `(e) => e.status >= 500`) to send them to a boundary instead.
- `useSuspenseQuery` always throws to the boundary. To make Try again refetch, reset the query errors along with the boundary:

```tsx
import { QueryErrorResetBoundary } from '@tanstack/react-query'

<QueryErrorResetBoundary>
  {({ reset }) => (
    <ErrorBoundary onReset={reset} fallbackRender={({ resetErrorBoundary }) => <RetryPanel onRetry={resetErrorBoundary} />}>
      <Suspense fallback={<Spinner />}><Orders /></Suspense>
    </ErrorBoundary>
  )}
</QueryErrorResetBoundary>
```

- React Router: loaders throw `data(message, { status })` for expected failures and the route `ErrorBoundary` reads them with `useRouteError()` and `isRouteErrorResponse()` (`react-router-data-mode`).
- TanStack Router: `errorComponent` receives `error` and `reset`; `notFound()` renders `notFoundComponent` (`tanstack-router`).

## Root error reporting with createRoot options

React 19 reports errors through options on the root, which is the one place to send everything to a monitoring service:

```tsx
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!, {
  onCaughtError: (error, info) => report(error, { level: 'error', componentStack: info.componentStack }),     // caught by a boundary
  onUncaughtError: (error, info) => report(error, { level: 'fatal', componentStack: info.componentStack }),   // no boundary: the app unmounted
  onRecoverableError: (error, info) => report(error, { level: 'warning', componentStack: info.componentStack }), // React recovered by itself
}).render(<App />)
```

Errors outside React (a rejected promise nobody awaited, a script error) need global listeners too:

```ts
window.addEventListener('unhandledrejection', (e) => report(e.reason, { level: 'error', source: 'unhandledrejection' }))
window.addEventListener('error', (e) => report(e.error ?? e.message, { level: 'error', source: 'window.error' }))
```

Monitoring SDKs (Sentry, Datadog, others) ship React helpers that wire these up; never send form values, tokens or other personal data in error context.

## Error states users can act on

An error message says what failed in plain words and what the user can do next. Good fallbacks:

- Name the thing that failed ("Invoices could not be loaded"), not "Something went wrong" alone.
- Offer one action: Try again, Go back, Reload, Contact support with an error id.
- Keep the rest of the screen working; do not replace the whole page for a widget failure.
- Announce the message with `role="alert"` and move focus to it when it replaces the content the user was in.
- In development, show the message and stack; in production, show a reference id the user can quote.

## Worked example: a safe widget with loading, retry and reset

A worked example that puts the pieces together: `SafeWidget` wraps any data widget in a query-aware error boundary and a Suspense fallback, resets when its key changes (a new date range), and shows a fallback that names what failed. Reporting stays in the root options, so the widget does not report twice:

```tsx
// src/shared/ui/SafeWidget.tsx
import { QueryErrorResetBoundary } from '@tanstack/react-query'
import { Suspense, type ReactNode } from 'react'
import { ErrorBoundary, getErrorMessage, type FallbackProps } from 'react-error-boundary'

function WidgetFallback({ error, resetErrorBoundary, name }: FallbackProps & { name: string }) {
  return (
    <div role="alert" className="widget-error">
      <p>{name} could not be shown.</p>
      {import.meta.env.DEV && <pre>{getErrorMessage(error)}</pre>}
      <button type="button" onClick={resetErrorBoundary}>Try again</button>
    </div>
  )
}

type SafeWidgetProps = { name: string; resetKey?: unknown; skeleton: ReactNode; children: ReactNode }

export function SafeWidget({ name, resetKey, skeleton, children }: SafeWidgetProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary onReset={reset} resetKeys={[resetKey]} fallbackRender={(props) => <WidgetFallback {...props} name={name} />}>
          <Suspense fallback={<div aria-busy="true" aria-label={`Loading ${name}`}>{skeleton}</div>}>{children}</Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  )
}
```

```tsx
// a dashboard: one failing chart leaves the others working
<SafeWidget name="Revenue chart" resetKey={range} skeleton={<ChartSkeleton />}>
  <RevenueChart range={range} />          {/* useSuspenseQuery inside; renders its own empty state */}
</SafeWidget>
```

- The raw message shows only in development; production users see what failed and one action, never a stack trace.
- The empty state belongs to the child, which knows what "no data" means for it; the wrapper only handles loading and failure.

## Verify React error handling

Error handling is proven by forcing each failure on purpose and watching where it lands. Check:

```bash
npx vitest run src/shared/ui/SafeWidget.test.tsx
grep -n "onUncaughtError\|onCaughtError" src/main.tsx      # root reporting is wired
grep -n "unhandledrejection" -r src                       # global listener installed
```

```tsx
// src/shared/ui/SafeWidget.test.tsx
test('contains a render error and recovers on retry', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})   // React logs caught errors; keep the output readable
  let fail = true
  function Flaky() { if (fail) throw new Error('boom'); return <p>Chart</p> }
  render(<QueryClientProvider client={new QueryClient()}><SafeWidget name="Revenue chart" skeleton={null}><Flaky /></SafeWidget></QueryClientProvider>)
  expect(screen.getByRole('alert')).toHaveTextContent('Revenue chart could not be shown.')
  fail = false
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
  expect(screen.getByText('Chart')).toBeInTheDocument()
})
```

- React DevTools: select a component and use the error toggle to force its nearest boundary into the fallback; the rest of the screen must keep working.
- On a production build, trigger a test error and confirm it reaches monitoring once, with a component stack and no personal data.

## Pre-merge checklist for React error handling

Check each point before merging error handling.

1. A root boundary with a full-page fallback; nothing can blank the page.
2. Each route has an error component; independent widgets have their own boundaries.
3. Every `<Suspense>` that loads data sits inside a boundary.
4. Handlers and async code catch errors and show them, or forward with `showBoundary`.
5. Try again actually retries: `resetKeys`, `onReset`, and query error reset where queries are involved.
6. `onCaughtError`, `onUncaughtError` and `onRecoverableError` report to monitoring, with no personal data.
7. `unhandledrejection` and `error` listeners installed.
8. Fallback text names what failed and offers one action.

## Gotchas and anti-patterns in React error handling

Each entry gives the symptom you see, its cause and the fix.

1. **A click handler's error does nothing visible.** Cause: boundaries do not catch event handler errors. Fix: catch in the handler, or `showBoundary`, or run the work in the `startTransition` from `useTransition`; the standalone `startTransition` never reaches a boundary.
2. **Try again shows the same error at once.** Cause: the cached error or bad state is still there. Fix: clear it in `onReset`; for TanStack Query use `QueryErrorResetBoundary`'s `reset`.
3. **The whole page is replaced by a widget error.** Cause: only a root boundary. Fix: boundaries per route and per independent widget.
4. **An error boundary component written as a function does not work.** Cause: boundaries need class lifecycle methods. Fix: `react-error-boundary`, or a class with `getDerivedStateFromError` and `componentDidCatch`.
5. **Errors are reported twice.** Cause: both a boundary's `onError` and the root's `onCaughtError` send them. Fix: report in one place, usually the root options.
6. **The boundary stays in its error state after navigating away.** Cause: the boundary sits above the routes and has no reset key. Fix: `resetKeys={[location.pathname]}`, or use the router's per-route error boundaries.
7. **Anti-pattern: `try { return <Widget /> } catch {}` in a component.** Symptom: the catch never runs and the page still blanks. Cause: JSX creates elements; rendering happens later, outside the `try`. Fix: an error boundary.
8. **Anti-pattern: showing `error.stack` or server messages to users in production.** Symptom: internal paths, SQL or tokens appear on screen. Cause: the development fallback shipped. Fix: a plain message and a reference id in production; details go to monitoring.

## See also

- `react-observability`: error tracking, source maps, logs and alerting for production.
- `react-data-fetching`, `react-router-data-mode`, `tanstack-router`, `react-forms` (expected errors as state).
