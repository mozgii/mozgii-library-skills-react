---
name: react-components
description: Writes React 19 function components the way React expects - pure rendering, props and children, JSX rules, keys for lists, conditional rendering, where state lives, ref as a prop, Context with the use API, Fragment refs, document metadata and resource preloading. Use when writing or reviewing any React component, splitting a component, fixing a list key warning, moving off forwardRef or class components, or when a component renders the wrong thing after an update.
metadata:
  tags:
  - react
  - components
  - jsx
  - props
  - keys
  - context
  - refs
  - react-19
---

# React components

A React component is a function that takes props and returns what the screen should look like. React calls it whenever it needs the current picture, so the function must be pure: the same props, state and context give the same JSX, and rendering changes nothing outside the component. This skill covers how to write components on React 19.3; hooks and effects are in `react-hooks-and-effects`, larger component APIs in `react-composition-patterns`.

## Step 0: confirm the React version

The React version decides which APIs exist. Read it before using anything from the 19.x line:

```bash
node -p "require('react/package.json').version"     # 19.3.1 when this was written
```

What arrived in each 19.x release (ref as a prop, `use`, Actions, `<Activity>`, `useEffectEvent`, `<ViewTransition>`, Fragment refs): [react-19-apis.md](references/react-19-apis.md).

## Rendering must be pure

Pure rendering means a component only computes JSX from its inputs. React may call it twice (Strict Mode does in development), skip it, or render it in the background, and the result must not change.

```tsx
// Wrong: mutates a module variable and a prop during render
let renders = 0
function Total({ items }: { items: Item[] }) {
  renders++
  items.sort((a, b) => a.price - b.price)
  return <p>{items.length}</p>
}

// Right: computes from inputs, copies before sorting
function Total({ items }: { items: Item[] }) {
  const sorted = items.toSorted((a, b) => a.price - b.price)
  return <p>{sorted[0]?.name}</p>
}
```

- Side effects (requests, subscriptions, timers, DOM writes, analytics) go in event handlers first, effects second (`react-hooks-and-effects`).
- Never mutate props, state or context values. Create new objects and arrays (`toSorted`, `toSpliced`, spread).
- Reading `Math.random()`, `Date.now()` or `window` during render makes output differ between renders; read them in a handler or effect, or pass them in.
- The React Compiler relies on purity. The `react-hooks/purity` and `react-hooks/immutability` lint rules flag the common breaks.

## Props and children

Props are the component's inputs: read-only, passed by the parent. Destructure them in the signature and give defaults there:

```tsx
type AvatarProps = { name: string; src?: string; size?: 'sm' | 'md' | 'lg' }

export function Avatar({ name, src, size = 'md' }: AvatarProps) {
  return src
    ? <img className={`avatar avatar-${size}`} src={src} alt={name} />
    : <span role="img" className={`avatar avatar-${size}`} aria-label={name}>{name.slice(0, 1)}</span>
}
```

`children` is a prop like any other: whatever JSX sits between the tags. A component that wraps content takes `children` instead of a dozen content props:

```tsx
export function Card({ title, children }: { title: string; children: ReactNode }) {   // import type { ReactNode } from 'react'
  return <section className="card"><h2>{title}</h2>{children}</section>
}
```

- Do not copy a prop into state (`useState(props.value)`) unless you mean "initial value"; the state will not follow later prop changes. Name such props `initialValue` or `defaultValue`.
- Object and array literals in props are new on every render. That is fine for correctness; with the React Compiler it is fine for speed too.

## JSX rules that cause bugs

JSX rules cause bugs because JSX compiles to function calls, and a few of its rules surprise people:

- One root per return; wrap siblings in `<>…</>` (a Fragment).
- `className`, `htmlFor`, camelCase events (`onClick`) and camelCase styles (`style={{ marginTop: 8 }}`).
- `{count && <Badge />}` renders `0` when `count` is 0. Write `{count > 0 && <Badge />}` or a ternary.
- Components start with a capital letter; `<item />` is treated as an HTML tag.
- Never define a component inside another component. Its identity changes on every render, so React unmounts and remounts it and loses its state (`react-hooks/static-components` flags it).

### A stray 0 on the page when a list is empty

A stray `0` on the page comes from a number before `&&`: `{items.length && <List />}` renders `0` when the list is
empty, because `0` is a value React draws. Write `{items.length > 0 && <List />}` or a ternary.

