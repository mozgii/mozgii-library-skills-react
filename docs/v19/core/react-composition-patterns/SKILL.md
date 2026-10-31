---
name: react-composition-patterns
description: Designs reusable React component APIs with composition - children and slots instead of many props, explicit variants instead of boolean flags, compound components sharing state through context, controlled and uncontrolled props, headless hooks, asChild-style polymorphism and provider interfaces. Use when a component has grown many boolean or render props, when building a component library or design system part, when two screens need the same widget with small differences, or when reviewing a component's API.
metadata:
  tags:
  - react
  - composition
  - compound-components
  - design-system
  - controlled
  - headless
  - api-design
---

# React composition patterns

Composition builds big components from small ones that the caller arranges, instead of one component with a prop for every variation. A component with fifteen props, eight of them booleans, has thousands of combinations nobody tested; a set of composable parts has a few that each make sense. This skill shows the patterns that keep component APIs small on React 19.3.

## Step 0: read the installed React and headless library versions

Ref as a prop (no `forwardRef`) needs React 19, and `asChild` comes from Radix while Base UI uses a `render` prop, so read what the project has, from its root:

```bash
node -p "['react','@types/react','radix-ui','@base-ui/react'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `react` 19.3.1, `@types/react` 19.3.0, `radix-ui` 1.8.1, `@base-ui/react` 1.9.0. On React 18, keep `forwardRef` where this skill passes `ref` as a prop.

## Choose a composition pattern

Choosing a composition pattern starts from what varies between the places a component is used. Pick the first row that fits; each later row costs more API surface:

| What varies | Pattern | Why the alternatives lose |
|---|---|---|
| The content (title, icon, buttons) | `children` or slot props | a text or icon prop per need grows without end and still cannot hold a link or a badge |
| The look, with the same structure | one union `variant` prop | separate components duplicate markup that only differs in classes |
| The structure (thread composer vs edit composer) | separate components built from shared parts | a boolean per mode multiplies into combinations nobody tested |
| Several parts share state, the caller arranges them | compound components over a private context | prop drilling couples every part to the parent's props |
| Who owns a value (parent or the component) | a controlled and uncontrolled pair (`value`, `defaultValue`, `onValueChange`) | controlled-only forces every caller to hold state it does not care about |
| Behaviour is fixed, markup differs a lot | a headless hook returning prop getters | a styled component forces one look on every caller |
| Behaviour must land on another element (a button that is a link) | `asChild` or a `render` prop | a generic `as` prop is hard to type and slows the checker |
| The component decides when or how often to render the caller's markup | a render prop | a hook cannot control render timing (virtual rows, error fallbacks) |
| The state source (local draft vs synced store) | a provider interface (state, actions, meta) | parts that import a store directly cannot be reused with another one |

## Children and slots before configuration props

Children and slot props let the caller pass the content instead of describing it through configuration. Start here before adding any `showX` or `xText` prop:

```tsx
// Configuration: every new need is a new prop
<Dialog title="Delete file" showIcon iconType="warning" primaryText="Delete" secondaryText="Cancel" onPrimary={del} />

// Composition: the caller arranges the parts
<Dialog>
  <Dialog.Header icon={<WarningIcon />}>Delete file</Dialog.Header>
  <Dialog.Body>This cannot be undone.</Dialog.Body>
  <Dialog.Footer>
    <Button variant="secondary" onClick={close}>Cancel</Button>
    <Button variant="danger" onClick={del}>Delete</Button>
  </Dialog.Footer>
</Dialog>
```

A slot is a prop that takes JSX for one named place: `<PageLayout sidebar={<Filters />} actions={<ExportButton />}>{table}</PageLayout>`. Use slots when a component has two or three fixed regions; use child components (`Dialog.Header`) when the regions are optional or repeatable.

## Explicit variants instead of boolean flags

Boolean props that change behaviour multiply: `isCompact`, `isEditable`, `isInline` give eight modes, some invalid. Replace them with one union prop, or with separate components when the modes differ in structure:

```tsx
// Before
<Composer isThread isEditing={false} isDM showAttachments />

// After: one component per real use, built from shared parts
<ThreadComposer channelId={id} />
<EditMessageComposer messageId={mid} />
```

```tsx
type ButtonProps = { variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; size?: 'sm' | 'md' } & React.ComponentProps<'button'>
```

- A union prop documents every allowed value and rejects invalid mixes at compile time.
- When a boolean is a true on/off attribute of the same thing (`disabled`, `required`), keep it boolean.

## Compound components with shared context

Compound components are a parent and its parts that share state through a private context, like `<select>` and `<option>`. The parent owns state; the parts read it. Full accessible example (Tabs): [compound-components.md](references/compound-components.md).

```tsx
const AccordionContext = createContext<{ open: string | null; toggle: (id: string) => void } | null>(null)

function useAccordion() {
  const ctx = use(AccordionContext)
  if (!ctx) throw new Error('Accordion parts must be inside <Accordion>')
  return ctx
}

