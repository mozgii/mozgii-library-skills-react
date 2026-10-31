---
title: React review smells with examples
author: MOZGII, Inc.
lang: en
---

# React review smells with examples

Patterns a reviewer recognizes in a React diff, each with the snippet that shows it, why it is a problem, and the replacement to suggest. Sources: react.dev ("You Might Not Need an Effect", Rules of React, `useEffect` and `useSyncExternalStore` references), the TanStack Query documentation, WCAG 2.2, and the OWASP Cheat Sheet Series on XSS.

## Derived state copied into useState

Copying a prop into state and syncing it with an effect is the most common React review finding:

```tsx
const [fullName, setFullName] = useState('')
useEffect(() => { setFullName(`${first} ${last}`) }, [first, last])     // smell
const fullName = `${first} ${last}`                                       // suggest: compute during render
```

The effect version renders once with a stale value and then again. To reset state when an id changes, suggest a `key` on the component instead of an effect.

## Effects that respond to events

Logic that should run because the user did something belongs in the event handler, not in an effect watching state:

```tsx
useEffect(() => { if (submitted) { post(form); toast('Sent') } }, [submitted])    // smell: runs again on remount
function onSubmit() { post(form); toast('Sent') }                                  // suggest
```

## Fetching in an effect without cancellation

```tsx
useEffect(() => { fetch(`/api/items/${id}`).then((r) => r.json()).then(setItem) }, [id])   // smell
```

Out-of-order responses show the wrong item, there is no loading or error state, and every mount refetches. Suggest the project's query library (`useQuery({ queryKey: ['item', id], queryFn })`) or a route loader. If an effect must stay, it needs an `AbortController` and an `ignore` flag in the cleanup.

## Object and array dependencies recreated every render

```tsx
const options = { limit: 20, sort }                    // new object each render
useEffect(() => { load(options) }, [options])         // smell: runs every render
useEffect(() => { load({ limit: 20, sort }) }, [sort])  // suggest: depend on primitives
```

The same applies to query keys: `queryKey: ['items', filters]` is fine (keys are hashed), but a function or a class instance in a key is not.

## useSyncExternalStore with a fresh snapshot

```tsx
useSyncExternalStore(store.subscribe, () => ({ ...store.state }))   // smell: new object every call, infinite loop
useSyncExternalStore(store.subscribe, () => store.state)            // suggest: return a cached, immutable snapshot
```

## Context value recreated every render

```tsx
<AuthContext value={{ user, login, logout }}>       // a new object each render re-renders every consumer
```

With the React Compiler this is memoized automatically. Without it, suggest `useMemo` for the value, or split rapidly changing values into a separate context. Ask whether the compiler is on before commenting.

## Missing UI states

A component that renders only the success path:

```tsx
const { data } = useQuery(q)
return <ul>{data?.map(…)}</ul>      // smell: blank while loading, blank on error, blank when empty
```

Suggest explicit branches for pending, error (with retry), empty (with guidance) and success, or the project's shared data-state component.

## Accessibility smells

| Smell | Suggest |
|---|---|
| `<div onClick>` or `<span onClick>` | `<button type="button">`, or `<a href>` when it navigates |
| `<input placeholder="Email">` without a label | a visible `<label>`; placeholder is not a label |
| `aria-label` on a `div` with no role | a semantic element; ARIA names need a role |
| `outline: none` on focus | a visible `:focus-visible` style |
| `tabIndex={1}` or higher | natural DOM order; `tabIndex={0}` or `-1` only |
| A toast as the only error message for a form | the error next to the field and an error summary |

## Security smells

| Smell | Suggest |
|---|---|
| `dangerouslySetInnerHTML={{ __html: data }}` | text rendering, or `DOMPurify.sanitize(data)` with a strict config |
| `<a href={user.website}>` | an allowlist of `http:`, `https:` and `mailto:` before rendering |
| `window.location = params.get('next')` | a same-origin relative path check |
| `localStorage.setItem('token', …)` | an `HttpOnly` cookie session or in-memory token |
| `import.meta.env.VITE_SECRET_KEY` | a server endpoint that holds the secret |
| `eval`, `new Function`, string `setTimeout` | real functions |

## TypeScript smells

| Smell | Suggest |
|---|---|
| `as any`, `: any` | `unknown` and a type guard or schema |
| `data!.items` | handle the undefined case or narrow first |
| `as User` on `await res.json()` | `User.parse(await res.json())` with a schema |
| A union of booleans (`isLoading`, `isError`, `isEmpty`) | a discriminated union (`{ status: 'loading' } \| { status: 'error'; error } \| …`) |

## Test smells

| Smell | Suggest |
|---|---|
| `getByTestId` everywhere | `getByRole` with a name, then `getByLabelText`, then text |
| asserting on component state or a mock's call count only | assert what the user sees after the action |
| `waitFor(() => expect(…))` around synchronous code, or arbitrary `setTimeout` | `findBy*` queries and user-event's awaited actions |
| snapshot tests of whole pages | small, explicit assertions on behaviour |
| mocking the module under test | mock the network (MSW) and render the real component |

## Performance smells

| Smell | Suggest |
|---|---|
| `useMemo` around cheap expressions; `useCallback` for handlers passed to DOM elements | remove; the compiler handles memoization where it matters |
| a 10,000-row `map` | virtualization or pagination |
| importing a whole library for one function (`import _ from 'lodash'`) | a direct import or a native method |
| an eager `import` of a heavy component used behind a tab | `lazy()` with Suspense |
| state at the top of a big tree updated on every keystroke | move state down, or `useDeferredValue` for the expensive part |
