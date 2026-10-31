---
name: react-animation
description: Animates React interfaces with React 19.3's stable ViewTransition component and addTransitionType, Suspense reveals, shared-element transitions and route transitions, plus Motion 14 for gestures, drag, springs, layout animation and exit animations with AnimatePresence, all respecting reduced motion. Use when adding enter, exit or page transitions, animating a list or a shared element, migrating off React Router's viewTransition props, choosing between ViewTransition, Motion and CSS, or when an animation does not run, janks or ignores reduced-motion settings.
metadata:
  tags:
  - react
  - animation
  - viewtransition
  - motion
  - framer-motion
  - transitions
  - reduced-motion
---

# React animation with ViewTransition and Motion

Motion in an interface confirms what happened: a panel opened, an item moved, a page replaced another. React 19.3 made `<ViewTransition>` stable, which animates state changes through the browser's View Transition API. Motion (the library formerly called Framer Motion, now `motion` 14) covers gestures, drag, springs and layout animation inside a view. This skill shows when to use each and how to keep motion fast and optional.

## Step 0: read the installed React and Motion versions

`<ViewTransition>` and `addTransitionType` are stable exports of `react` from 19.3 on, and Motion's package name changed, so read both before writing motion code (from the project root):

```bash
node -p "['react','react-dom','motion','framer-motion','react-router'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `react` 19.3.1, `motion` 14.9.0, `react-router` 8.5.1. On React older than 19.3, upgrade before using `<ViewTransition>` or use Motion alone. A `framer-motion` line means the old package name: new code imports from `motion/react`.

## Choose the animation tool

Choosing between React `<ViewTransition>`, Motion and plain CSS depends on what moves and why:

| Motion | Tool | Why the alternatives lose |
|---|---|---|
| Content entering, leaving or swapping because of a state change (tabs, routes, filters, Suspense reveals) | React `<ViewTransition>` | Motion needs `AnimatePresence` and keys around every swap; CSS alone cannot animate an element that React just removed |
| An element moving from one place to another across a state change (thumbnail to detail) | `<ViewTransition name>` shared element | measuring and animating positions by hand breaks on scroll and resize |
| Direct manipulation: drag, swipe, press, hover, springs | Motion (`motion/react`) | view transitions snapshot the page and cannot follow a pointer |
| Layout reflow inside a component (list reorder, accordion height) | Motion `layout` prop | animating `height` or `top` in CSS triggers layout on every frame |
| Simple hover and focus feedback, spinners | CSS transitions and keyframes | a JavaScript library adds bundle and work for what the browser does alone |
| 3D scenes, particles, game-like motion | a canvas or WebGL renderer (`react-3d-and-canvas`) | DOM animation of thousands of elements cannot keep 60 frames per second |

Keep durations short: 120 to 250 ms for most interface motion. Motion that delays input makes an app feel slow.

## ViewTransition basics

`<ViewTransition>` wraps elements React should animate. React animates them only for updates inside a Transition (`startTransition`, `useDeferredValue`, a Suspense reveal, a router navigation); urgent updates such as typing are never animated:

```tsx
import { startTransition, useState, ViewTransition } from 'react'

function Gallery({ photos }: { photos: Photo[] }) {
  const [index, setIndex] = useState(0)
  const next = () => startTransition(() => setIndex((i) => (i + 1) % photos.length))
  return (
    <>
      <ViewTransition key={photos[index]!.id}>
        <img src={photos[index]!.src} alt={photos[index]!.alt} />
      </ViewTransition>
      <button onClick={next}>Next photo</button>
    </>
  )
}
```

React picks the animation kind: **enter** (the boundary is added), **exit** (removed), **update** (its content or style changed) and **share** (a named boundary moved). The default is a cross-fade. Changing the `key` makes it an exit of the old and an enter of the new.

`<ViewTransition>` works in the DOM only for now. It animates a snapshot of its subtree, so children inside one boundary move as one picture, unlike Motion's per-element layout animation. Add more boundaries when parts must move on their own.

### Where ViewTransition must sit

A `<ViewTransition>` runs enter, exit and list reorder animations only when no DOM node of that component sits above it. Put the boundary outermost in the component that is added, removed or moved:

```tsx
// No enter, exit or reorder animation: the <li> is above the boundary
function Row({ task }: { task: Task }) {
  return <li><ViewTransition><TaskTitle task={task} /></ViewTransition></li>
}

