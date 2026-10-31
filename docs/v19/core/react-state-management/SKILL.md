---
name: react-state-management
description: Chooses and implements state in a React app - local state, lifting, Context done right, URL state, server cache versus client state, and the client stores Zustand 5, Redux Toolkit 2 and Jotai 3 with selectors that avoid extra renders and persistence. Use when deciding where a piece of state should live, when prop drilling or Context re-renders hurt, when adding or replacing a global store, when a selector causes an infinite loop, or when state must survive reload.
metadata:
  tags:
  - react
  - state
  - context
  - zustand
  - redux-toolkit
  - jotai
  - url-state
  - selectors
---

# React state management

State management is mostly a placement decision: each value has one owner, and the owner is chosen by who reads it and how long it must live. Most apps need far less global state than they have once server data moves to a query cache and screen state moves to the URL. This skill covers the decision and the three common client stores at their current majors: Zustand 5.0, Redux Toolkit 2.13 (with React Redux 9.3) and Jotai 3.0.

## Step 0: read the installed store versions

Store APIs changed across majors (Zustand 5 selectors, Jotai 3 removals), so check before writing code:

```bash
node -p "['zustand','@reduxjs/toolkit','react-redux','jotai','@tanstack/react-query'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

## Decide where each value lives

Deciding where a value lives starts with its kind: every piece of React state is one of five kinds. Classify before choosing a tool:

| Kind | Examples | Owner | Why a global store loses here |
|---|---|---|---|
| Server state | lists, records, the current user | a query cache: TanStack Query, RTK Query, router loaders (`react-data-fetching`) | a store copy never refetches, dedupes or invalidates, so it goes stale |
| URL state | tab, filters, sort, page, selected id, open panel | the router's search params and path (`react-router-data-mode`, `tanstack-router`) | a store is lost on reload, cannot be linked, and Back does not undo it |
| Form state | draft field values, validation errors | the form (`react-forms`) | every keystroke would go through a global subscription |
| Local UI state | an open menu, hover, an input before submit | `useState` in the component | other components gain access to state only one of them uses |
| Shared client state | theme, sidebar collapsed, a multi-step wizard, an editor's document, undo history | lifted state, Context, or a client store | (this is the row where a store can win) |

Only the last row needs a "state management library", and often only a small one. Copying server data into a client store creates two sources of truth that drift apart.

## Lift state before reaching for a store

Lifting state means moving it to the closest common parent and passing it down. It is the right answer for siblings and short trees:

```tsx
function InvoicesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  return (
    <SplitView
      left={<InvoiceList selectedId={selectedId} onSelect={setSelectedId} />}
      right={selectedId ? <InvoiceDetail id={selectedId} /> : <EmptyState title="Pick an invoice" />}
    />
  )
}
```

Prop drilling through two or three levels is fine and explicit. When you drill through components that do not use the prop, pass components as children instead (`<Layout sidebar={<Filters value={f} onChange={setF} />}>`) before adding Context.

## Context for values that change rarely

Context delivers a value to a subtree without props. Every consumer re-renders when the value changes, and there is no selector, so Context fits values that change rarely: theme, locale, the signed-in user, a feature-flag set, injected services.

```tsx
type Theme = 'light' | 'dark'
const ThemeContext = createContext<{ theme: Theme; setTheme: (t: Theme) => void } | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')
  return <ThemeContext value={{ theme, setTheme }}>{children}</ThemeContext>
}

