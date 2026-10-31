---
name: react-migrations
description: Upgrades and migrates React codebases safely - React 18 to 19 with the official codemods (removed ReactDOM.render, propTypes, defaultProps, string refs, legacy context, test-utils act, type changes), class components to function components with hooks, Create React App to Vite, forwardRef and Context.Provider to React 19 forms, TanStack Query 4 to 5, react-router-dom to react-router, Enzyme to Testing Library, framer-motion to motion, and the order to do them in. Use when upgrading React or a major dependency, when an old project will not build, when moving off Create React App or class components, or when planning a migration of a large React app.
metadata:
  tags:
  - react
  - migration
  - upgrade
  - react-19
  - codemod
  - create-react-app
  - class-components
  - vite
---

# React migrations and upgrades

A React migration goes well when it is a series of small, green steps: one major dependency at a time, codemods first, tests and the linter after each step, and no feature work mixed in. This skill covers the upgrades React codebases need in 2026, from the React 18 to 19 jump to leaving Create React App, with React 19.3 as the target.

## Step 0: read what the project runs today

The starting versions decide the path, so read them and keep the output in the migration notes:

```bash
node -p "['react','react-dom','@types/react','react-scripts','vite','react-router','react-router-dom','@tanstack/react-query','react-query','enzyme','framer-motion','motion','typescript'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
npm ls react react-dom          # more than one copy breaks hooks
git status --short              # start from a clean tree, so every codemod is one reviewable diff
node <this-skill>/scripts/find-legacy-apis.mjs src   # every removed or replaced API, with file and line
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

The scan's "removed" list is the work the upgrade cannot skip; its "replace" list can wait until a file is touched.

## Choose a codemod, a manual change or a replacement

Choosing how to make each change decides how reviewable the migration stays. Sort every item from the legacy scan into one row:

| The change | Do it with | Why the alternatives lose |
|---|---|---|
| A mechanical rename across many files (imports, option names, type changes) | the official codemod on a clean tree, one codemod per commit | hand edits miss files and mix renames with real changes in one diff |
| A change of behaviour (lifecycles to effects, effects to derived values, fetching to a query cache) | by hand, one component at a time, with its tests left unchanged | a codemod cannot know what the old code meant |
| A package with no path to the new version (Enzyme, Recoil, `react-scripts`) | a maintained replacement, migrated behind the old API where possible | patching or forking it blocks every later upgrade |
| The whole app at once ("rewrite on the new stack") | almost never | it freezes features for months and loses behaviour nobody wrote down |

## Plan the order of upgrades

Upgrading one major at a time keeps each failure small. A dependable order for an old React app:

1. Get tests running and green on the current versions; add a smoke test of the main screens if there are none.
2. Leave Create React App for Vite (the build tool change touches everything else less than it seems).
3. Upgrade React to 18.3 and fix its deprecation warnings, which announce every React 19 removal.
4. Upgrade to React 19 with the codemods, then the type changes.
5. Upgrade the ecosystem one package at a time: router, data library, test tools, animation.
6. Turn on the React Compiler last, after the linter's compiler rules are clean.

Commit after each step with the tests green; a revert then costs one commit.

## Upgrade React 18 to React 19

React 19 removed APIs that were deprecated for years. Upgrade through 18.3 first, then run the official codemods:

```bash
npm i react@18.3 react-dom@18.3 && npm test          # read and fix every deprecation warning
npm i react@^19 react-dom@^19 && npm i -D @types/react@^19 @types/react-dom@^19
npx codemod@latest react/19/migration-recipe          # runtime API changes
npx types-react-codemod@latest preset-19 ./src        # type changes
```

| Removed or changed in React 19 | Replace with |
|---|---|
| `ReactDOM.render`, `ReactDOM.hydrate` | `createRoot(el).render(<App />)`, `hydrateRoot(el, <App />)` from `react-dom/client` |
| `unmountComponentAtNode(el)` | `root.unmount()` |
| `findDOMNode` | a ref on the element |
| `propTypes` on function components (silently ignored) | TypeScript props |
| `defaultProps` on function components (ignored) | default values in the destructuring |
| string refs (`ref="input"`) | `useRef` or a callback ref |
| legacy context (`contextTypes`, `getChildContext`) | `createContext` |
| `act` from `react-dom/test-utils` | `import { act } from 'react'` |
| `react-test-renderer` (deprecated) | Testing Library |
| UMD builds (`react.production.min.js` script tags) | an ESM CDN or a bundler |
| `useFormState` (canary) | `useActionState` from `react` |

Behaviour that changes without an error:

- Errors thrown in render are no longer re-thrown; they go to `window.reportError` or `console.error`. Report them with the `onUncaughtError` and `onCaughtError` root options (`react-error-handling`).
- Strict Mode's double render reuses memoized results from the first render for `useMemo` and `useCallback`.
- A suspending component shows the nearest fallback sooner, before its siblings render.
- React 19 requires the modern JSX transform (`jsx: "react-jsx"` in tsconfig); the old one prints a warning.

## React 19 type changes

The `@types/react` 19 changes break compiles more often than runtime changes, so expect a list of type errors after the upgrade:

- `useRef()` needs an argument: `useRef<HTMLDivElement>(null)`, `useRef<number | undefined>(undefined)`. `useRef<T>(null)` returns `RefObject<T | null>`.
- A ref callback that returns a value is read as a cleanup: `ref={(el) => (this.input = el)}` is an error; use braces, `ref={(el) => { input.current = el }}`.
- The global `JSX` namespace is gone: use `React.JSX.Element` or `import type { JSX } from 'react'`.
- `ReactElement['props']` defaults to `unknown` instead of `any`; type the element (`ReactElement<ButtonProps>`).
- `useReducer` infers from the reducer; drop explicit `useReducer<React.Reducer<S, A>>` arguments.

The `types-react-codemod` preset fixes most of these; review its diff like any other.

## Adopt the React 19 forms of forwardRef and Context.Provider

React 19 lets components take `ref` as a prop and render a context directly as its provider. The old forms still work; move to the new ones as you touch files:

```tsx
// Before
const Input = forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) { return <input ref={ref} {...props} /> })
<ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>

