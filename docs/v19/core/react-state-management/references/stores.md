---
title: Zustand, Redux Toolkit and Jotai recipes
author: MOZGII, Inc.
lang: en
---

# Zustand, Redux Toolkit and Jotai recipes

Working code for the three common React client stores at Zustand 5.0, Redux Toolkit 2.13 with React Redux 9.3, and Jotai 3.0: slices, derived values, async actions, middleware and tests.

## Contents

This page, Zustand, Redux Toolkit and Jotai recipes, has these sections.

1. Zustand: slices pattern
2. Zustand: useShallow for several fields
3. Zustand: store per component tree with context
4. Zustand: devtools and immer middleware
5. Redux Toolkit: async work with createAsyncThunk or listeners
6. Redux Toolkit: RTK Query for server data
7. Jotai: async and writable derived atoms
8. Resetting stores in tests

## Zustand slices pattern

The slices pattern splits a large Zustand store into feature slices typed against the whole store, then combines them in one `create` call:

```ts
import { create, type StateCreator } from 'zustand'

type LayoutSlice = { sidebar: boolean; toggleSidebar: () => void }
type SelectionSlice = { selected: string[]; select: (id: string) => void; clear: () => void }
type Store = LayoutSlice & SelectionSlice

const layout: StateCreator<Store, [], [], LayoutSlice> = (set) => ({
  sidebar: true,
  toggleSidebar: () => set((s) => ({ sidebar: !s.sidebar })),
})

const selection: StateCreator<Store, [], [], SelectionSlice> = (set) => ({
  selected: [],
  select: (id) => set((s) => ({ selected: s.selected.includes(id) ? s.selected : [...s.selected, id] })),
  clear: () => set({ selected: [] }),
})

export const useStore = create<Store>()((...a) => ({ ...layout(...a), ...selection(...a) }))
```

## Zustand useShallow for several fields

`useShallow` compares a selector's result shallowly, so returning an object or array of several fields does not re-render (or loop) when the fields are unchanged:

```tsx
import { useShallow } from 'zustand/react/shallow'

const { sidebar, toggleSidebar } = useStore(useShallow((s) => ({ sidebar: s.sidebar, toggleSidebar: s.toggleSidebar })))
const ids = useStore(useShallow((s) => s.selected.slice(0, 10)))
```

## Zustand store per component tree with context

A module-level store is a singleton shared by every instance. When each instance of a widget (two editors on one page) needs its own store, create a vanilla store per instance and hand it down through context:

```tsx
import { createStore, useStore } from 'zustand'
import { createContext, use, useState, type ReactNode } from 'react'

type Counter = { count: number; inc: () => void }
const createCounter = (start: number) => createStore<Counter>()((set) => ({ count: start, inc: () => set((s) => ({ count: s.count + 1 })) }))
const CounterContext = createContext<ReturnType<typeof createCounter> | null>(null)

export function CounterProvider({ start = 0, children }: { start?: number; children: ReactNode }) {
  const [store] = useState(() => createCounter(start))
  return <CounterContext value={store}>{children}</CounterContext>
}

export function useCounter<T>(selector: (s: Counter) => T): T {
  const store = use(CounterContext)
  if (!store) throw new Error('useCounter must be used inside CounterProvider')
  return useStore(store, selector)
}
```

This is also the pattern for server rendering, where a module-level store would leak state between requests.

## Zustand devtools and immer middleware

Middleware wraps the state creator. `devtools` connects to the Redux DevTools extension; `immer` lets updates mutate a draft:

```ts
import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'

type Todos = { items: { id: string; done: boolean }[]; toggle: (id: string) => void }

export const useTodos = create<Todos>()(
  devtools(
    immer((set) => ({
      items: [],
      toggle: (id) => set((s) => { const t = s.items.find((i) => i.id === id); if (t) t.done = !t.done }),
    })),
    { name: 'todos' },
  ),
)
```

`immer` must be installed (`npm i immer`); it is an optional peer of Zustand.

## Redux Toolkit async work with createAsyncThunk or listeners

`createAsyncThunk` dispatches pending, fulfilled and rejected actions around a promise; the listener middleware runs side effects in response to actions, which replaces most saga and observable use:

```ts
import { createAsyncThunk, createListenerMiddleware } from '@reduxjs/toolkit'

export const saveDraft = createAsyncThunk('editor/save', async (text: string, { signal }) => {
  const res = await fetch('/api/drafts', { method: 'POST', body: JSON.stringify({ text }), signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as { id: string }
})

export const listener = createListenerMiddleware()
listener.startListening({
  actionCreator: textChanged,
  effect: async (action, api) => {
    api.cancelActiveListeners()             // debounce: only the last change saves
    await api.delay(800)
    await api.dispatch(saveDraft(action.payload))
  },
})
// configureStore({ reducer, middleware: (gDM) => gDM().prepend(listener.middleware) })
```

## Redux Toolkit RTK Query for server data

RTK Query is Redux Toolkit's data fetching and caching layer. Use it instead of thunks when the app already uses Redux; otherwise TanStack Query covers the same ground (`react-data-fetching`):

```ts
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react'

export const api = createApi({
  reducerPath: 'api',
  baseQuery: fetchBaseQuery({ baseUrl: '/api' }),
  tagTypes: ['Invoice'],
  endpoints: (build) => ({
    invoices: build.query<Invoice[], void>({ query: () => 'invoices', providesTags: ['Invoice'] }),
    payInvoice: build.mutation<Invoice, string>({ query: (id) => ({ url: `invoices/${id}/pay`, method: 'POST' }), invalidatesTags: ['Invoice'] }),
  }),
})
export const { useInvoicesQuery, usePayInvoiceMutation } = api
// configureStore({ reducer: { [api.reducerPath]: api.reducer }, middleware: (gDM) => gDM().concat(api.middleware) })
```

## Jotai async and writable derived atoms

A Jotai atom can read async data (it suspends) and a derived atom can be writable, turning a write into updates of other atoms:

```ts
import { atom } from 'jotai'

export const userIdAtom = atom('u1')
export const userAtom = atom(async (get, { signal }) => {
  const res = await fetch(`/api/members/${get(userIdAtom)}`, { signal })
  return (await res.json()) as User
})

export const celsiusAtom = atom(20)
export const fahrenheitAtom = atom(
  (get) => get(celsiusAtom) * 9 / 5 + 32,
  (_get, set, f: number) => set(celsiusAtom, (f - 32) * 5 / 9),
)
```

A component reading `userAtom` must sit under a `<Suspense>` boundary. For server data with caching and invalidation, TanStack Query (and `jotai-tanstack-query`) is the better tool.

## Resetting stores in tests

Module-level stores keep state between tests in the same file. Reset them in a setup file:

```ts
// Zustand: capture the initial state once and restore it
const initial = useStore.getState()
beforeEach(() => useStore.setState(initial, true))

// Redux: build a fresh store per test
function renderWithStore(ui: React.ReactElement, preloadedState?: Partial<RootState>) {
  const store = configureStore({ reducer, preloadedState })
  return { store, ...render(<Provider store={store}>{ui}</Provider>) }
}

// Jotai: a fresh Provider (its own store) per render
render(<Provider><Counter /></Provider>)
```
