---
name: react-debugging
description: Debugs React apps from the symptom or the error message - Too many re-renders, Maximum update depth exceeded, Cannot update a component while rendering a different component, Objects are not valid as a React child, Invalid hook call, Element type is invalid, uncached promise and hydration errors, minified production errors - plus a component that does not update or renders too often, effects running twice, and the tools to find the cause - React DevTools Components and Profiler, owner stacks, Performance tracks, Strict Mode and source maps. Use when a React app throws, shows a blank page, loops, shows stale UI, or behaves differently in production, and you need the cause before the fix, or when a coding agent should inspect the running app (react-devtools-cdt-mcp) or check a claim against React's own sources.
metadata:
  tags:
  - react
  - debugging
  - errors
  - devtools
  - profiler
  - strict-mode
  - troubleshooting
---

# Debugging React apps

Most React bugs fall into a few families: a render that sets state (loops), a hook called in the wrong place, a value React cannot render, state that changed without React knowing, and an effect without cleanup. This skill maps the messages and symptoms people see to their causes on React 19.3, and gives a method for the rest. Read the whole error first: React 19 prints the message and the component stack, and from 19.1 on, in development, the owner stack (which component rendered the failing one).

## Step 0: read the installed versions and look for a second React

Error messages, owner stacks and DevTools features differ between React versions, and two copies of React cause "Invalid hook call". Read the versions and the copies first, from the project root:

```bash
node -p "['react','react-dom','react-router','@tanstack/react-query','vite'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Then `npm ls react react-dom` (or `pnpm why react`) must show exactly one copy of each. Written against (October 2026): `react` 19.3.1, `react-router` 8.5.1, `@tanstack/react-query` 5.105.0, `vite` 8.3.5. Owner stacks appear in development builds from React 19.1 on; React 18 or earlier prints some messages this skill does not list.

## A method for any React bug

Debugging goes faster with the same steps every time, because the error message and the component stack usually name the cause:

1. **Reproduce** in development with Strict Mode on; note the exact steps.
2. **Read the full message**, the component stack and the owner stack. Production errors are minified: open the `https://react.dev/errors/<code>` link they print for the full text.
3. **Inspect** the component in React DevTools: its props, state and hooks at the moment it goes wrong, and which parent rendered it ("rendered by").
4. **Isolate**: remove half of the suspect JSX or effects until the bug stops, then add back.
5. **Fix the cause**, not the symptom (no `eslint-disable`, no `try`/`catch` around render), and add a test that fails without the fix.

## Choose the first debugging tool for the symptom

Choosing the right first tool saves most of the time a React bug costs. Start where the evidence already is:

| Symptom | Open first | Why the other tools come later |
|---|---|---|
| An error, a red overlay or a blank page | the console: the full message, component stack and owner stack (production: the `react.dev/errors/<code>` link) | inspecting components before reading the message is guessing |
| The screen shows a wrong or stale value | React DevTools Components tab: props, state and hooks of that component now | `console.log` shows one render's snapshot, not the live tree |
| A loop ("Too many re-renders", "Maximum update depth exceeded") | the stack frames of the error, then "rendered by" in the Components tab | the Profiler cannot record a render that never finishes |
| An interaction feels slow | the Profiler with "why did this render", then the Performance panel's React tracks | adding `memo` before measuring moves the cost without finding it |
| Data is wrong before React touches it | the Network tab and the query devtools | component state only shows what the data layer handed over |
| It happens only in production | `npm run build && npm run preview` with hidden source maps | the dev server is a different program with different checks |
| It happens only in one browser | that browser's developer tools and a feature check | the bug is usually a missing API, not React |

## "Too many re-renders" from setting state during render

`Too many re-renders. React limits the number of renders to prevent an infinite loop` means a component sets state while it renders, so every render schedules another. The usual causes:

```tsx
// Wrong: calls setOpen during render
<button onClick={setOpen(true)}>Open</button>
// Right: passes a function
<button onClick={() => setOpen(true)}>Open</button>

// Wrong: unconditional set in the body
function Total({ items }) { const [sum, setSum] = useState(0); setSum(items.length); return <p>{sum}</p> }
// Right: derive it
function Total({ items }) { return <p>{items.length}</p> }
```

