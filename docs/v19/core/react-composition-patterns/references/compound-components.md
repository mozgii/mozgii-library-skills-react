---
title: Accessible compound Tabs component
author: MOZGII, Inc.
lang: en
---

# Accessible compound Tabs component

A complete compound component: `Tabs`, `Tabs.List`, `Tabs.Tab` and `Tabs.Panel`, controlled or uncontrolled, with the keyboard behaviour of the WAI-ARIA tabs pattern (arrow keys move between tabs, Home and End jump, the active tab is the only one in the tab order).

## Contents

This page, Accessible compound Tabs component, has these sections.

1. Tabs component code
2. Using the Tabs component
3. Testing the Tabs component

## Tabs component code

The parent owns the selected value; the parts read it from a private context.

```tsx
import { createContext, use, useId, useState, type KeyboardEvent, type ReactNode } from 'react'

type TabsCtx = { baseId: string; value: string; select: (v: string) => void }
const Ctx = createContext<TabsCtx | null>(null)
function useTabs() {
  const ctx = use(Ctx)
  if (!ctx) throw new Error('Tabs parts must be rendered inside <Tabs>')
  return ctx
}

type TabsProps = { value?: string; defaultValue: string; onValueChange?: (v: string) => void; children: ReactNode }

export function Tabs({ value, defaultValue, onValueChange, children }: TabsProps) {
  const [inner, setInner] = useState(defaultValue)
  const baseId = useId()
  const select = (v: string) => { if (value === undefined) setInner(v); onValueChange?.(v) }
  return <Ctx value={{ baseId, value: value ?? inner, select }}>{children}</Ctx>
}

Tabs.List = function TabsList({ label, children }: { label: string; children: ReactNode }) {
  const { select } = useTabs()
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const tabs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])')]
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] :
      e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] :
      e.key === 'Home' ? tabs[0] :
      e.key === 'End' ? tabs.at(-1) : undefined
    if (!next) return
    e.preventDefault()
    next.focus()
    select(next.dataset.value!)
  }
  // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the tabs are the Tab stops; their key events bubble here
  return <div role="tablist" aria-label={label} onKeyDown={onKeyDown}>{children}</div>
}

Tabs.Tab = function Tab({ value: v, children }: { value: string; children: ReactNode }) {
  const { value, select, baseId } = useTabs()
  const selected = value === v
  return (
    <button
      type="button"
      role="tab"
      data-value={v}
      id={`${baseId}-tab-${v}`}
      aria-selected={selected}
      aria-controls={`${baseId}-panel-${v}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => select(v)}
    >
      {children}
    </button>
  )
}

Tabs.Panel = function TabPanel({ value: v, children }: { value: string; children: ReactNode }) {
  const { value, baseId } = useTabs()
  return (
    <div role="tabpanel" id={`${baseId}-panel-${v}`} aria-labelledby={`${baseId}-tab-${v}`} hidden={value !== v} tabIndex={0}>
      {children}
    </div>
  )
}
```

The key handler reads the tab order from the DOM at the moment of the key press, so tabs can be added, removed or reordered without any registration step, and nothing is written during render.

## Using the Tabs component

The caller arranges the parts and may control the value from the URL so the selected tab survives reload:

```tsx
const [params, setParams] = useSearchParams()

<Tabs value={params.get('tab') ?? 'overview'} defaultValue="overview" onValueChange={(t) => setParams({ tab: t })}>
  <Tabs.List label="Project sections">
    <Tabs.Tab value="overview">Overview</Tabs.Tab>
    <Tabs.Tab value="activity">Activity</Tabs.Tab>
    <Tabs.Tab value="settings">Settings</Tabs.Tab>
  </Tabs.List>
  <Tabs.Panel value="overview"><Overview /></Tabs.Panel>
  <Tabs.Panel value="activity"><Activity /></Tabs.Panel>
  <Tabs.Panel value="settings"><Settings /></Tabs.Panel>
</Tabs>
```

## Testing the Tabs component

Test behaviour the way a keyboard user meets it, with Testing Library queries by role:

```tsx
test('arrow keys move selection and focus', async () => {
  const user = userEvent.setup()
  render(<ProjectTabs />)
  await user.click(screen.getByRole('tab', { name: 'Overview' }))
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true')
  expect(screen.getByRole('tab', { name: 'Activity' })).toHaveFocus()
  expect(screen.getByRole('tabpanel', { name: 'Activity' })).toBeVisible()
})
```

Hidden panels keep their state only while mounted with `hidden`. To keep heavy panels alive but paused, wrap each in `<Activity mode={selected ? 'visible' : 'hidden'}>` instead of `hidden` (`react-performance`).