### An input loses focus every time you type

An input that loses focus on every keystroke is being unmounted and mounted again. The usual causes are a component
defined inside another component, or a list key that changes on each render (an index after a sort, `Math.random()`).
Define components at module level and give list items a stable key from the data.

## Keys for lists

A key tells React which item is which between renders, so it can keep state and DOM with the right item. Use a stable id from the data:

```tsx
<ul>
  {todos.map((todo) => <TodoRow key={todo.id} todo={todo} />)}
</ul>
```

- Array index keys break when items are inserted, removed or reordered: the state of row 2 moves to whatever item is now at index 2. Index keys are acceptable only for static lists that never change order.
- Keys must be unique among siblings, not globally.
- Generating keys during render (`key={crypto.randomUUID()}`) remounts every row on every render. Create ids when the data is created.
- A key on a component resets it: `<ProfileForm key={userId} userId={userId} />` gives each user a fresh form state with no effect needed.

## Conditional rendering and early returns

Conditional rendering picks what to show from state and props. Return early for whole-component states, and use ternaries inside JSX for small branches:

```tsx
function OrderPanel({ order }: { order: Order | undefined }) {
  if (!order) return <EmptyState title="No order selected" />
  return (
    <article>
      <h2>Order {order.number}</h2>
      {order.status === 'paid' ? <PaidBadge /> : <PayButton orderId={order.id} />}
    </article>
  )
}
```

Every data-driven view has loading, empty, error and success states. Design all four; the `react-data-fetching` skill shows how a query gives you each one.

## Where state lives

State belongs in the closest common parent of every component that reads it. Start local, lift when a sibling needs it, and move it out of the tree (URL, server cache, store) only when its scope demands:

| The value | Put it in | Why the other places lose |
|---|---|---|
| Used by one component | `useState` in that component | lifting it re-renders the parent and couples siblings for nothing |
| Shared by siblings | the parent, passed down as props | Context or a store hides a data flow that two props show plainly |
| Derived from other state or props | compute it during render, never store it | a stored copy drifts and needs an effect to resync, one render late |
| Should survive reload or be linkable (tab, filter, page) | the URL (`react-router-data-mode`, `tanstack-router`) | component state is lost on reload, and Back does not undo it |
| Comes from a server | a query cache (`react-data-fetching`) | a `useState` copy never refetches, dedupes or invalidates |
| Read by many distant components | Context or a store (`react-state-management`) | props through layers that do not use them make every move a refactor |

## Refs as a prop in React 19

A ref gives access to a DOM node or an imperative handle. In React 19 a function component receives `ref` as a regular prop, so `forwardRef` is no longer needed:

```tsx
import { useId, type ComponentProps, type Ref } from 'react'

export function TextField({ label, ref, ...props }: { label: string; ref?: Ref<HTMLInputElement> } & ComponentProps<'input'>) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} ref={ref} {...props} />
    </div>
  )
}
```

- A ref callback may return a cleanup function, which React calls when the node detaches: `ref={(node) => { if (!node) return; const ro = new ResizeObserver(cb); ro.observe(node); return () => ro.disconnect() }}`.
- `forwardRef` still works and will be deprecated later; new code passes `ref` as a prop.
- Do not read or write `ref.current` during render; refs are for handlers and effects (`react-hooks/refs`).

## Context with the use API

Context passes a value to a whole subtree without threading props. In React 19 you render the context itself as the provider and read it with `use`, which, unlike `useContext`, may be called inside conditions and loops:

```tsx
import { createContext, use } from 'react'

export const ThemeContext = createContext<'light' | 'dark'>('light')

export function App({ children }: { children: React.ReactNode }) {
  return <ThemeContext value="dark">{children}</ThemeContext>
}

function Icon({ decorative }: { decorative: boolean }) {
  if (decorative) return null
  const theme = use(ThemeContext)
  return <svg data-theme={theme} />
}
```

- `<ThemeContext.Provider>` still works; new code renders `<ThemeContext value>`.
- Every consumer re-renders when the value changes. Split contexts by how often they change (state and dispatch apart), and see `react-state-management` before using Context as a global store.

## Fragment refs in React 19.3

A Fragment ref gives a `FragmentInstance` that acts on the Fragment's first-level DOM children without adding a wrapper element. It is stable from React 19.3:

```tsx
import { Fragment, useEffect, useRef, type FragmentInstance } from 'react'

function Toolbar({ children }: { children: React.ReactNode }) {
  const group = useRef<FragmentInstance>(null)
  useEffect(() => { group.current?.focus() }, [])      // focus the first focusable child
  return <Fragment ref={group}>{children}</Fragment>
}
```

`focus()` and the other DOM members come from an augmentation in the root of `@types/react-dom`. A project that imports only `react-dom/client` never loads it and gets TS2339, `Property 'focus' does not exist on type 'FragmentInstance'`. Add `"react-dom"` to `compilerOptions.types` in `tsconfig.app.json` (for the Vite template: `"types": ["vite/client", "react-dom"]`).

The instance has `addEventListener`, `removeEventListener`, `dispatchEvent`, `focus`, `focusLast`, `blur`, `observeUsing` and `unobserveUsing` (an `IntersectionObserver` or `ResizeObserver`), `getClientRects`, `getRootNode`, `compareDocumentPosition` and `scrollIntoView`. Use it in libraries that must not add DOM, such as focus groups and visibility tracking.

## Document metadata and resource hints

React 19 hoists `<title>`, `<meta>` and `<link>` rendered anywhere in the tree into `<head>`, so a page component can set its own title:

```tsx
function InvoicePage({ invoice }: { invoice: Invoice }) {
  return (
    <>
      <title>{`Invoice ${invoice.number}`}</title>
      <meta name="description" content={`Invoice for ${invoice.customer}`} />
      <InvoiceView invoice={invoice} />
    </>
  )
}
```

`react-dom` also exports `preload`, `preinit`, `preconnect` and `prefetchDNS` for resource hints: `preload('/fonts/inter.woff2', { as: 'font', type: 'font/woff2' })` inside a component starts the download early. `<link rel="stylesheet" href="…" precedence="default" />` lets React order and deduplicate stylesheets.

## Server Components and frameworks