Setting state during render is allowed only behind a condition that stops it (storing a previous prop to adjust state); the derived value is almost always simpler.

## "Maximum update depth exceeded" from effects and selectors

"Maximum update depth exceeded" means updates keep triggering each other after render: an effect sets state that is in its own dependencies, or a subscription returns a new value every time it is read.

- An effect depends on an object or array created during render and sets state: each render makes a new dependency, the effect runs, sets state, renders again. Depend on primitives (`user.id`), or derive instead of syncing.
- A store selector returns a new object (`useStore((s) => ({ a: s.a, b: s.b }))` in Zustand 5): wrap it with `useShallow` or select fields one by one.
- `useSyncExternalStore` with a `getSnapshot` that builds a new object each call: React also warns `The result of getSnapshot should be cached to avoid an infinite loop`. Cache the snapshot.
- A ref callback that sets state without a guard on every attach.

## `Cannot update a component while rendering a different component`

`Cannot update a component (Parent) while rendering a different component (Child)` means the child calls the parent's setter during its own render, often through a callback prop or a store write in the body:

```tsx
// Wrong: notifies the parent while rendering
function Filters({ onCount }) { const n = useFilters().length; onCount(n); return … }
// Right: the parent derives the count, or the child calls onCount in the event that changed it
```

Store writes in render (`useStore.setState(...)` in a component body) cause the same warning. Move them into event handlers, or into an effect if they synchronize with something external.

## `Objects are not valid as a React child` and other render errors

These errors mean JSX received a value React cannot draw:

| Message | Cause | Fix |
|---|---|---|
| `Objects are not valid as a React child (found: object with keys {…})` | an object, `Date` or API response rendered directly | render a field (`{user.name}`), format dates (`toLocaleDateString`), map arrays |
| Objects are not valid … (found: [object Promise]) | an `async` function used as a component, or a promise in JSX | fetch outside render (`react-data-fetching`), or `use(promise)` with a cached promise |
| `Functions are not valid as a React child` | `{Header}` instead of `<Header />`, or a render prop not called | render the element or call the function |
| Element type is invalid: expected a string … but got: undefined | a default import of a named export (or the reverse), or a circular import | match `export function X` with `import { X }`; break the cycle |
| Element type is invalid … but got: object | importing a module namespace or a `lazy()` result used wrongly | import the component itself; `lazy(() => import('./X'))` needs a default export |

## "Invalid hook call" and hook order errors

`Invalid hook call. Hooks can only be called inside of the body of a function component` has three causes, and the third is the one people miss:

1. A hook called outside a component or custom hook (in a plain helper, a class, an event handler, a loader).
2. `react` and `react-dom` versions that do not match.
3. Two copies of React in the bundle, often from a linked package or a library that bundles React. Check with `npm ls react react-dom`; dedupe (`npm dedupe`), make the library list React as a peer dependency, or set `resolve.dedupe: ['react', 'react-dom']` in Vite.

`Rendered more hooks than during the previous render` and `Rendered fewer hooks than expected` mean a hook is called conditionally or after an early `return`. Move every hook above the first `return`; the `rules-of-hooks` lint rule finds them.

## `A component was suspended by an uncached promise`

`A component was suspended by an uncached promise` (or a component that suspends forever) means `use(promise)` received a new promise on every render, so React waits for one that is replaced before it settles. Create the promise outside render: in a loader, a parent's `useState(() => fetchX())`, or a cache such as TanStack Query. "async/await is not yet supported in Client Components" means an `async function` component was rendered in a client app; only Server Components may be async.

`This library called use() to suspend in a previous render but did not call use() when it finished.` is a development warning added in React 19.3. A hook called `use` behind a condition that became false once the data arrived, such as `if (!cache.has(key)) use(load(key))`. Call `use` on every render of that path, with the settled promise from the cache.

`A component suspended while responding to synchronous input` means an urgent update (typing, a click) made something suspend with no `<Suspense>` boundary able to keep the old UI. Wrap the update in `startTransition`, or add a boundary around the suspending part.

## A component that does not update after setState

When the screen does not change after a state update, React usually did not see a new value. Check in this order:

