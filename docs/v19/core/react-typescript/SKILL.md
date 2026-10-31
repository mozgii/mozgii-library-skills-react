---
name: react-typescript
description: Types React 19 code with TypeScript - component props, children and ReactNode, extending native element props with ComponentProps, ref as a prop, event handler types, useState and useReducer inference, discriminated unions for variant props, generic components, typed context with a guard hook, custom hook return types, and safe typing of external data. Use when writing or reviewing typed React components, fixing a TypeScript error in JSX, typing an event, ref, context or generic list, or migrating from React.FC, forwardRef or PropTypes.
metadata:
  tags:
  - react
  - typescript
  - props
  - generics
  - events
  - refs
  - types
---

# React with TypeScript

TypeScript makes React components self-documenting and catches wrong props at the call site. This skill covers typing patterns for React 19.3 with `@types/react` 19.3 and TypeScript 7 (the native compiler; TypeScript 6.0 behaves the same for everything here). Project config (`strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`) is in `react-project-setup`.

## Step 0: read the installed TypeScript and React types

The React types decide which props and APIs type-check, so read them with the compiler version, from the project root:

```bash
node -p "['typescript','@types/react','@types/react-dom','react'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `typescript` 7.0.2, `@types/react` 19.3.0, `@types/react-dom` 19.3.0, `react` 19.3.1. Keep `@types/react` on the same major as `react`; the 19.3 APIs (`ViewTransition`, Fragment refs) need both packages. `@types/react` 19.3 declares `ViewTransitionInstance` and `FragmentInstance` nearly empty, and the root of `@types/react-dom` 19.3 adds their DOM members. Importing only `react-dom/client` does not load that root, so `group.current.focus()` and `instance.new` fail with TS2339: add `"react-dom"` to `compilerOptions.types`, as in `"types": ["vite/client", "react-dom"]`.

## Choose the type for the job

Choosing a React type is mostly choosing how wide it is: too wide hides bugs, too narrow rejects valid callers. Use this table before reaching for `any` or a cast:

| You are typing | Use | Why the alternatives lose |
|---|---|---|
| Anything a caller may render inside | `ReactNode` | `JSX.Element` and `ReactElement` reject strings, numbers, `null` and arrays |
| Exactly one element child (for `asChild`) | `ReactElement` | `ReactNode` lets through a string that cannot receive props |
| A component passed as a prop | `ComponentType<Props>` | `ReactNode` is rendered output, not something you can render with props |
| A wrapper around a native element | `ComponentProps<'button'>` plus your own props | listing HTML props by hand misses `aria-*`, events and `ref` |
| The props of another component | `ComponentProps<typeof Other>` | a copied props type drifts from the original |
| A ref | a `ref?: Ref<T>` prop | `forwardRef` adds a wrapper and breaks generic components |
| A callback prop | the domain signature, `(id: string) => void` | passing the DOM event leaks markup details to every caller |
| Props that depend on each other | a discriminated union | optional props allow combinations that make no sense |
| A list, select or table | a generic component over `T` | `any` or `unknown` items lose the type in every callback |
| Data from the network or storage | a schema and `z.infer` | an `as` cast compiles and fails at runtime when the API changes |
| The component itself | a plain function with typed props | `React.FC` adds nothing in React 19, hides the return type and blocks generics |

## Type props with a type alias

Props are an object type on the function's parameter. Destructure with defaults; skip `React.FC`, which adds nothing in React 19 and hides the return type:

```tsx
type BadgeProps = {
  label: string
  tone?: 'neutral' | 'success' | 'danger'
  count?: number
}

export function Badge({ label, tone = 'neutral', count }: BadgeProps) {
  return <span className={`badge badge-${tone}`}>{label}{count !== undefined && ` (${count})`}</span>
}
```

- `type` and `interface` both work; pick one per codebase. `type` composes unions and intersections more directly.
- Optional props (`?`) plus a default in the destructuring give a non-optional value inside the body.
- With `exactOptionalPropertyTypes`, passing `undefined` explicitly to an optional prop is an error unless the type says `| undefined`.

## Children and ReactNode

`children` is typed as `ReactNode` when a component accepts anything renderable: elements, strings, numbers, arrays, `null`, `undefined`, booleans:

```tsx
import type { ReactNode, ReactElement } from 'react'

