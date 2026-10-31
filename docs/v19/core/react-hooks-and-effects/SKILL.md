---
name: react-hooks-and-effects
description: Uses React hooks correctly - the Rules of Hooks, useState and useReducer, when an effect is needed and when it is not, effect cleanup and dependencies, useEffectEvent, useRef, useSyncExternalStore for outside data, useId, useLayoutEffect, and writing custom hooks. Use when writing a hook or useEffect, fixing an infinite render loop, a stale closure, a missing dependency warning, a race condition in fetching, effects running twice, or subscribing to browser APIs and external stores.
metadata:
  tags:
  - react
  - hooks
  - useeffect
  - useeffectevent
  - usestate
  - usereducer
  - custom-hooks
  - usesyncexternalstore
---

# React hooks and effects

Hooks give function components state, context, refs and a way to synchronize with things outside React. Most hook bugs come from one misunderstanding: an effect is for keeping React in sync with an external system, not for reacting to state changes. This skill covers React 19.3 hooks; data fetching has its own skill (`react-data-fetching`).

## Step 0: read the installed React and hooks lint versions

Some hooks here are new (`useEffectEvent` is stable from React 19.2), and the hooks lint rules come from a plugin whose major decides the config. Read both from the project root:

```bash
node -p "['react','react-dom','eslint-plugin-react-hooks','oxlint'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `react` 19.3.1, `eslint-plugin-react-hooks` 7.1.1, `oxlint` 1.90.0. On React older than 19.2, `useEffectEvent` is not exported: keep the latest value in a ref instead.

## Rules of Hooks

The Rules of Hooks keep each hook's state attached to the same call between renders. React matches hooks by call order, so:

- Call hooks only from the top of a component body or a custom hook, never inside conditions, loops, nested functions or after an early `return`.
- Call them only from React functions, never from plain helpers or class components.
- `use` is the exception: it may be called conditionally (it is not a hook in this sense).

The linter enforces this (`react/rules-of-hooks` in Oxlint, `react-hooks/rules-of-hooks` in ESLint). Treat its errors as bugs, not style.

## Choose the hook for the job

Choosing a hook is choosing what React should do when the value changes: render, not render, or synchronize. Pick by the need, not by habit:

| You need | Hook | Why the alternatives lose |
|---|---|---|
| A value that changes what is shown | `useState` | a ref change never renders; a module variable is shared by every instance |
| Several values that change together through named actions | `useReducer` | separate `useState` calls drift into combinations that should be impossible |
| A value kept across renders that the screen does not show (timer id, DOM node) | `useRef` | state would render for nothing |
| Data from a store or browser API that React does not own | `useSyncExternalStore` | an effect plus `setState` renders one frame late and can tear during concurrent rendering |
| To keep a component in sync with an outside system (socket, widget, timer) | `useEffect` with a cleanup | work in the render body runs on every render and is never cleaned up |
| The latest props inside an effect, without re-running it | `useEffectEvent` | adding them to the dependencies reconnects; leaving them out reads stale values |
| To measure layout before the browser paints | `useLayoutEffect` | `useEffect` shows one frame of the wrong layout |
| An id to link a label, hint or error | `useId` | `Math.random()` differs between server and client; a counter breaks with several roots |
| Typing that stays fast while a heavy part re-renders | `useDeferredValue` or `useTransition` | a debounce delays every update, even cheap ones |

## useState and functional updates

`useState` holds a value that, when set, schedules a re-render. The setter replaces the value; it does not merge objects.

```tsx
const [filters, setFilters] = useState({ query: '', status: 'all' as Status })

setFilters((f) => ({ ...f, query: 'acme' }))       // functional update: based on the latest value
setCount((c) => c + 1)                              // safe when called several times in one event
```

- Use the functional form when the next value depends on the previous one; `setCount(count + 1)` twice in one handler adds 1, not 2.
- The state value inside a handler is the one from that render; logging it right after `set` shows the old value.
- Expensive initial value: pass a function, `useState(() => parse(raw))`, so it runs once.
- Store the minimum. If a value can be computed from props or other state, compute it during render.

## useReducer for related state

`useReducer` moves update logic into one pure function. Use it when several values change together or the next state depends on an action type:

```tsx
type State =
  | { status: 'idle'; draft: string }
  | { status: 'saving'; draft: string }
  | { status: 'error'; draft: string; error: string }