- **Mutation**: `items.push(x); setItems(items)` passes the same array, and React skips the update because `Object.is(old, new)`. Create a new array or object: `setItems([...items, x])`.
- **Stale closure**: an interval or listener created once keeps reading the first render's state. Use the functional update `setCount((c) => c + 1)` or `useEffectEvent`.
- **State copied from props**: `useState(props.value)` reads the prop once. Use the prop directly, or reset with `key`.
- **A store or ref instead of state**: writing `ref.current` or a module variable never renders. Use state or a store hook.
- **A memoized child with a mutated prop**: `memo` (or the React Compiler) sees the same object reference. Pass new objects; never mutate.
- **The wrong component instance**: a `key` that changes remounts it, or two copies of a context provider split the tree. Check the tree in DevTools.

## A component that renders too often

Extra renders are only a problem when they are slow, so measure first. In React DevTools, open Profiler settings and turn on "Record why each component rendered while profiling", record the interaction, and read the reason per component (props changed, hooks changed, parent rendered, context changed). Typical fixes:

- A parent re-renders on every keystroke: move the input state down into a small component.
- A context value is a new object each render and every consumer re-renders: the React Compiler memoizes it; without it, `useMemo` the value or split the context.
- Progress or socket messages written to state many times per second: keep them in an external store and publish once per frame (`react-performance`).

## Effects and logs that run twice in development

Effects that run twice, and `console.log` lines that appear twice, in development come from Strict Mode, on purpose: React mounts, unmounts and mounts each component once more, and renders twice, to expose missing cleanups and impure renders. It does not happen in production.

- If the double run breaks something (two sockets, two analytics events, a request sent twice), the effect is missing a cleanup or should be an event handler.
- DevTools dims logs from the second render; its settings can hide them.
- From React 19.3 the double run also happens during hydration, matching client-rendered roots, and after a Fast Refresh edit.
- Never remove `<StrictMode>` to "fix" it; the bug it shows will reach production in other forms (Fast Refresh, `<Activity>`, remounts).

## Hydration mismatch errors

`Hydration failed because the server rendered HTML didn't match the client` appears only when HTML was rendered on a server or at build time (a framework, prerendering) and the first client render differs. A client-only Vite app with `createRoot` never hydrates. Causes:

- Values that differ per run: `Date.now()`, `Math.random()`, `new Date().toLocaleString()` without a fixed locale and time zone.
- Browser-only reads during render: `window`, `localStorage`, `matchMedia`. The table below picks the fix.
- Invalid nesting the browser repairs: `<div>` inside `<p>`, `<a>` inside `<a>`, a `<tr>` without `<tbody>`. React warns `In HTML, <div> cannot be a descendant of <p>`.
- Browser extensions that edit the page before React hydrates; reproduce in a clean profile.

`suppressHydrationWarning` on one element silences a known, harmless difference such as a timestamp; it is not a general fix.

### Choose a fix for browser-only values during server rendering

Pick the fix by what the first HTML should show, because each one trades a fallback, a flash or a default value:

| The value | Fix | Why not the others |
|---|---|---|
| A component that has nothing useful to render on the server (a `localStorage` draft, the device time zone) | `<Suspense>` plus `use(browser())` on React 19.3+ | a `mounted` effect renders twice and commits an empty state the user can see |
| A browser value with a safe default (online status, a media query) | `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` | an effect copy of the value lags one render behind and tears |
| A value the server can know (theme, locale) | read a cookie on the server and render the right HTML | a client read flashes the wrong look first |
| A theme only the browser knows, needed before first paint | a small blocking inline `<script>` that sets a class on `<html>`, with `suppressHydrationWarning` on `<html>` | an effect runs after paint and flashes |
| One text that differs on purpose (a timestamp) | `suppressHydrationWarning` on that element | it reaches one level deep and React keeps the server text, so never use it on a whole subtree |

## React DevTools, owner stacks and Performance tracks

React DevTools (the browser extension, or the standalone `react-devtools` app for other environments) is the main tool for React bugs:

| Tool | Use it to |
|---|---|
| Components tab | see props, state, hooks and context of any component; edit them live; jump to source; see "rendered by" owners |
| Suspend and error toggles in the Components tab | force a component into its `<Suspense>` fallback or its error boundary to test those states |
| Profiler tab | record an interaction; see what rendered, why, and how long it took |
| "Highlight updates when components render" | watch re-renders while you interact |
| Memo ✨ badge | confirm the React Compiler compiled a component |
| Chrome Performance panel, React tracks (React 19.2+) | see React's scheduler and component work on the browser's timeline |