type PanelProps = { title: string; children: ReactNode; footer?: ReactNode }
type OnlyOneChild = { children: ReactElement }            // exactly one element, e.g. for asChild
```

`JSX.Element` is narrower (one element only) and best avoided for props. Do not try to type which component a child must be; TypeScript cannot enforce it for JSX.

## Extend native element props with ComponentProps

A wrapper around a native element should accept all of that element's props, including `ref` in React 19. `ComponentProps<'button'>` gives them:

```tsx
import type { ComponentProps } from 'react'

type ButtonProps = ComponentProps<'button'> & { variant?: 'primary' | 'secondary' }

export function Button({ variant = 'primary', className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`btn btn-${variant} ${className ?? ''}`} {...props} />
}
```

- `ComponentProps<typeof OtherComponent>` gets another component's props, useful for wrappers.
- `ComponentPropsWithoutRef<'input'>` excludes `ref` when a wrapper must not forward it.
- `Omit<ComponentProps<'input'>, 'size'> & { size?: 'sm' | 'md' }` replaces a native prop with your own meaning.

## Ref as a prop

In React 19 a function component receives `ref` like any prop. Type it with `Ref<T>` for the element it lands on:

```tsx
import type { Ref } from 'react'

type SearchInputProps = { ref?: Ref<HTMLInputElement>; onSearch: (q: string) => void }

export function SearchInput({ ref, onSearch }: SearchInputProps) {
  return <input ref={ref} type="search" onChange={(e) => onSearch(e.currentTarget.value)} />
}

// caller
const input = useRef<HTMLInputElement>(null)        // RefObject<HTMLInputElement | null>
<SearchInput ref={input} onSearch={setQuery} />
```

`useRef<T>(null)` returns `RefObject<T | null>` in `@types/react` 19, and `useRef` requires an argument. For an imperative handle, type the ref with the handle's interface: `Ref<{ focus(): void; reset(): void }>`.

## Event handler types

Event types come from React, parameterized by the element. Inline handlers infer them; named handlers need the type:

```tsx
import type { ChangeEvent, FormEvent, KeyboardEvent, MouseEvent } from 'react'

function handleChange(e: ChangeEvent<HTMLInputElement>) { setName(e.currentTarget.value) }
function handleSubmit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); save(new FormData(e.currentTarget)) }
function handleKey(e: KeyboardEvent<HTMLDivElement>) { if (e.key === 'Escape') close() }
function handleClick(e: MouseEvent<HTMLButtonElement>) { if (e.shiftKey) selectRange() }
```

- Use `e.currentTarget` (the element the handler is on, typed) rather than `e.target` (whatever was clicked, typed as `EventTarget`).
- For a prop, type the callback by what it means, not the DOM event: `onSelect: (id: string) => void`, so callers need no event.
- `ComponentProps<'input'>['onChange']` reuses the exact native handler type.

## useState and useReducer inference

`useState` and `useReducer` infer their types from the initial value. Give a type argument when the initial value does not cover all states:

```tsx
const [count, setCount] = useState(0)                                  // number
const [user, setUser] = useState<User | null>(null)                     // null until loaded
const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
```

For `useReducer`, type the reducer's state and action; the hook infers from the reducer. A discriminated union of actions makes `switch (action.type)` narrow `action` in each branch, and a `never` check catches unhandled actions:

```ts
function assertNever(x: never): never { throw new Error(`Unhandled: ${JSON.stringify(x)}`) }
// default: return assertNever(action)
```

## Discriminated unions for variant props

When props depend on each other, a union of object types makes invalid combinations impossible:

```tsx
type LinkOrButton =
  | { as: 'link'; href: string; onClick?: never }
  | { as: 'button'; onClick: () => void; href?: never }

type ActionProps = LinkOrButton & { label: string }