export function Accordion({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<string | null>(null)
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id))
  return <AccordionContext value={{ open, toggle }}>{children}</AccordionContext>
}

Accordion.Item = function AccordionItem({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const { open, toggle } = useAccordion()
  const expanded = open === id
  return (
    <div>
      <h3><button type="button" aria-expanded={expanded} aria-controls={`${id}-panel`} onClick={() => toggle(id)}>{title}</button></h3>
      <div id={`${id}-panel`} hidden={!expanded}>{children}</div>
    </div>
  )
}
```

- The context is not exported; only the parts are. Callers cannot depend on its shape.
- A part used outside its parent throws a clear error from the hook.
- Assigning parts as properties (`Accordion.Item`) is convenient; named exports (`AccordionItem`) tree-shake better in large libraries. Pick one per library.

## Controlled and uncontrolled components

A controlled component gets its value from props and reports changes; an uncontrolled one keeps its own state and takes a default. Good library components support both, like `<input value>` and `<input defaultValue>`:

```tsx
function useControllable<T>({ value, defaultValue, onChange }: { value?: T | undefined; defaultValue: T; onChange?: ((v: T) => void) | undefined }) {
  const [inner, setInner] = useState(defaultValue)
  const controlled = value !== undefined
  const current = controlled ? value : inner
  const set = (next: T) => {
    if (!controlled) setInner(next)
    onChange?.(next)
  }
  return [current, set] as const
}

export function Switch(props: { checked?: boolean; defaultChecked?: boolean; onCheckedChange?: (v: boolean) => void; label: string }) {
  const [checked, setChecked] = useControllable({ value: props.checked, defaultValue: props.defaultChecked ?? false, onChange: props.onCheckedChange })
  return <button type="button" role="switch" aria-checked={checked} onClick={() => setChecked(!checked)}>{props.label}</button>
}
```

- Never switch between controlled and uncontrolled during a component's life; React warns for inputs, and custom components break the same way.
- Name the pair consistently: `value`/`defaultValue`/`onValueChange`, `open`/`defaultOpen`/`onOpenChange`.

## Headless hooks for behaviour without markup

A headless hook holds a widget's behaviour (state, keyboard handling, ARIA attributes) and returns prop getters; the caller renders any markup. Use it when visual designs differ a lot but behaviour is the same:

```tsx
export function useDisclosure(initial = false) {
  const [open, setOpen] = useState(initial)
  const id = useId()
  return {
    open,
    toggle: () => setOpen((o) => !o),
    buttonProps: { 'aria-expanded': open, 'aria-controls': id, onClick: () => setOpen((o) => !o) },
    panelProps: { id, hidden: !open },
  }
}
```

Mature headless libraries (React Aria, Radix Primitives, Base UI, Ariakit, Headless UI) already solve focus, keyboard and screen readers for complex widgets. Build on one of them before writing a combobox or a date picker from scratch (`react-accessibility`).

## Polymorphism with asChild or a render prop

Polymorphism lets a component's behaviour and styles land on a different element: a `Button` that is really a router `Link`. Two current styles:

```tsx
// asChild (Radix-style Slot): merge props onto the single child
<Button asChild><Link to="/settings">Settings</Link></Button>

// render prop (Base UI-style): the component calls it with props to spread
<Button render={(props) => <Link {...props} to="/settings" />}>Settings</Button>
```

Avoid the older `as="a"` prop with generic typing: it is hard to type correctly and slows the type checker. When you only need a link that looks like a button, a `buttonClasses()` helper applied to `<Link className>` is simpler than either.

## Render props only for real inversion of control

A render prop passes a function the component calls with its internal state. With hooks, most render props became custom hooks. Keep them only where the component must decide *when* or *how often* to render the caller's markup, such as a virtualized list's row renderer or `fallbackRender` in an error boundary.

## Provider interfaces for swappable state

A provider can hide how state is stored behind a small interface of state, actions and metadata, so the same UI works with local state, a store or a server cache. The parts read the interface, never the implementation:

```tsx
type ComposerApi = {
  state: { text: string; files: File[] }
  actions: { setText: (t: string) => void; attach: (f: File) => void; submit: () => Promise<void> }
  meta: { submitting: boolean }
}
const ComposerContext = createContext<ComposerApi | null>(null)
```

A local draft composer and a synced edit composer then differ only in their provider; `Composer.Input`, `Composer.Attachments` and `Composer.Submit` are shared.

## Worked example: an async view with slots and a render prop

A worked example of composition: `AsyncView` renders any loading result through caller-supplied slots (`pending`, `empty`, `error`) and a render prop for the data, so every data screen gets the same states and accessibility without a prop per variation. The generic `T` flows from the result into the render prop, so the caller's rows stay typed:

```tsx
// src/shared/ui/AsyncView.tsx
import type { ReactNode } from 'react'

export type AsyncResult<T> = { refetch: () => unknown } & (
  | { status: 'pending'; data: undefined }
  | { status: 'error'; data: T | undefined; error: Error }
  | { status: 'success'; data: T }
)

type AsyncViewProps<T> = {
  result: AsyncResult<T>
  label: string
  pending: ReactNode
  empty: ReactNode
  isEmpty?: (data: T) => boolean
  error?: (error: Error, retry: () => void) => ReactNode
  children: (data: T) => ReactNode
}

function defaultError(error: Error, retry: () => void) {
  return <><p>This could not be loaded. {error.message}</p><button type="button" onClick={retry}>Try again</button></>
}

export function AsyncView<T>({ result, label, pending, empty, isEmpty = () => false, error = defaultError, children }: AsyncViewProps<T>) {
  const retry = () => void result.refetch()
  const content = (data: T) => (isEmpty(data) ? empty : children(data))
  let body: ReactNode
  if (result.status === 'pending') body = <div role="status">{pending}</div>
  else if (result.status === 'success') body = content(result.data)
  else if (result.data === undefined) body = <div role="alert">{error(result.error, retry)}</div>
  else body = <><p role="alert">Could not refresh {label}. <button type="button" onClick={retry}>Try again</button></p>{content(result.data)}</>
  return <section aria-label={label} aria-busy={result.status === 'pending'}>{body}</section>
}
```

```tsx
// a caller: a TanStack Query result fits AsyncResult structurally
function OpenInvoices() {
  const invoices = useQuery(invoiceQueries.list({ status: 'open', page: 1 }))
  return (
    <AsyncView result={invoices} label="Open invoices" pending={<Skeleton lines={5} />}
      isEmpty={(rows) => rows.length === 0}
      empty={<EmptyState title="No open invoices" action={<NewInvoiceButton />} />}>
      {(rows) => <InvoiceTable rows={rows} />}
    </AsyncView>
  )
}
```

- A failed background refresh keeps the old data on screen with a retry, instead of replacing it with an error.
- Slots take JSX, so a caller can pass a skeleton shaped like its own content; the render prop is used only because the view decides when the data exists.

## Verify a component API

A component API is proven when invalid combinations fail to compile, each part works only inside its parent, and the states render by role. Run:

```bash
npx tsc -b                                         # union props reject invalid mixes
npx oxlint --deny-warnings                         # react/static-components, react/jsx-key
npx vitest run src/shared/ui                       # tests for each part and state
grep -rnE '\b(is|show|has)[A-Z][A-Za-z]*\??: boolean' src/shared/ui   # boolean props to review against the table above
```

- A type test proves the union: a `// @ts-expect-error` line above `<Button variant="huge" />` must stay an error, so `tsc -b` fails the day someone widens the type.
- A test renders a part outside its parent and expects the guard error: `expect(() => render(<Accordion.Item id="a" title="A">x</Accordion.Item>)).toThrow(/inside <Accordion>/)`.
- For `AsyncView`, render the pending, error, empty and success results and assert `getByRole('status')`, `getByRole('alert')`, the empty text and the rows.

## Pre-merge checklist for a reusable component API

Check each point before merging a reusable component.

1. Content passed as children or slots, not as text and icon props.
2. No boolean prop that switches structure; unions or separate components instead.
3. Compound parts share state through an unexported context with a guard hook.
4. Value-like props support controlled and uncontrolled use with consistent names.
5. Native props pass through (`...props` onto the root element) and `ref` is accepted as a prop.
6. Accessible by default: roles, names, keyboard; or built on a headless library.
7. A new variation can be added without editing every caller.

## Gotchas and anti-patterns in component composition

Each entry gives the symptom you see, its cause and the fix.

1. **A part renders but does nothing.** Cause: used outside its parent provider. Fix: the guard hook that throws a named error.
2. **Every part re-renders on any change.** Cause: one context with a new object each render. Fix: with the React Compiler the value is memoized; without it, `useMemo` the value, or split state and actions into two contexts.
3. **`A component is changing an uncontrolled input to be controlled`.** Cause: `value` started as `undefined`. Fix: default to `''`, or use `defaultValue`.
4. **`asChild` breaks with a fragment or two children.** Cause: Slot merges props onto exactly one element. Fix: pass a single element child.
5. **Type checking slows to a crawl.** Cause: generic `as` polymorphism over every intrinsic element. Fix: `asChild`, a render prop, or a class helper.
6. **A controlled component ignores the parent's new value.** Cause: the component copied `value` into state on mount. Fix: read `value` on every render when it is defined (the `useControllable` hook above).
7. **Anti-pattern: render props where a hook would do.** Symptom: deeply nested callbacks in JSX ("callback pyramid"). Cause: the pattern predates hooks. Fix: a custom hook; keep render props for real inversion of control.
8. **Anti-pattern: exporting the compound context.** Symptom: callers read the context directly and break when its shape changes. Cause: the context became public API by accident. Fix: export only the parts and a typed hook.

## See also

- `react-design-system`: tokens, a component library's structure, documentation and release.
- `react-accessibility`: APG patterns for the widgets compound components often build.
- `react-typescript`: typing unions, generics and polymorphic props.

Ideas in this skill overlap with Vercel's `composition-patterns` agent skill and the React docs; the text and examples here are original.