type Action = { type: 'edit'; text: string } | { type: 'save' } | { type: 'failed'; error: string } | { type: 'saved' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'edit': return { ...state, draft: action.text }
    case 'save': return { status: 'saving', draft: state.draft }
    case 'failed': return { status: 'error', draft: state.draft, error: action.error }
    case 'saved': return { status: 'idle', draft: '' }
  }
}

const initial: State = { status: 'idle', draft: '' }
const [state, dispatch] = useReducer(reducer, initial)
```

The state is a discriminated union on `status`, so `error` exists only in the `error` member: saving with an error at once is a compile error, not a bug to find later.

## You might not need an effect

Most `useEffect` calls in application code can be removed. An effect runs after the paint, so state set inside it causes a second render and often a flash of wrong UI. Before writing one, check this table:

| You want to | Do this instead of an effect | Why the effect loses |
|---|---|---|
| Compute a value from props or state | compute it during render (the compiler memoizes it) | an extra render, one frame of stale UI |
| Reset state when a prop changes | give the component a `key` (`<Editor key={docId} />`) | the old state shows for a frame, and nested state is missed |
| Adjust part of the state when a prop changes | compute from the prop, or store the previous prop and compare during render | effect chains that are hard to follow |
| Respond to a user action (submit, click) | do it in the event handler | the effect cannot tell which action caused the change |
| Share logic between two handlers | a plain function both handlers call | it runs on unrelated renders too |
| Fetch data for the screen | a query cache or route loader (`react-data-fetching`) | no cache, races, waterfalls |
| Notify a parent of a change | call the parent's callback in the same handler that changed the state | the parent renders a second time, after the child |
| Subscribe to an external store | `useSyncExternalStore` | tearing and a late first value |

The linter's `set-state-in-effect` rule flags the most common case. More cases with code: [effects-cookbook.md](references/effects-cookbook.md).

## When an effect is the right tool

An effect synchronizes a component with a system outside React: a browser API, a third-party widget, a socket, a timer. The shape is always setup plus cleanup:

```tsx
const onSocketMessage = useEffectEvent((e: MessageEvent) => onMessage(e))   // the latest prop, without reconnecting
useEffect(() => {
  const socket = new WebSocket(`${env.wsUrl}/rooms/${roomId}`)
  socket.addEventListener('message', (e) => onSocketMessage(e))
  return () => socket.close()                   // runs before the next setup and on unmount
}, [roomId])
```

- Every reactive value the effect reads (props, state, values derived from them) is a dependency. Do not silence `exhaustive-deps`; restructure instead.
- Strict Mode runs setup, cleanup, setup on mount in development. If that breaks something, the cleanup is missing or incomplete.
- An object or function created during render is new every render; as a dependency it re-runs the effect each time. Create it inside the effect, or depend on its primitive parts.

## useEffectEvent for non-reactive logic

`useEffectEvent` (stable since React 19.2) wraps a function the effect calls so it always sees the latest props and state without being a dependency. Use it when an effect should re-run for some values but only read others:

```tsx
import { useEffect, useEffectEvent } from 'react'

function ChatRoom({ roomId, theme }: { roomId: string; theme: 'light' | 'dark' }) {
  const onConnected = useEffectEvent(() => {
    showToast(`Connected to ${roomId}`, theme)      // reads the latest theme
  })

  useEffect(() => {
    const conn = connect(roomId)
    conn.on('connected', onConnected)
    return () => conn.disconnect()
  }, [roomId])                                      // theme changes do not reconnect
}
```

- Call an effect event only from inside effects or other effect events: never during render, never from a handler, and never pass it to another component or hook. The `react-hooks` lint plugin enforces this.
- Leave it out of the dependency array. Its identity changes on every render on purpose, so listing it re-runs the effect each time.
- `useEffectEvent` is a hook, so it follows the top-level rule. Inside a loop, extract a component.
- On React 19.2, an effect event inside a `forwardRef` or `memo` component could read old values; 19.3 fixed it.
- Do not use it to hide a real dependency. If the effect must re-run when a value changes, that value stays in the array.

## Fetching in an effect safely

Fetching in an effect is the fallback when no query library or loader is available. It must ignore stale responses, or a slow early request overwrites a fast later one:

```tsx
type Result = { userId: string; user?: User; error?: Error }
const [result, setResult] = useState<Result | null>(null)