export function Action(props: ActionProps) {
  return props.as === 'link'
    ? <a href={props.href}>{props.label}</a>
    : <button type="button" onClick={props.onClick}>{props.label}</button>
}
```

The same pattern types async state: `{ status: 'loading' } | { status: 'error'; error: Error } | { status: 'done'; data: T }`.

## Generic components

A generic component keeps the item type of a list, select or table, so callbacks receive the real type:

```tsx
type ListProps<T> = {
  items: readonly T[]
  getKey: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  onSelect?: (item: T) => void
}

export function List<T>({ items, getKey, renderItem, onSelect }: ListProps<T>) {
  return (
    <ul>
      {items.map((item) => (
        <li key={getKey(item)}>
          {onSelect ? <button type="button" onClick={() => onSelect(item)}>{renderItem(item)}</button> : renderItem(item)}
        </li>
      ))}
    </ul>
  )
}

<List items={users} getKey={(u) => u.id} renderItem={(u) => u.name} onSelect={(u) => open(u.id)} />   // u: User
```

In a `.tsx` file an arrow function generic needs a trailing comma (`<T,>(props: ListProps<T>) => …`) so it is not read as JSX; function declarations avoid the issue.

## Typed context with a guard hook

A context whose default is `null` plus a hook that throws outside the provider gives consumers a non-null type:

```tsx
type AuthValue = { user: User; signOut: () => Promise<void> }
const AuthContext = createContext<AuthValue | null>(null)

export function useAuth(): AuthValue {
  const value = use(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
```

## Custom hook return types

Return a tuple `as const` when callers rename the parts, an object when there are more than two:

```ts
export function useToggle(initial = false) {
  const [on, setOn] = useState(initial)
  return [on, () => setOn((v) => !v)] as const          // readonly [boolean, () => void]
}
```

Without `as const` the tuple widens to `(boolean | (() => void))[]` and destructuring loses the types.

## Type external data at the boundary

Data from the network, storage, URL or `postMessage` is `unknown` until checked. A cast (`as User`) only silences the compiler. Parse with a schema at the boundary and let types flow from it:

```ts
const User = z.object({ id: z.string(), name: z.string(), role: z.enum(['admin', 'member']) })
type User = z.infer<typeof User>
const user = User.parse(await res.json())
```

## Worked example: a typed generic select with loading and error states

A worked example that combines the patterns: a generic select whose option state is a discriminated union, so loading, error, empty and ready render differently and callers get their own item type back in `onChange`. It is labelled, links its error message and works with `exactOptionalPropertyTypes`:

```tsx
// src/shared/ui/SelectField.tsx
import { useId } from 'react'

export type OptionsState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; options: readonly T[] }

type SelectFieldProps<T> = {
  label: string
  state: OptionsState<T>
  getKey: (option: T) => string
  getLabel: (option: T) => string
  value: T | null
  onChange: (option: T | null) => void
  error?: string | undefined                       // `| undefined` lets callers pass a conditional value
}

export function SelectField<T>({ label, state, getKey, getLabel, value, onChange, error }: SelectFieldProps<T>) {
  const id = useId()
  const options = state.status === 'ready' ? state.options : []
  const message = state.status === 'error' ? state.message : error
  const placeholder = state.status === 'loading' ? 'Loading…' : options.length === 0 ? 'Nothing to choose yet' : 'Choose…'
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value !== null ? getKey(value) : ''} disabled={options.length === 0} aria-busy={state.status === 'loading'}
        aria-invalid={message ? true : undefined} aria-describedby={message ? `${id}-error` : undefined}
        onChange={(e) => onChange(options.find((o) => getKey(o) === e.currentTarget.value) ?? null)}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={getKey(o)} value={getKey(o)}>{getLabel(o)}</option>)}
      </select>
      {message && <p id={`${id}-error`} role="alert" className="error">{message}</p>}
    </div>
  )
}
```

```tsx
// caller: T is inferred as Project from the state, so `setProject` must accept Project | null
const projects = useQuery(projectQueries.list())
const state: OptionsState<Project> = projects.isPending ? { status: 'loading' }
  : projects.isError ? { status: 'error', message: 'Projects could not be loaded' }
  : { status: 'ready', options: projects.data }
