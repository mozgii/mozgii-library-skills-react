---
title: React 19 APIs by release
author: MOZGII, Inc.
lang: en
---

# React 19 APIs by release

What each React 19.x release added, so code uses what the installed version has. Check the version with `node -p "require('react/package.json').version"`; the release notes live at `https://github.com/react/react/releases` and `https://react.dev/blog` (the repository moved from `facebook/react` to `react/react` in 2026; old links redirect).

## React 19.0 APIs

React 19.0 (December 2024) is the base of the line and brought most of the new surface:

| API | Package | What it does |
|---|---|---|
| Actions: async functions in `startTransition` | `react` | pending state, errors and optimistic updates handled by React |
| `useActionState(action, initial)` | `react` | state, wrapped action and pending flag for a form or button |
| `useOptimistic(state, update)` | `react` | show a value at once while an Action runs |
| `useFormStatus()` | `react-dom` | pending state and data of the parent `<form>` |
| `<form action={fn}>`, `formAction` | `react-dom` | call a function on submit; uncontrolled fields reset after success |
| `requestFormReset(form)` | `react-dom` | reset a form from code |
| `use(promise)`, `use(context)` | `react` | read a promise (suspends) or a context, conditionally allowed |
| `ref` as a prop | `react` | function components take `ref` without `forwardRef` |
| ref cleanup functions | `react` | a ref callback may return a cleanup |
| `<Context value>` as provider | `react` | replaces `<Context.Provider>` |
| `<title>`, `<meta>`, `<link>` hoisting | `react-dom` | rendered anywhere, placed in `<head>` |
| `<link rel="stylesheet" precedence>` | `react-dom` | stylesheets ordered and deduplicated |
| `preload`, `preinit`, `preconnect`, `prefetchDNS` | `react-dom` | resource hints from components |
| `createRoot(el, { onCaughtError, onUncaughtError, onRecoverableError })` | `react-dom/client` | root-level error reporting |
| `useDeferredValue(value, initialValue)` | `react` | initial value for the first render |

Removed in 19.0: `propTypes` and `defaultProps` on function components (use default parameters), string refs, legacy context, `ReactDOM.render` and `hydrate` (use `createRoot` and `hydrateRoot`), `react-test-renderer/shallow`. `act` moved from `react-dom/test-utils` to `react`.

## React 19.1 APIs

React 19.1 (2025) added Owner Stacks in development (`captureOwnerStack()`), which show which component rendered the one that failed, and made Suspense more consistent across client, server and hydration. It added no everyday client API.

## React 19.2 APIs

React 19.2 (October 2025) added three APIs used in client code:

| API | What it does |
|---|---|
| `<Activity mode="visible" \| "hidden">` | hides a subtree while keeping its state and DOM; effects are cleaned up while hidden and recreated when shown |
| `useEffectEvent(fn)` | a function an effect calls that always sees the latest props and state, without being a dependency |
| Performance tracks | React's own tracks (Scheduler, Components) in the Chrome DevTools Performance panel |

It also added `cacheSignal` for Server Components and partial pre-rendering for server rendering, while `eslint-plugin-react-hooks` 7 (the current major) ships the React Compiler rules in its `recommended` preset.

## React 19.3 APIs

React 19.3 (September 2026) made View Transitions and Fragment refs stable and added `browser`, Trusted Types support and direct Context rendering from Server Components. The current patch is 19.3.1 (October 2026), a security release:

| API | Package | What it does |
|---|---|---|
| `<ViewTransition>` with `enter`, `exit`, `update`, `share`, `default` props | `react` | animates elements with the browser View Transition API for updates inside a Transition |
| `addTransitionType(type)` | `react` | labels a Transition so `<ViewTransition>` can pick an animation per cause |
| `<Fragment ref>` and `FragmentInstance` | `react` | focus, events, observers and measurement over a Fragment's children |
| `browser(reason?)` | `react-dom` | `use(browser())` leaves the nearest Suspense fallback in the server HTML and renders the subtree in the browser; also an abort reason for a streaming render |
| `onBrowserBailout` | `react-dom/server`, `react-dom/static` | reports each subtree deferred to the browser; those skip `onError` |
| `<Context value>` in a Server Component | `react` | render a Context imported from a `'use client'` module without a wrapper provider |

Behaviour changes in 19.3: Transitions render independently instead of being batched into one render; Strict Mode double-invokes effects during hydration and after Fast Refresh edits too; Trusted Types values reach the DOM without string coercion; `useDeferredValue` no longer sticks on an old value; resize events are batched to the next frame; a development warning catches a conditional `use()` that unblocked a component; owner stacks stop at 10 frames; new `onFullscreenChange` and `onFullscreenError` events.

Forms and `<Activity>` in 19.3: `onReset` fires when React resets a form after an Action, `submit` events carry `submitter`, and form status no longer resets when component state updates. A hidden `<Activity>` hides portal contents, keeps its errors away from the visible UI, stops hoisting its `<title>`, and `useSyncExternalStore` catches store changes made while hidden.

Server Components in 19.3: `<Activity>` is supported in server output, and `Error.cause` and `AggregateError.errors` reach the client. Patched release lines and advisories: `react-security`.

## APIs to stop using in new React code

Older React APIs that still work but have a better replacement on React 19:

| Old | New |
|---|---|
| `forwardRef` | `ref` as a prop |
| `<Ctx.Provider value>` | `<Ctx value>` |
| `useContext(Ctx)` | `use(Ctx)` (same behaviour, allowed in conditions) |
| `defaultProps` on functions | default parameters |
| class components | function components and hooks; an error boundary is the one class you may still write, or use `react-error-boundary` |
| `useMemo` / `useCallback` / `memo` for speed | the React Compiler (`react-performance`) |
| `useEffect` + `useState` for fetching | a query cache or a router loader (`react-data-fetching`) |
| React Router `viewTransition` props | React `<ViewTransition>` (`react-animation`) |
