---
title: React effects cookbook
author: MOZGII, Inc.
lang: en
---

# React effects cookbook

Concrete rewrites of effects that should not exist, and the few patterns where an effect is right. The ideas follow the react.dev guides "You Might Not Need an Effect" and "Synchronizing with Effects" (react.dev content, CC BY 4.0), rewritten with new examples.

## Contents

This page, React effects cookbook, has these sections.

1. Derived values instead of an effect
2. Reset all state with a key
3. Adjust some state when a prop changes
4. Event logic belongs in handlers
5. Chains of effects
6. Notify the parent in the handler
7. Initialize the app once
8. Effects that are correct: subscriptions, widgets, timers
9. Previous value of a prop

## Derived values instead of an effect

A value computed from props or state is computed during render. Storing it in state and syncing it with an effect renders twice and can show the stale value for a frame.

```tsx
// Before: extra state, extra render
const [visible, setVisible] = useState<Todo[]>([])
useEffect(() => { setVisible(todos.filter((t) => matches(t, filter))) }, [todos, filter])

// After: computed; the React Compiler memoizes it when it is expensive
const visible = todos.filter((t) => matches(t, filter))
```

Without the compiler and with a measured slow filter, wrap it in `useMemo(() => …, [todos, filter])`.

## Reset all state with a key

To start fresh when an identity prop changes, give the component a `key`. React then treats it as a new component and drops all its state, including the state of its children.

```tsx
// Before: an effect clearing several fields when userId changes
// After:
<ProfileEditor key={userId} userId={userId} />
```

## Adjust some state when a prop changes

When only part of the state should follow a prop, first try to remove that state: store an id instead of the selected object, and look the object up during render.

```tsx
// Before: selection object reset in an effect when items change
// After: keep the id; the selected item is derived and becomes undefined when it disappears
const [selectedId, setSelectedId] = useState<string | null>(null)
const selected = items.find((i) => i.id === selectedId)
```

If you truly must adjust state, compare with the previous prop during render and set state there (React re-renders immediately, before children render), rather than in an effect.

## Event logic belongs in handlers

Code that runs because the user did something goes in that event's handler. An effect cannot know why a value changed, so it fires on page load, on back navigation and on unrelated updates.

```tsx
// Before: a toast in an effect watching `product.inCart`
// After:
function handleBuy() {
  addToCart(product)
  showToast(`Added ${product.name}`)
}
```

Analytics for "page shown" is the exception: the cause is the display itself, so an effect is right.

## Chains of effects

Effects that set state that triggers other effects (pick card, then round, then game over) render once per link and are hard to follow. Compute what you can during render, and do the rest in the handler that started it:

```tsx
function handlePlaceCard(next: Card) {
  setCard(next)
  if (next.gold) {
    if (goldCount < 3) setGoldCount(goldCount + 1)
    else { setGoldCount(0); setRound(round + 1) }
  }
}
const isGameOver = round > 5                         // derived, not stored
```

## Notify the parent in the handler

When a child owns state and the parent wants to know about changes, call the parent's callback in the same handler. An effect that calls `onChange` after render notifies a frame late and runs on mount too.

```tsx
function Toggle({ onChange }: { onChange: (on: boolean) => void }) {
  const [on, setOn] = useState(false)
  function handleClick() {
    const next = !on
    setOn(next)
    onChange(next)
  }
  return <button aria-pressed={on} onClick={handleClick}>Dark mode</button>
}
```

Often the cleaner answer is to make the component controlled: the parent owns `on` and passes `on` and `onChange` (`react-composition-patterns`).

## Initialize the app once

App-wide setup (reading a token, starting a logger) should run once per page load, not once per mount; Strict Mode mounts twice in development. Run it at module level or behind a module flag:

```tsx
let started = false
export function App() {
  useEffect(() => {
    if (started) return
    started = true
    initAnalytics()
  }, [])
  return <Routes />
}
```

Even simpler: call `initAnalytics()` in `main.tsx` before `createRoot`.

## Effects that are correct: subscriptions, widgets, timers

Effects are right when they keep a component in sync with something outside React. Three common shapes:

```tsx
// a browser event
useEffect(() => {
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [close])

// a non-React widget
useEffect(() => {
  const map = new MapWidget(container.current!, { center })
  return () => map.destroy()
}, [center])

// a timer
useEffect(() => {
  const id = window.setInterval(() => setNow(Date.now()), 1000)
  return () => window.clearInterval(id)
}, [])
```

When the external thing is a store with a "current value" (online status, media query, a module store), `useSyncExternalStore` is better than an effect plus state.

## Previous value of a prop

To compare with the previous render's value, store it in state and compare during render, or in a ref updated in an effect when only handlers need it:

```tsx
const [prevItems, setPrevItems] = useState(items)
if (items !== prevItems) {
  setPrevItems(items)
  setSelectionLost(!items.some((i) => i.id === selectedId))
}
```

React allows setting the component's own state during render in exactly this guarded form; it discards the JSX and re-renders at once.