Owner stacks (React 19.1+) show which components created the failing element, not only where it sits in the tree; `captureOwnerStack()` from `react` returns it in development for your own logging. From React 19.3 an owner stack holds at most 10 frames.

### React DevTools for coding agents with react-devtools-cdt-mcp

`react-devtools-cdt-mcp` is the React team's experimental bridge that shows a coding agent what the DevTools extension shows a person: which component rendered what, its props, hooks and owners, where its source lives and how long each render took. It is not an MCP server. It runs inside your page and registers its tools with Chrome DevTools MCP, which is the only server you configure.

The hook must load before React, and it makes React report every commit, so keep it out of production builds. Static imports run first, so a thin entry file loads the app after it:

```ts
// src/main.tsx: the Vite entry; createRoot moves to src/bootstrap.tsx
if (import.meta.env.DEV) await import('react-devtools-cdt-mcp/register')
await import('./bootstrap')
```

```json
{ "mcpServers": { "chrome-devtools": { "command": "npx", "args": ["-y", "chrome-devtools-mcp@latest", "--categoryExperimentalThirdParty"] } } }
```

The third-party category needs `chrome-devtools-mcp` 0.25.0 or newer. The agent lists the page's tools with `list_3p_developer_tools` and runs them with `execute_3p_developer_tool`:

| Goal | Tools in the `react` group |
|---|---|
| Find a component | `react_get_component_tree`, `react_find_components`, `react_get_component_by_dom_element` |
| Inspect it | `react_get_component_by_uid` with `includeHooks`, `react_get_component_source` |
| See who made it | `react_get_parent_stack`, `react_get_owner_stack`, `react_get_owner_stack_trace` |
| Time an interaction | `react_start_profiling`, `react_stop_profiling`, `react_get_trace_overview`, `react_get_commit_report` |

A typical session finds the component, records one interaction, then reads the commit report to see what rendered and how long it took. Uids such as `"r5"` survive re-renders but not a reload. A tool failure comes back as a plain object with an `error` field, not an exception. An empty tree means the import ran after React started; missing tools mean the third-party flag is off or the selected page lacks the import; empty source locations and owner stacks mean a production build. The import throws outside a browser, so it never belongs in a server entry.

### Check a React claim against the primary sources

An assistant's memory of React, and most blog posts, trail the installed version. When a behaviour matters, check it at the source, in this order:

| You need | Look here |
|---|---|
| Which API exists in this project | `node_modules/@types/react/index.d.ts`, `node_modules/@types/react-dom/index.d.ts` and the version from Step 0 |
| What a case does at runtime | the tests in `packages/*/src/__tests__/` of `github.com/react/react`, at the tag of the installed version |
| What triggers a warning | the `console.error` calls in `packages/*/src/`, or `https://react.dev/errors/<code>` for a minified one |
| The documented contract | `https://react.dev/llms.txt` lists every page; add `.md` to a page URL for plain Markdown, such as `https://react.dev/reference/react/useTransition.md` |
| Why it works this way | `gh pr list -R react/react --search "<topic>" --state all`, then the pull request's description |
| What changed between versions | `CHANGELOG.md` in `react/react` and the posts on `https://react.dev/blog` |

If the source disagrees with what you remembered, the source wins, and say so in the fix. The repository moved from `facebook/react` to `react/react` in 2026; old links redirect.

## Errors that only happen in production

Bugs that appear only in the production build come from minification, missing environment variables, or code that only runs in one mode:

- Minified React errors print a code and a link: open `https://react.dev/errors/<code>` for the full message.
- Upload hidden source maps (`build.sourcemap: 'hidden'`) to the error tracker, so stack traces show real files without serving the maps.
- Reproduce locally with `npm run build && npm run preview`; the dev server is a different program.
- A blank page in production with "Cannot read properties of undefined" at start is often a missing `VITE_` variable at build time.
- Behaviour that differs with the React Compiler: add `'use no memo'` at the top of the suspect component; if the bug goes away, the component breaks a Rule of React the linter should report.

## Worked example: tracing a Maximum update depth loop