// After
function Input({ ref, ...props }: InputProps & { ref?: React.Ref<HTMLInputElement> }) { return <input ref={ref} {...props} /> }
<ThemeContext value={theme}>{children}</ThemeContext>
```

`useContext(Ctx)` can become `use(Ctx)`, which also works inside conditions. A component library that must support React 18 keeps `forwardRef` until it drops 18.

## Convert class components to function components

Class components still work in React 19, but hooks, the React Compiler and most new APIs are for function components. Convert a class by mapping each lifecycle to what it was for, not one to one:

| Class | Function component |
|---|---|
| `this.state`, `this.setState` | `useState` (one per independent value) or `useReducer` |
| `componentDidMount` + `componentWillUnmount` for a subscription | one `useEffect` with setup and cleanup |
| `componentDidUpdate` comparing props to fetch | a query library or loader keyed by the prop (`react-data-fetching`) |
| `getDerivedStateFromProps` | compute during render, or reset with `key` |
| `shouldComponentUpdate`, `PureComponent` | the React Compiler, or `memo` |
| instance fields (`this.timer`) | `useRef` |
| `createRef` | `useRef` |
| `componentDidCatch`, `getDerivedStateFromError` | stays a class: error boundaries have no hook; use `react-error-boundary` |

```tsx
// Before
class Clock extends React.Component<{ tz: string }, { now: Date }> {
  state = { now: new Date() }
  timer?: number
  componentDidMount() { this.timer = window.setInterval(() => this.setState({ now: new Date() }), 1000) }
  componentWillUnmount() { window.clearInterval(this.timer) }
  render() { return <time>{this.state.now.toLocaleTimeString('en-GB', { timeZone: this.props.tz })}</time> }
}

// After
function Clock({ tz }: { tz: string }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return <time>{now.toLocaleTimeString('en-GB', { timeZone: tz })}</time>
}
```

Convert leaf components first; keep each conversion's tests unchanged so they prove the behaviour stayed the same.

## Move from Create React App to Vite

Create React App was deprecated in February 2025 and receives no updates; `react-scripts` 5 pins old Webpack, Jest and Babel versions. Move to Vite in one branch:

```bash
npm rm react-scripts && npm i -D vite @vitejs/plugin-react
```

1. Move `public/index.html` to the project root, remove `%PUBLIC_URL%` (use `/`), and add `<script type="module" src="/src/index.tsx"></script>` before `</body>`.
2. Add `vite.config.ts` with `plugins: [react()]`; set `build.outDir: 'build'` if the deploy expects CRA's folder, and `server.port: 3000` if people rely on it.
3. Rename environment variables `REACT_APP_X` to `VITE_X`, and `process.env.REACT_APP_X` to `import.meta.env.VITE_X`. Add `/// <reference types="vite/client" />` in `src/vite-env.d.ts`.
4. Rename `.js` files that contain JSX to `.jsx` (Vite does not parse JSX in `.js` by default).
5. SVGs imported as components (`import { ReactComponent as Logo }`) need `vite-plugin-svgr` and `import Logo from './logo.svg?react'`.
6. Move the `"proxy"` field of `package.json` to `server.proxy` in the Vite config.
7. Replace Jest with Vitest (`react-testing`); most `jest.fn()` calls become `vi.fn()`.
8. Update scripts: `"dev": "vite"`, `"build": "tsc -b && vite build"`, `"preview": "vite preview"`.