useEffect(() => {
  const controller = new AbortController()
  fetch(`/api/members/${userId}`, { signal: controller.signal })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((user: User) => setResult({ userId, user }))
    .catch((error: Error) => { if (!controller.signal.aborted) setResult({ userId, error }) })
  return () => controller.abort()
}, [userId])

const loading = result?.userId !== userId          // derived: no setState('loading') inside the effect
```

State is set only from the response callbacks, so the `set-state-in-effect` rule stays quiet and the loading flag cannot go out of sync. This still has no caching, no deduplication and no retry. Prefer TanStack Query or a router loader (`react-data-fetching`).

## useRef for values that do not render

`useRef` holds a mutable value that survives renders without causing one: a DOM node, a timer id, the previous value, an instance of a non-React library.

```tsx
const timer = useRef<number | undefined>(undefined)
function start() { timer.current = window.setTimeout(save, 500) }
function stop() { window.clearTimeout(timer.current) }
```

- Read and write `ref.current` in handlers and effects, not during render; the render would not see later changes (`refs` lint rule).
- If the screen must show the value, it is state, not a ref.

## useSyncExternalStore for outside data

`useSyncExternalStore` subscribes a component to a store React does not own (a browser API, a module-level store, a library) without tearing during concurrent rendering:

```tsx
import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => { window.removeEventListener('online', onChange); window.removeEventListener('offline', onChange) }
}

export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true)   // third arg: server snapshot
}
```

- Define `subscribe` outside the component (or keep it stable); a new function each render resubscribes every time.
- `getSnapshot` must return the same value when nothing changed. Returning a new object each call causes an infinite loop; cache the snapshot.

## useId, useLayoutEffect and other hooks

`useId`, `useLayoutEffect`, `useImperativeHandle` and a few other built-in hooks each solve one narrow problem:

- `useId()` gives a unique, stable id for linking labels and inputs (`htmlFor`, `aria-describedby`). Never use it for list keys.
- `useLayoutEffect` runs before paint. Use it only to measure layout and set state that must apply before the user sees a frame (tooltip position). It blocks painting.
- `useImperativeHandle(ref, () => ({ focus, reset }))` exposes a small imperative API instead of the DOM node.
- `useTransition` and `useDeferredValue` keep input responsive during heavy renders (`react-performance`).
- `useActionState`, `useFormStatus`, `useOptimistic` are for forms and Actions (`react-forms`).

## Writing custom hooks

A custom hook is a function whose name starts with `use` and that calls other hooks. It shares stateful logic, not state: each component that calls it gets its own copy.

```tsx
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(id)
  }, [value, delayMs])
  return debounced
}
```

- Name it for what it gives (`useOnline`, `useInvoiceFilters`), not how it works.
- Return a value, a tuple (`[value, setValue]`) or a small object; keep the surface small.
- A function that calls no hooks is not a hook; drop the `use` prefix.
- Avoid lifecycle hooks such as `useMount` or `useUpdateEffect`; they hide the dependency question an effect forces you to answer.
- Test it through a component or `renderHook` (`react-testing`).

## Worked example: a stored setting synced across tabs

A worked example of a custom hook done right: `useStoredValue` reads `localStorage` through `useSyncExternalStore`, follows changes from other tabs, validates the stored JSON with a schema (anything can be in storage), and reports a failed write instead of losing it silently. No effect is needed:

```ts
// src/shared/hooks/useStoredValue.ts
import { useSyncExternalStore } from 'react'
import type { z } from 'zod'

const listeners = new Set<() => void>()
function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)                      // writes from other tabs
  return () => { listeners.delete(onChange); window.removeEventListener('storage', onChange) }
}
function readRaw(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }   // storage blocked or unavailable
}

export function useStoredValue<T>(key: string, schema: z.ZodType<T>, fallback: T) {
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => null)   // a string snapshot is stable
  let value = fallback
  if (raw !== null) {
    try { const parsed = schema.safeParse(JSON.parse(raw)); if (parsed.success) value = parsed.data } catch { /* corrupt JSON */ }
  }
  function setValue(next: T): boolean {
    try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { return false }   // quota exceeded or blocked
    for (const notify of listeners) notify()                       // the storage event fires only in other tabs
    return true
  }
  return [value, setValue] as const
}
```

```tsx
// src/features/settings/DensitySetting.tsx
const Prefs = z.object({ density: z.enum(['comfortable', 'compact']) })
const densities = ['comfortable', 'compact'] as const