React Server Components run on a server or at build time and send rendered output to the client; they need a framework or bundler integration (React Router framework mode, Next.js, Vite's RSC plugin). In a client-rendered Vite app every component is a client component, and the `'use client'` and `'use server'` directives do nothing. Code copied from an RSC framework must drop server-only parts (async components, direct database calls) and fetch through the patterns in `react-data-fetching`.

## Worked example: a list component with every state

A production list component takes its state as one discriminated union, so loading, error, empty and success cannot overlap, and it stays presentational: a parent maps a query result into `state` (`react-data-fetching`). It names its region, announces loading and errors, keys rows by id and uses real buttons:

```tsx
// src/features/contacts/ContactList.tsx
import { useId, type ReactNode } from 'react'

export type Contact = { id: string; name: string; email: string }
export type ContactListState =
  | { status: 'loading' }
  | { status: 'error'; message: string; onRetry: () => void }
  | { status: 'success'; contacts: readonly Contact[] }

type ContactListProps = {
  title: string
  state: ContactListState
  selectedId?: string
  onSelect: (id: string) => void
  emptyAction?: ReactNode
}

export function ContactList({ title, state, selectedId, onSelect, emptyAction }: ContactListProps) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} aria-busy={state.status === 'loading'}>
      <h2 id={headingId}>{title}</h2>
      {state.status === 'loading' && <p role="status">Loading contacts…</p>}
      {state.status === 'error' && (
        <div role="alert">
          <p>Contacts could not be loaded. {state.message}</p>
          <button type="button" onClick={state.onRetry}>Try again</button>
        </div>
      )}
      {state.status === 'success' && state.contacts.length === 0 && (
        <div className="empty"><p>No contacts yet.</p>{emptyAction}</div>
      )}
      {state.status === 'success' && state.contacts.length > 0 && (
        <ul>
          {state.contacts.map((contact) => (
            <li key={contact.id}>
              <button type="button" aria-pressed={contact.id === selectedId} onClick={() => onSelect(contact.id)}>
                <span aria-hidden="true" className="avatar">{contact.name.slice(0, 1)}</span>
                <span>{contact.name}</span> <span className="muted">{contact.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

- `aria-busy` and `role="status"` tell screen readers the list is loading; `role="alert"` announces the failure with its retry.
- The avatar letter is `aria-hidden`, so each button's accessible name is the contact's name and email, not a stray initial.
- Every branch is a pure function of props; the component needs no effect and no state of its own.

## Verify a React component

A component is proven when the type check and the Rules of React lint pass and a test renders each of its states by role. Run:

```bash
npx tsc -b                                  # props and union states type-check
npx oxlint --deny-warnings                  # react/purity, react/static-components, react/jsx-key, react/refs
npx vitest run src/features/contacts        # the state tests below
```

```tsx
// src/features/contacts/ContactList.test.tsx
const contacts = [{ id: 'c1', name: 'Ada Lovelace', email: 'ada@example.com' }]

test('shows each state', async () => {
  const onRetry = vi.fn()
  const { rerender } = render(<ContactList title="Contacts" state={{ status: 'loading' }} onSelect={vi.fn()} />)
  expect(screen.getByRole('status')).toHaveTextContent('Loading contacts')
  rerender(<ContactList title="Contacts" state={{ status: 'error', message: 'Offline.', onRetry }} onSelect={vi.fn()} />)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
  expect(onRetry).toHaveBeenCalledOnce()
  rerender(<ContactList title="Contacts" state={{ status: 'success', contacts: [] }} onSelect={vi.fn()} />)
  expect(screen.getByText('No contacts yet.')).toBeInTheDocument()
  rerender(<ContactList title="Contacts" state={{ status: 'success', contacts }} onSelect={vi.fn()} />)
  expect(screen.getByRole('button', { name: /Ada Lovelace/ })).toHaveAttribute('aria-pressed', 'false')
})
```

- In the browser console: no `Each child in a list should have a unique key` warning and no Strict Mode surprises.
- In React DevTools, "Highlight updates when components render" shows only the changed row re-rendering on select.

## Pre-merge checklist for a React component

Check each point before merging a component.

1. Renders purely: no mutation of props, state, context or module variables; no side effects in the body.
2. Props typed and destructured with defaults; `children` used for wrapped content.
3. Lists keyed by stable ids from the data.
4. Loading, empty, error and success states all handled where data is involved.
5. State placed in the closest common parent; derived values computed, not stored.
6. `ref` taken as a prop, no new `forwardRef`; refs untouched during render.
7. No component defined inside another component.
8. The linter (`react/*` or `react-hooks/*` rules) passes, and a test covers each state.

## Gotchas and anti-patterns in React components

Each entry gives the symptom you see, its cause and the fix. Error messages by name (`Objects are not valid as a React child`, "Too many re-renders"): `react-debugging`.

1. **A stray `0` appears on screen.** Cause: `{items.length && <List />}` with an empty array. Fix: compare explicitly, `items.length > 0 &&`.
2. **Typing in an input loses focus after each key.** Cause: the input's component is defined inside its parent, so it remounts. Fix: move the component to module scope.
3. **Row state jumps to another row after a delete.** Cause: index keys. Fix: `key={item.id}`.
4. **A child does not update when its prop changes.** Cause: the prop was copied into `useState`. Fix: use the prop directly, or reset with a `key`.
5. **`Each child in a list should have a unique key` with keys present.** Cause: the key is on an inner element instead of the outermost element returned by `map`. Fix: move `key` to the outermost element, or to the `<Fragment key>` that wraps the row.
6. **`useContext` returns the default value.** Cause: the consumer is outside the provider, or two copies of the module (and so two contexts) exist. Fix: check the tree in React DevTools; deduplicate the package.
7. **Effects or renders run twice in development.** Cause: Strict Mode, on purpose. Fix: add the missing cleanup it reveals; do not remove `StrictMode`.
8. **Anti-pattern: a component with a dozen boolean props.** Symptom: every new screen adds another flag, and some combinations render nonsense. Cause: configuration instead of composition. Fix: children, slots or separate components (`react-composition-patterns`).
9. **Anti-pattern: an effect that copies props into state.** Symptom: the screen shows the old value for one frame, or never updates. Cause: derived data stored and synced. Fix: compute it during render, or reset with a `key` (`react-hooks-and-effects`).

## See also

- `react-hooks-and-effects`, `react-composition-patterns`, `react-typescript`, `react-data-fetching`.
- `react-server-components`: async components, `'use client'` and server rendering, which this client-side skill leaves out.
- `react-debugging`: error messages by name.