export function useTheme() {
  const ctx = use(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
```

- With the React Compiler the `{ theme, setTheme }` object is memoized; without it, wrap it in `useMemo` or every render of the provider re-renders every consumer.
- Split a fast-changing value from its setters (two contexts) when many components only need to update it.
- A value that changes on every keystroke or many times per second does not belong in Context; use a store with selectors.

## Choose a client store

A client store holds shared client state outside React, and components subscribe to slices of it with selectors so only readers of a changed slice re-render. Pick by the shape of your state:

| Store | Shape | Pick it when | Where it loses |
|---|---|---|---|
| Zustand 5 | one or a few small stores, hooks API | most apps: small API, no provider, works outside React | few conventions, so large teams must agree on their own structure |
| Redux Toolkit 2 + React Redux 9 | one store, slices, actions, middleware | large teams wanting strict conventions, devtools time travel, RTK Query, listener middleware | more ceremony than a small app needs |
| Jotai 3 | many tiny atoms composed into derived atoms | fine-grained state graphs: editors, canvases, forms with dependent fields | state spread across many atoms is harder to see and reset as a whole |

All three use `useSyncExternalStore` under the hood and are safe with concurrent rendering. Code for each, with typing, persistence and tests: [stores.md](references/stores.md).

## Zustand store with selectors

A Zustand store is a hook created once at module scope. Components select what they need:

```ts
// src/features/editor/editor.store.ts
import { create } from 'zustand'

type EditorState = {
  zoom: number
  tool: 'select' | 'pen' | 'text'
  setTool: (tool: EditorState['tool']) => void
  zoomBy: (delta: number) => void
}

export const useEditor = create<EditorState>()((set) => ({
  zoom: 1,
  tool: 'select',
  setTool: (tool) => set({ tool }),
  zoomBy: (delta) => set((s) => ({ zoom: Math.min(8, Math.max(0.1, s.zoom + delta)) })),
}))
```

```tsx
const tool = useEditor((s) => s.tool)               // re-renders only when tool changes
const zoomBy = useEditor((s) => s.zoomBy)           // actions are stable
```

- Select primitives or stable references. A selector that returns a new object or array (`(s) => ({ a: s.a, b: s.b })`) makes Zustand 5 loop ("Maximum update depth exceeded"); wrap it with `useShallow` from `zustand/react/shallow`.
- Read outside React with `useEditor.getState()` and write with `useEditor.setState()`, for example in a keyboard shortcut handler.

## Redux Toolkit slice and typed hooks

Redux Toolkit is the standard way to write Redux: `configureStore` and `createSlice` remove the boilerplate, and Immer lets reducers "mutate" a draft safely:

```ts
import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'

const cartSlice = createSlice({
  name: 'cart',
  initialState: { items: [] as { id: string; qty: number }[] },
  reducers: {
    added(state, action: PayloadAction<string>) {
      const line = state.items.find((i) => i.id === action.payload)
      if (line) line.qty++
      else state.items.push({ id: action.payload, qty: 1 })
    },
  },
  selectors: { count: (state) => state.items.reduce((n, i) => n + i.qty, 0) },
})

export const store = configureStore({ reducer: { cart: cartSlice.reducer } })
export type RootState = ReturnType<typeof store.getState>
export const useAppDispatch = useDispatch.withTypes<typeof store.dispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
export const { added } = cartSlice.actions
export const { count } = cartSlice.selectors
```

Wrap the app in `<Provider store={store}>` from `react-redux`. For server data inside Redux use RTK Query (`createApi`) rather than thunks that copy responses into slices.

## Jotai atoms for fine-grained state

Jotai builds state from atoms; a derived atom recomputes when the atoms it reads change, and only its readers re-render:

```ts
import { atom, useAtom, useAtomValue } from 'jotai'

export const priceAtom = atom(100)
export const qtyAtom = atom(1)
export const totalAtom = atom((get) => get(priceAtom) * get(qtyAtom))
```

```tsx
const [qty, setQty] = useAtom(qtyAtom)
const total = useAtomValue(totalAtom)
```

Jotai 3 keeps the hooks API of v2, needs React 18 or newer and Node 22.12 or newer for tooling, ships ESM only, and moved `atomFamily` from `jotai/utils` to the separate `jotai-family` package.

## State in the URL

URL state is state the user expects to keep on reload, share in a link or step through with Back: filters, sort, tab, page, the selected record. Keep it in search params, not in a store:

```tsx
import { useSearchParams } from 'react-router'

const [params, setParams] = useSearchParams()
const status = params.get('status') ?? 'all'
const setStatus = (s: string) => setParams((p) => { p.set('status', s); return p })
```

Validate URL values: anything can be typed there. TanStack Router validates search params with a schema (`tanstack-router`); with React Router, parse with zod in the loader or component. For Vite apps without a router-level helper, `nuqs` provides typed search-param hooks.

## Persist state across reloads

Persisted client state (theme, layout, recent items) survives reload through `localStorage` or IndexedDB. Persist the minimum and version it:

```ts
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export const usePrefs = create<{ sidebar: boolean; toggle: () => void }>()(
  persist((set) => ({ sidebar: true, toggle: () => set((s) => ({ sidebar: !s.sidebar })) }), {
    name: 'prefs',
    version: 1,
    storage: createJSONStorage(() => localStorage),
    partialize: (s) => ({ sidebar: s.sidebar }),
  }),
)
```

- Never persist secrets or tokens to `localStorage`; any script on the page can read it.
- Bump `version` and add `migrate` when the shape changes, or old data crashes new code.
- With server rendering, persisted state differs from the server render; read it after mount or accept a hydration mismatch fix.

## Worked example: a selection store shared by a list and a toolbar

A worked example of shared client state that earns a store: rows and a toolbar far apart in the tree share the current selection. Each row subscribes to its own flag, so toggling one checkbox re-renders one row and the toolbar, and the toolbar shows the empty, busy and error states of a bulk delete:

```ts
// src/features/files/selection.store.ts
import { create } from 'zustand'

type SelectionState = {
  ids: ReadonlySet<string>
  toggle: (id: string) => void
  clear: () => void
}

export const useSelection = create<SelectionState>()((set) => ({
  ids: new Set(),
  toggle: (id) => set((s) => {
    const ids = new Set(s.ids)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    return { ids }
  }),
  clear: () => set({ ids: new Set() }),
}))
```

```tsx
// src/features/files/FileRow.tsx and SelectionBar.tsx
export function FileRow({ file }: { file: { id: string; name: string } }) {
  const selected = useSelection((s) => s.ids.has(file.id))        // a boolean: re-renders only when this row flips
  const toggle = useSelection((s) => s.toggle)
  return <li><label><input type="checkbox" checked={selected} onChange={() => toggle(file.id)} /> {file.name}</label></li>
}

export function SelectionBar({ onDelete }: { onDelete: (ids: string[]) => Promise<void> }) {
  const count = useSelection((s) => s.ids.size)
  const clear = useSelection((s) => s.clear)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function handleDelete() {
    const ids = [...useSelection.getState().ids]                    // read at the moment of the click
    if (!window.confirm(`Delete ${ids.length} files?`)) return
    setBusy(true); setError(null)
    try { await onDelete(ids); clear() } catch { setError('The files could not be deleted. Try again.') } finally { setBusy(false) }
  }
  return (
    <div role="group" aria-label="Selection actions">
      <p role="status">{count === 0 ? 'No files selected' : `${count} selected`}</p>
      <button type="button" disabled={count === 0 || busy} onClick={() => void handleDelete()}>{busy ? 'Deleting…' : 'Delete'}</button>
      <button type="button" disabled={count === 0 || busy} onClick={clear}>Clear selection</button>
      {error && <p role="alert">{error}</p>}
    </div>
  )
}
```

- The store holds ids only; the files themselves stay in the query cache, so a refetch never fights the selection.
- Clear the selection when the folder or filter changes (`useSelection.getState().clear()` in that navigation's handler), or ids from another folder get deleted.

## Verify React state

State placement is proven when a reload and Back restore what users expect, stores reset between tests, and a change re-renders only its readers. Check:

```bash
npx tsc -b && npx oxlint --deny-warnings
npx vitest run src/features/files
grep -rnE "use[A-Z][A-Za-z]*\(\(s\) => \(\{" src      # store selectors that build objects: wrap them in useShallow
```

```ts
// tests reset module-level stores, or they leak state into each other
beforeEach(() => useSelection.setState({ ids: new Set() }))

test('toggling selects and clears', () => {
  act(() => useSelection.getState().toggle('a'))
  expect(useSelection.getState().ids.has('a')).toBe(true)
  act(() => useSelection.getState().clear())
  expect(useSelection.getState().ids.size).toBe(0)
})
```

- React DevTools, "Highlight updates when components render": ticking one checkbox highlights that row and the selection bar only.
- Reload with filters applied and press Back: URL state survives the reload and Back undoes the last filter.

## Pre-merge checklist for React state

Check each point before merging state changes.

1. Each value classified: server, URL, form, local or shared client.
2. Server data in a query cache, not copied into a store.
3. Filters, tabs and selection in the URL when users expect links and Back to work.
4. Context only for rarely changing values; split state and setters when needed.
5. Store selectors return primitives or use `useShallow`.
6. Store actions do the logic; components call actions, not `setState` with business rules.
7. Persisted state is minimal, versioned and free of secrets.
8. Stores reset between tests (`react-testing`).

## Gotchas and anti-patterns in React state

Each entry gives the symptom you see, its cause and the fix.

1. **"Maximum update depth exceeded" after upgrading to Zustand 5.** Cause: a selector returns a new object or array. Fix: `useShallow`, or select fields separately.
2. **The whole app re-renders on every keystroke.** Cause: fast-changing state in a Context at the root. Fix: move it to a store with selectors, or keep it local.
3. **Data shown is stale after a mutation.** Cause: server data copied into a store and never refreshed. Fix: keep it in the query cache and invalidate.
4. **Back button does not undo a filter change.** Cause: filters in a store. Fix: search params.
5. **`import { atomFamily } from 'jotai/utils'` fails on Jotai 3.** Cause: Jotai 3 moved `atomFamily` out of the main package. Fix: `import { atomFamily } from 'jotai-family'`.
6. **State leaks between tests.** Cause: module-level stores keep their state. Fix: reset in `beforeEach` (`useStore.setState(initial, true)`) or create the store per test.
7. **Hydration warning with a persisted store.** Cause: the client reads storage during the first render. Fix: render the default first, then apply the persisted value after mount.
8. **Anti-pattern: one giant store for everything.** Symptom: unrelated features break each other, and every test needs the whole store. Cause: global by default. Fix: a small store per feature, created where it is used, and server data in the query cache.
9. **Anti-pattern: mutating store state in place (`s.ids.add(id)`).** Symptom: the store changes but nothing re-renders. Cause: the reference stayed the same. Fix: create a new value (`new Set(s.ids)`), or use Immer middleware on purpose.

## See also

- `react-data-fetching` (server state), `react-router-data-mode` and `tanstack-router` (URL state), `react-forms` (form state).
- `react-realtime`: state fed by sockets and streams.