export function DensitySetting() {
  const [prefs, setPrefs] = useStoredValue('prefs', Prefs, { density: 'comfortable' })
  const [error, setError] = useState<string | null>(null)
  return (
    <fieldset>
      <legend>Density</legend>
      {densities.map((d) => (
        <label key={d}>
          <input type="radio" name="density" value={d} checked={prefs.density === d}
            onChange={() => setError(setPrefs({ ...prefs, density: d }) ? null : 'This setting could not be saved on this device.')} />
          {d === 'compact' ? 'Compact' : 'Comfortable'}
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  )
}
```

- The snapshot is the raw string, which compares equal between reads; parsing happens during render, so `getSnapshot` never returns a new object.
- A stored value with the wrong shape falls back to the default instead of crashing the screen.

## Verify hooks and effects

Hooks are proven when the lint rules pass without suppressions, the code survives Strict Mode's double setup, and a test drives the hook through its outside source. Run:

```bash
npx oxlint --deny-warnings                                  # rules-of-hooks, exhaustive-deps, set-state-in-effect
grep -rnE "eslint-disable.*(exhaustive-deps|rules-of-hooks)" src   # must print nothing
npx vitest run src/shared/hooks
```

```tsx
test('useStoredValue follows other tabs and rejects bad data', () => {
  const Prefs = z.object({ density: z.enum(['comfortable', 'compact']) })
  const { result } = renderHook(() => useStoredValue('prefs', Prefs, { density: 'comfortable' as const }))
  act(() => { localStorage.setItem('prefs', '{"density":"compact"}'); window.dispatchEvent(new StorageEvent('storage', { key: 'prefs' })) })
  expect(result.current[0].density).toBe('compact')
  act(() => { localStorage.setItem('prefs', '{"density":"huge"}'); window.dispatchEvent(new StorageEvent('storage', { key: 'prefs' })) })
  expect(result.current[0].density).toBe('comfortable')
})
```

- With Strict Mode on, mount and unmount the screen in development: no duplicate sockets, listeners or requests in the Network and Performance panels.
- React DevTools shows the effect's component rendering once per real change, not once more after every commit.

## Pre-merge checklist for hooks and effects

Check each point before merging hook or effect code.

1. Hooks called at top level only; the rules-of-hooks lint rule passes.
2. No effect that only derives state, resets state, or handles a user event.
3. Every remaining effect talks to an external system and returns a cleanup.
4. Dependency arrays complete; no `eslint-disable` on `exhaustive-deps`.
5. Latest-value reads without re-running use `useEffectEvent`.
6. External stores read with `useSyncExternalStore` and a cached snapshot.
7. Fetching in effects aborts or ignores stale responses, or moved to a query library.
8. Behaviour is the same with Strict Mode's double setup.

## Gotchas and anti-patterns in hooks and effects

Each entry gives the symptom you see, its cause and the fix.

1. **Infinite render loop.** Cause: an effect sets state that is in its own dependencies, or depends on an object created during render. Fix: derive during render, or depend on primitives.
2. **Stale value inside an interval or listener.** Cause: the closure captured the value from the render that created it. Fix: functional state updates, or `useEffectEvent` for the callback.
3. **Effect runs twice on mount in development.** Cause: Strict Mode. Fix: add or complete the cleanup.
4. **Old response overwrites the new one.** Cause: no abort or ignore flag on a fetch in an effect. Fix: `AbortController` in cleanup, or a query library.
5. **`Rendered more hooks than during the previous render`.** Cause: a hook after an early `return` or inside a condition. Fix: move all hooks above the first return.
6. **`useSyncExternalStore` loops forever.** Cause: `getSnapshot` returns a fresh object. Fix: return a cached value that changes only when the store does.
7. **Layout jumps for one frame.** Cause: measuring in `useEffect`. Fix: `useLayoutEffect` for that one measurement.
8. **`useEffect must not return anything besides a function, which is used for clean-up`.** Cause: an `async` function passed to `useEffect` returns a promise. Fix: define the async function inside the effect and call it, or use a query library.
9. **Anti-pattern: lifecycle wrappers such as `useMount` and `useUpdateEffect`.** Symptom: effects that miss changes or run at surprising times. Cause: the wrapper hides the dependency question. Fix: a plain `useEffect` with its real dependencies, or no effect at all.

## See also

- `react-data-fetching` (server data), `react-state-management` (stores), `react-realtime` (sockets and streams).
- `react-suspense-and-concurrency`: `use`, transitions and deferred values in depth.