// Each row animates by itself
function Row({ task }: { task: Task }) {
  return <ViewTransition><li><TaskTitle task={task} /></li></ViewTransition>
}
```

Only the first boundary in an added or removed subtree fires enter or exit; boundaries nested inside it stay quiet. When a page wraps everything in one boundary and you want a part to stop animating with it, nest `<ViewTransition update="none">` around that part.

`<Activity>` works as a switch here too: a boundary inside `<Activity>` plays enter when the mode becomes `visible` and exit when it becomes `hidden`, and the subtree keeps its state.

## ViewTransition classes and CSS

The `enter`, `exit`, `update`, `share` and `default` props take `"auto"` (the browser's default animation), `"none"`, a class name for the view-transition pseudo-elements, or an object keyed by Transition Type with a `default` key, so animations are plain CSS. Use these classes rather than setting `view-transition-name` yourself:

```tsx
<ViewTransition enter="slide-in" exit="slide-out" default="none">
  <Panel />
</ViewTransition>
```

```css
::view-transition-old(.slide-out) { animation: 150ms ease-in both slide-out; }
::view-transition-new(.slide-in)  { animation: 200ms ease-out both slide-in; }
@keyframes slide-out { to { opacity: 0; transform: translateX(-16px); } }
@keyframes slide-in  { from { opacity: 0; transform: translateX(16px); } }
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation-duration: 0s !important; }
}
```

`default="none"` turns off the kinds you did not name, so only the intended ones animate.

### ViewTransition events for the Web Animations API

The event props `onEnter`, `onExit`, `onUpdate` and `onShare` drive an animation from JavaScript when CSS is not enough. Each receives `instance` (`old`, `new`, `group`, `imagePair` pseudo-elements and `name`) and `types`, the Transition Types of this animation as an array, and should return a cleanup that cancels what it started:

```tsx
<ViewTransition
  default="none"
  onEnter={(instance, types) => {
    const spin = instance.new.animate(
      [{ rotate: types.includes('undo') ? '-8deg' : '8deg', opacity: 0 }, { rotate: '0deg', opacity: 1 }],
      { duration: 180, easing: 'ease-out' },
    )
    return () => spin.cancel()
  }}>
  <Toast />
</ViewTransition>
```

One event fires per boundary per Transition, and `onShare` wins over `onEnter` and `onExit`. `instance.new` and the other pseudo-elements are declared in the root of `@types/react-dom`, so a project that imports only `react-dom/client` fails with TS2339, `Property 'new' does not exist on type 'ViewTransitionInstance'`, until `"react-dom"` is listed in `compilerOptions.types`.

## addTransitionType for direction-aware motion

`addTransitionType` labels a Transition with its cause, so the same change can animate differently, for example forward and back:

```tsx
import { addTransitionType, startTransition, ViewTransition } from 'react'

function go(delta: 1 | -1) {
  startTransition(() => {
    addTransitionType(delta > 0 ? 'forward' : 'back')
    setStep((s) => s + delta)
  })
}

<ViewTransition key={step}
  enter={{ forward: 'from-right', back: 'from-left', default: 'none' }}
  exit={{ forward: 'to-left', back: 'to-right', default: 'none' }}>
  <WizardStep step={step} />
</ViewTransition>
```

Each type also becomes a browser view transition type, so CSS can target it with `:active-view-transition-type(forward)`. Types are collected from every Transition combined into one animation, and reset after each commit: a Suspense fallback sees them, the later reveal of the content does not, so give reveals plain string props.

## Shared element transitions

A shared element transition moves one element to a new place, such as a card image growing into the detail header. Give both elements a `<ViewTransition>` with the same `name`; React animates between them when one unmounts and the other mounts in the same Transition:

```tsx
// in the list
<ViewTransition name={`photo-${photo.id}`}><img src={photo.thumb} alt="" /></ViewTransition>
// in the detail view
<ViewTransition name={`photo-${photo.id}`}><img src={photo.full} alt={photo.alt} /></ViewTransition>
```

Names must be unique among mounted boundaries, so build them from the item id. Two mounted boundaries with one name log `There are two <ViewTransition name=%s> components with the same name mounted at the same time.` in development and the transition errors. Both elements must render in the same Transition: if the incoming view suspends, only its fallback exists when the old one leaves, so the pair never forms.

## Suspense reveals with ViewTransition

Wrapping a `<Suspense>` boundary in `<ViewTransition>` animates the switch from fallback to content as an update. The recommended setting makes fallbacks appear at once and only the reveal animate:

```tsx
<ViewTransition update="auto" default="none">
  <Suspense fallback={<Skeleton lines={4} />}>
    <InvoiceDetail id={id} />
  </Suspense>