Full project setup for the new tooling (TypeScript, lint, Tailwind): `react-project-setup`.

## Upgrade TanStack Query 4 to 5

TanStack Query 5 renamed several options, so v4 code compiles with errors rather than failing silently. The changes most code hits:

| v4 | v5 |
|---|---|
| `useQuery(key, fn, options)` | one object: `useQuery({ queryKey, queryFn, ...options })` |
| `cacheTime` | `gcTime` |
| `isLoading` for "no data yet" | `isPending` (`isLoading` is now `isPending && isFetching`) |
| `keepPreviousData: true` | `placeholderData: keepPreviousData` |
| `useErrorBoundary` | `throwOnError` |
| `onSuccess`, `onError`, `onSettled` on `useQuery` | removed: derive in render, or react in an effect; mutations keep them |
| package `react-query` | `@tanstack/react-query` |

Codemods ship inside the package after installing v5; run each with jscodeshift, for example:

```bash
npx jscodeshift@latest ./src --extensions=ts,tsx --parser=tsx \
  --transform=./node_modules/@tanstack/react-query/build/codemods/v5/remove-overloads/remove-overloads.cjs
# also in v5/: rename-properties, is-loading, keep-previous-data, rename-hydrate
```

Later 5.x releases deprecate `fetchQuery`, `prefetchQuery` and `ensureQueryData` in favour of `queryClient.query` (`react-data-fetching`).

## Upgrade react-router-dom to react-router

React Router merged `react-router-dom` into `react-router` in v7 and removed the old package in v8. Upgrade through v7's future flags, then switch imports:

- On v6, turn on every `future` flag the console warns about, one at a time, and fix what breaks.
- Install `react-router` 7, replace `from 'react-router-dom'` with `from 'react-router'`, and import `RouterProvider` from `react-router/dom`.
- `json()` and `defer()` are gone: return plain objects from loaders, or `data(value, { status })`.
- On v8, middleware is always on and loader `context` is a `RouterContextProvider` read with `context.get(key)`.

Details and the v8 data-mode patterns: `react-router-data-mode`.

## Replace Enzyme, framer-motion and other retired packages

Some packages have no path to React 19, so the migration replaces them:

| Retired | Replacement | Notes |
|---|---|---|
| Enzyme | Testing Library | no adapter exists for React 18 or 19; rewrite tests around roles and user events |
| `react-test-renderer` | Testing Library, or Vitest Browser Mode | deprecated in React 19 |
| `@testing-library/react-hooks` | `renderHook` from `@testing-library/react` | same API, built in |
| `framer-motion` | `motion` (`import { motion } from 'motion/react'`) | same API under the new name |
| `react-helmet` | React 19 `<title>` and `<meta>` in components | React hoists them into `<head>` |
| `eslint-plugin-react-compiler` | `eslint-plugin-react-hooks` 7 or Oxlint's `react` rules | the compiler rules moved there |
| `recoil` | Jotai (similar atoms) or Zustand | Recoil is archived |

## Worked example: one component moved to React 19 patterns

A worked example of one reviewable migration commit. Before, a search field uses `forwardRef`, `defaultProps`, a `Context.Provider` and effect fetching; after, it uses `ref` as a prop, default parameters, `<Context value>` and a query, and it gains the loading, error and empty states the old code never had:

```tsx
// Before (React 18 style)
const SearchBox = forwardRef<HTMLInputElement, { placeholder?: string }>(function SearchBox({ placeholder }, ref) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Hit[]>([])
  useEffect(() => { fetch(`/api/search?q=${q}`).then((r) => r.json()).then(setResults) }, [q])   // races, no errors
  return <><input ref={ref} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} /><Hits hits={results} /></>
})
SearchBox.defaultProps = { placeholder: 'Search' }
// <SearchContext.Provider value={scope}><SearchBox /></SearchContext.Provider>
```