<SelectField label="Project" state={state} getKey={(p) => p.id} getLabel={(p) => p.name} value={project} onChange={setProject} />
```

## Verify typed React code

Typed code is proven when the checker passes with the strict flags, invalid calls are kept as errors on purpose, and no casts hide unchecked data. Run:

```bash
npx tsc -b                                                     # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
grep -rnE ': any\b|as any\b|as unknown as|@ts-ignore' src      # every hit needs a reason or a fix
time npx tsc -b --force                                        # watch check time when generics or typed keys grow
```

Type-level tests live in ordinary test files: `tsc` checks them, Vitest runs them as no-ops.

```ts
// src/shared/ui/SelectField.types.test.tsx
import { expectTypeOf, test } from 'vitest'
import type { ComponentProps } from 'react'

test('SelectField keeps the item type', () => {
  type Props = ComponentProps<typeof SelectField<{ id: string }>>
  expectTypeOf<Props['onChange']>().parameter(0).toEqualTypeOf<{ id: string } | null>()
})
// @ts-expect-error: a link Action must not take onClick
const invalid = <Action as="link" href="/x" onClick={() => {}} label="x" />
```

## Pre-merge checklist for typed React code

Check each point before merging typed React code.

1. Props typed on the parameter; no `React.FC`, no `PropTypes`, no `defaultProps`.
2. `children: ReactNode` for wrapped content.
3. Wrappers of native elements extend `ComponentProps<'el'>` and pass `...props` and `ref` through.
4. Named handlers typed with React event types and `currentTarget`.
5. `useState` given a type argument whenever the initial value is narrower than the state.
6. Dependent props modelled as discriminated unions.
7. Lists, selects and tables generic over their item type.
8. External data parsed with a schema; no `as` casts on `unknown`.

## Gotchas and anti-patterns in React with TypeScript

Each entry gives the symptom you see, its cause and the fix.

1. **`Property 'value' does not exist on type 'EventTarget'`.** Cause: `e.target` instead of `e.currentTarget`. Fix: use `currentTarget`, or type the event with its element.
2. **`useRef()` with no argument is an error.** Cause: `@types/react` 19 requires an initial value. Fix: `useRef<HTMLDivElement>(null)` or `useRef<number | undefined>(undefined)`.
3. **`JSX element type does not have any construct or call signatures`.** Cause: a component type stored as `ReactNode`. Fix: `ComponentType<Props>` for components, `ReactNode` for rendered output.
4. **A generic arrow component does not parse.** Cause: `<T>` in `.tsx` reads as JSX. Fix: `<T,>` or a function declaration.
5. **`never[]` from `useState([])`.** Cause: an empty array infers `never[]`. Fix: `useState<Item[]>([])`.
6. **Global `JSX` namespace not found.** Cause: React 19 types moved it to `React.JSX`. Fix: `React.JSX.Element` or import `type JSX` from `react`.
7. **`enum` is rejected.** Cause: `erasableSyntaxOnly`. Fix: a union of string literals.
8. **`Omit<ActionProps, 'label'>` accepts invalid combinations.** Cause: `Omit` over a union merges the members, so the discriminant stops narrowing. Fix: a distributive omit, `type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never`.
9. **`Type 'undefined' is not assignable` when passing `error={cond ? msg : undefined}`.** Cause: `exactOptionalPropertyTypes` separates "missing" from "undefined". Fix: declare `error?: string | undefined`, or spread the prop only when set.
10. **Anti-pattern: `as User` on `await res.json()`.** Symptom: the app crashes deep in a component when the API changes a field. Cause: the cast told the checker to trust unchecked data. Fix: parse with a schema at the boundary.
11. **Anti-pattern: typing a callback prop with the DOM event.** Symptom: callers build fake events in tests and other components. Cause: `onSelect: (e: MouseEvent) => void` exposes markup. Fix: `onSelect: (id: string) => void`.

## See also

- `react-components`, `react-composition-patterns` (polymorphic and compound APIs), `react-forms` (schemas shared with forms).
- `react-project-setup`: the tsconfig flags this skill relies on.