</ViewTransition>
```

Images and `<style precedence>` fonts inside `<ViewTransition><Suspense>` can suspend while loading, so they appear together instead of popping in one by one.

## Route transitions

Routers that navigate inside transitions animate pages when the outlet is wrapped. React Router 8.5 deprecated its own `viewTransition` props in favour of this:

```tsx
import { ViewTransition } from 'react'
import { Outlet } from 'react-router'

export function RootLayout() {
  return <ViewTransition><Outlet /></ViewTransition>
}
```

Do not set `useTransitions={false}` on the React Router provider; navigations must be Transitions to animate. A Transition started from the legacy `popstate` event must finish synchronously to restore scroll and form state, so React skips the animation on the back button unless the router uses the Navigation API. `flushSync` skips animations too. Migrate by removing `viewTransition` props on links, and replacing `useViewTransitionState` and `NavLink`'s `isTransitioning` styles with `<ViewTransition>` classes.

## Motion for gestures, springs and layout

Motion animates React elements with springs and handles gestures. Import from `motion/react`:

```bash
npm i motion
```

```tsx
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

export function Toast({ toast, onDismiss }: { toast: { id: string; text: string } | null; onDismiss: () => void }) {
  const reduce = useReducedMotion()
  return (
    <div role="status" className="toast-region">                 {/* mounted before any toast, or nothing is announced */}
      <AnimatePresence>
        {toast && (
          <motion.div key={toast.id} className="toast"
            initial={{ opacity: 0, y: reduce ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduce ? 0 : 16 }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            drag="x" dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 120) onDismiss() }}>
            <p>{toast.text}</p>
            <button type="button" onClick={onDismiss}>Dismiss</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
```

- Screen readers announce changes inside a live region that already exists; a `role="status"` element mounted together with its text usually says nothing, so the region stays mounted and the toast animates inside it.
- Swiping is pointer-only, so the Dismiss button is what keyboard and screen reader users get (WCAG 2.5.7).
- `AnimatePresence` keeps a leaving child mounted until its `exit` animation finishes; children need stable `key`s.
- `layout` on a `motion` element animates its size and position when layout changes (reorder, expand); `layoutId` shares an element across components within Motion.
- Motion animates `transform` and `opacity` on the compositor; avoid animating `width`, `height`, `top` or `left` directly.
- More recipes (list reorder, accordion, scroll-linked effects, staggering): [motion-recipes.md](references/motion-recipes.md).

## Respect reduced motion

Some people get dizzy or distracted from movement and turn on "Reduce motion" in their OS. Respect it in every tool:

- CSS: `@media (prefers-reduced-motion: reduce)` sets durations to zero or replaces movement with opacity.
- Motion: `useReducedMotion()` per component, or `<MotionConfig reducedMotion="user">` at the root to apply it everywhere.
- ViewTransition: the CSS media query above on the `::view-transition-*` pseudo-elements.
- Never convey information only through motion.

## Worked example: a filtered task list that animates between states

A worked example: filter buttons change the list inside `startTransition`, so `<ViewTransition>` animates rows entering and leaving and the switch to the empty state, while a live region reports the count and reduced motion turns the movement off:

```tsx
// src/features/tasks/TaskBoard.tsx
import { startTransition, useState, ViewTransition } from 'react'

type Task = { id: string; title: string; done: boolean }
type Filter = 'all' | 'open' | 'done'
const filters: readonly Filter[] = ['all', 'open', 'done']

export function TaskBoard({ tasks }: { tasks: readonly Task[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const shown = tasks.filter((t) => filter === 'all' || (filter === 'done') === t.done)
  return (
    <section aria-labelledby="tasks-title">
      <h2 id="tasks-title">Tasks</h2>
      <div role="group" aria-label="Filter tasks">
        {filters.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => startTransition(() => setFilter(f))}>{f}</button>
        ))}
      </div>
      <p role="status" className="sr-only">{shown.length} {shown.length === 1 ? 'task' : 'tasks'} shown</p>
      {shown.length === 0 ? (
        <ViewTransition enter="fade-in" exit="fade-out">
          <p className="empty">No {filter === 'all' ? '' : `${filter} `}tasks.</p>
        </ViewTransition>
      ) : (
        <ul>
          {shown.map((t) => (
            <ViewTransition key={t.id} enter="slide-in" exit="fade-out">
              <li>{t.title}</li>
            </ViewTransition>
          ))}
        </ul>
      )}
    </section>
  )
}
```

```css
::view-transition-new(.slide-in) { animation: 180ms ease-out both slide-in; }
::view-transition-new(.fade-in)  { animation: 150ms ease-out both fade-in; }
::view-transition-old(.fade-out) { animation: 120ms ease-in both fade-out; }
@keyframes slide-in { from { opacity: 0; transform: translateY(8px); } }
@keyframes fade-in  { from { opacity: 0; } }
@keyframes fade-out { to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation-duration: 0s !important; }
}
```

- Rows that stay visible keep their key, so React animates their new position as an update with the browser's default morph.
- The count goes to a live region, because motion alone tells a screen reader user nothing.
- Browsers without the View Transition API apply the update at once, so the feature still works there.

## Verify React animation

Animation is proven when it runs only for the intended updates, stays on the compositor, and disappears under reduced motion. Check:

```bash
grep -rnE "from 'framer-motion'|viewTransition[=:]|useViewTransitionState" src   # must print nothing on new code
npx vitest run src/features/tasks                                                 # behaviour tests do not wait for animations
```

- Chrome DevTools, Rendering tab: "Emulate CSS media feature prefers-reduced-motion: reduce", then repeat the interaction; nothing moves, content still changes.
- Performance panel: record the interaction; the frames show composite work only, with no purple layout blocks during the animation.
- Animations panel: durations match the 120 to 250 ms budget; slow the playback to 10 percent to inspect a transition.
- In Playwright journeys, `await page.emulateMedia({ reducedMotion: 'reduce' })` keeps tests fast and checks the reduced path (`react-e2e-testing`).

## Pre-merge checklist for React animation

Check each point before merging an animation.

1. Each animation confirms a change; nothing moves for decoration.
2. State-change motion uses `<ViewTransition>` with updates inside `startTransition`; direct manipulation uses Motion.
3. Durations between about 120 and 250 ms; input never waits for an animation.
4. Only `transform` and `opacity` animated in hot paths.
5. Shared element names unique among mounted elements.
6. Reduced motion handled in CSS, Motion and view transitions.
7. React Router `viewTransition` props replaced with `<ViewTransition>`.
8. Live data updates (progress, streaming rows) are not animated.

## Gotchas and anti-patterns in React animation

Each entry gives the symptom you see, its cause and the fix.

1. **`<ViewTransition>` does nothing.** Cause: the update was urgent (a plain `setState` from an event), or a DOM node sits above the boundary. Fix: wrap the update in `startTransition` and make the boundary the component's outermost element; for urgent interactions use Motion.
2. **Every element cross-fades, not only the one intended.** Cause: default animations on all kinds. Fix: `default="none"` and name only the kinds you want.
3. **Shared element jumps instead of moving.** Cause: two mounted boundaries share a name, or the mount and unmount happen in different updates. Fix: unique names, one Transition for the change.
4. **Exit animation never plays in Motion.** Cause: the element is removed without `AnimatePresence`, or its `key` is missing or changes. Fix: wrap in `AnimatePresence` with a stable key.
5. **Animation janks on large pages.** Cause: animating layout properties or huge snapshots. Fix: animate `transform` and `opacity`; scope `<ViewTransition>` to the changing area, not the whole page.
6. **`import { motion } from 'framer-motion'` in new code pulls a second copy of the library.** Cause: the package was renamed to `motion`. Fix: install `motion` and import from `motion/react`; the API is the same.
7. **React Router deprecation warnings after 8.5.** Cause: `viewTransition` props and `useViewTransitionState`. Fix: React `<ViewTransition>` around the outlet.
8. **Anti-pattern: animating live data.** Symptom: a progress bar or streaming table lags behind and stutters. Cause: each update starts a transition. Fix: render live values directly; animate only discrete changes.
9. **Anti-pattern: long entrance animations on every page.** Symptom: the app feels slow and clicks land on moving targets. Cause: 400 ms and longer durations, staggered lists. Fix: keep to 120 to 250 ms and never block input.

## See also

- `react-3d-and-canvas`: WebGL, canvas and React Three Fiber scenes.
- `react-performance`, `react-accessibility` (reduced motion), `react-router-data-mode` (route transitions).