```tsx
// After (React 19, TanStack Query 5)
export function SearchBox({ placeholder = 'Search', ref }: { placeholder?: string; ref?: Ref<HTMLInputElement> }) {
  const [q, setQ] = useState('')
  const deferred = useDeferredValue(q)
  const hits = useQuery({
    queryKey: ['search', deferred],
    queryFn: ({ signal }) => http<Hit[]>(`/api/search?${new URLSearchParams({ q: deferred })}`, { signal }),
    enabled: deferred.trim() !== '',
  })
  return (
    <>
      <input ref={ref} type="search" aria-label={placeholder} placeholder={placeholder} value={q} onChange={(e) => setQ(e.currentTarget.value)} />
      {hits.isFetching && <p role="status">Searching…</p>}
      {hits.isError && <p role="alert">Search failed. <button type="button" onClick={() => void hits.refetch()}>Try again</button></p>}
      {hits.data?.length === 0 && <p>No results for “{deferred}”.</p>}
      {hits.data && hits.data.length > 0 && <Hits hits={hits.data} />}
    </>
  )
}
// <SearchContext value={scope}><SearchBox /></SearchContext>
```

The commit message names the patterns replaced; the component's tests stay unchanged and pass, which proves the behaviour survived. The query key now carries the input, so out-of-order responses can no longer overwrite newer ones.

## Verify a React migration

A migration step is proven when the legacy scan shows nothing removed, one React copy is installed, and the same tests pass on the production build. Run after every step:

```bash
node <this-skill>/scripts/find-legacy-apis.mjs src   # exit 0: nothing removed left; review the "replace" list
npm ls react react-dom @types/react                  # one copy each, majors match
npx tsc -b && npx oxlint --deny-warnings
npx vitest run                                       # same tests as before the step, still green
npm run build && npx vite preview                    # click through the main screens on the built app
```

- The test output and the browser console show no deprecation warnings.
- `git diff --stat` for a codemod commit touches only what that codemod changes; review it before the next step.

## Pre-merge checklist for a React migration

Check each point before merging a migration step.

1. Tests were green before the first change and after every step.
2. One major dependency per step, each in its own commit or pull request.
3. Codemods run on a clean tree, their diff reviewed, then tests run.
4. No deprecation warnings left in the console or test output.
5. `npm ls react` shows one copy; `@types/react` matches the React major.
6. The production build (`npm run build && npm run preview`) is checked, not only the dev server.
7. The linter's hooks and compiler rules pass before the React Compiler is turned on.

## Gotchas and anti-patterns in React migrations

Each entry gives the symptom you see, its cause and the fix.

1. **`ReactDOM.render is not a function` after upgrading.** Cause: React 19 removed it. Fix: `createRoot` from `react-dom/client`.
2. **Default prop values stop working on function components.** Cause: React 19 ignores `defaultProps` on functions. Fix: defaults in the parameter destructuring.
3. **Hundreds of type errors about `useRef` and ref callbacks.** Cause: `@types/react` 19. Fix: `npx types-react-codemod@latest preset-19 ./src`, then fix the rest by hand.
4. **"Invalid hook call" after the upgrade.** Cause: a dependency still brings React 18, so two copies load. Fix: `npm ls react`, upgrade or dedupe the package.
5. **JSX in `.js` files fails after moving to Vite.** Cause: Vite parses JSX only in `.jsx` and `.tsx`. Fix: rename the files.
6. **`process is not defined` in the browser after leaving CRA.** Cause: CRA polyfilled `process.env`. Fix: `import.meta.env.VITE_*`.
7. **`Cannot read properties of undefined` after the TanStack Query 5 upgrade, in code guarded by `isLoading`.** Cause: in v5 `isLoading` is true only while the first fetch runs, so a disabled or paused query has no data and `isLoading: false`. Fix: guard with `isPending` (the `is-loading` codemod does it).
8. **A library breaks with React 19 though it installs.** Cause: it uses removed APIs (`findDOMNode`, string refs, `defaultProps`). Fix: upgrade it, or replace it; check its React 19 issue first.
9. **Anti-pattern: several majors in one pull request.** Symptom: a failing test that nobody can attribute to React, the router or the test runner. Cause: the steps were batched. Fix: one major per step, in the order above.
10. **Anti-pattern: turning on the React Compiler during the React 19 upgrade.** Symptom: behaviour changes in components nobody edited. Cause: the compiler memoizes code that breaks the Rules of React. Fix: finish the upgrade, clean the compiler lint rules, then turn it on.

Facts here were checked against the React 19 upgrade guide on react.dev (CC BY 4.0), the TanStack Query 5 migration guide and the React Router changelog (MIT); the text and examples are original.

## See also

- `react-project-setup` (the target tooling), `react-build-and-deploy` (CI for the migrated app), `react-testing` (Enzyme replacements).
- `react-router-data-mode`, `react-data-fetching`, `react-performance` (turning on the React Compiler).