A worked example of the method on a real-looking bug. A filter panel crashes with "Maximum update depth exceeded" as soon as it mounts:

```tsx
// Before: the effect depends on an object rebuilt every render, and sets state the render reads
function FilterPanel({ filters }: { filters: Filters }) {
  const [summary, setSummary] = useState('')
  const options = { ...filters, locale: 'en' }                  // new object each render
  useEffect(() => { setSummary(describe(options)) }, [options]) // runs after every render, sets state, renders again
  return <p>{summary}</p>
}
```

1. **Reproduce**: the crash happens on mount in development, every time.
2. **Read**: the stack's top React frame names `FilterPanel`; the owner stack shows which screen rendered it.
3. **Inspect**: React DevTools Profiler (or a breakpoint in the effect) shows the effect firing on every commit, with `options` "changed" each time.
4. **Isolate**: removing the effect stops the loop, so the cause is the effect and its dependency.
5. **Fix the cause**: the summary is derived data, so it needs no state and no effect:

```tsx
// After: derived during render; nothing to synchronize
function FilterPanel({ filters }: { filters: Filters }) {
  return <p>{describe({ ...filters, locale: 'en' })}</p>
}
```

The regression test renders `FilterPanel` and asserts the summary text; it failed with the loop and passes now. The `set-state-in-effect` lint rule would have flagged the first version.

## Verify a React bug fix

A fix is proven when a test that reproduced the bug now passes, the console is clean in Strict Mode, and the production build behaves the same. Run:

```bash
npx vitest run src/features/filters        # the regression test: red before the fix, green after
npx oxlint --deny-warnings                 # rules-of-hooks, set-state-in-effect, purity
npm ls react react-dom                     # exactly one copy of each, same version
npm run build && npx vite preview          # repeat the reproduction steps on the production build
```

- The browser console shows no React warnings while repeating the steps in development (Strict Mode on).
- For "only in production" bugs, the error tracker's stack trace resolves to original files through the uploaded hidden source maps.
- For render-count bugs, a Profiler recording before and after shows the component no longer commits on the interaction.

## Pre-merge checklist for a React bug fix

Check each point before merging a fix.

1. The bug is reproduced, and the full message, component stack and owner stack were read.
2. The cause is named (render loop, hook order, mutation, stale closure, missing cleanup, duplicate React, mismatch).
3. The fix removes the cause; no lint rule disabled, no `try`/`catch` around rendering, no `StrictMode` removed.
4. A test reproduces the bug and passes with the fix.
5. The lint rules for hooks and the compiler pass.

## Gotchas and anti-patterns in debugging React

Each entry gives the symptom you see, its cause and the fix.

1. **`console.log(state)` right after `setState` prints the old value.** Cause: state is a snapshot per render. Fix: log in the next render, or compute the next value in a variable first.
2. **"Warning: Can't perform a React state update on an unmounted component."** Cause: this warning was removed in React 18; seeing it means an old React is installed. Fix: check `npm ls react`.
3. **The error boundary does not catch an error from a click.** Cause: boundaries catch render errors only. Fix: catch in the handler, or run the work in `startTransition` (`react-error-handling`).
4. **A blank page with no error.** Cause: the error happened before the root rendered, or `onUncaughtError` swallowed it. Fix: open the browser console and Network tab, check the root options.
5. **The fix works in Chrome but not Safari.** Cause: a browser API difference (View Transitions, Popover, anchor positioning). Fix: feature-detect and test in each target browser.
6. **DevTools shows no Components tab.** Cause: a production build, React loaded in an iframe, or several React roots in other windows. Fix: run the development build; select the right frame in DevTools.
7. **Anti-pattern: `// eslint-disable-next-line react-hooks/exhaustive-deps` to stop a loop.** Symptom: the loop stops and a stale value appears somewhere else. Cause: the effect still reads a value it no longer tracks. Fix: derive instead of syncing, or read latest values with `useEffectEvent`.
8. **Anti-pattern: removing `<StrictMode>` because effects run twice.** Symptom: the double run is gone and the bug returns later with Fast Refresh or `<Activity>`. Cause: a missing cleanup. Fix: write the cleanup.

## See also

- `react-observability`: error tracking, source maps and logs from production.
- `react-error-handling`, `react-hooks-and-effects`, `react-performance` (profiling).
