---
title: Motion and ViewTransition recipes
author: MOZGII, Inc.
lang: en
---

# Motion and ViewTransition recipes

Ready patterns for common interface animations with Motion 14 (`motion/react`) and React 19.3 `<ViewTransition>`.

## Contents

This page, Motion and ViewTransition recipes, has these sections.

1. Animated list with add, remove and reorder
2. Accordion height animation
3. Tab content cross-fade with ViewTransition
4. Modal enter and exit
5. Staggered entrance
6. Scroll-linked progress bar
7. Drag to reorder

## Animated list with add, remove and reorder

Motion's `layout` animates rows moving to new positions, and `AnimatePresence` animates rows leaving. `mode="popLayout"` removes the leaving row from layout at once so the others slide up while it fades:

```tsx
import { AnimatePresence, motion } from 'motion/react'

export function TaskList({ tasks }: { tasks: Task[] }) {
  return (
    <ul>
      <AnimatePresence mode="popLayout" initial={false}>
        {tasks.map((t) => (
          <motion.li key={t.id} layout
            initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}>
            {t.title}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}
```

`initial={false}` skips the entrance animation for rows present on first render.

## Accordion height animation

Animating to `height: 'auto'` is something CSS alone does poorly; Motion measures it:

```tsx
<AnimatePresence initial={false}>
  {open && (
    <motion.div key="panel" id={panelId}
      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2 }} style={{ overflow: 'hidden' }}>
      <div className="panel-body">{children}</div>
    </motion.div>
  )}
</AnimatePresence>
```

Modern CSS can also do it with `interpolate-size: allow-keywords` and `transition: height`, where supported.

## Tab content cross-fade with ViewTransition

A tab switch inside `startTransition` cross-fades the panels; keying the boundary by tab makes it exit and enter:

```tsx
import { startTransition, ViewTransition } from 'react'

<div role="tablist" aria-label="Report">
  {tabs.map((t) => (
    <button key={t} role="tab" aria-selected={tab === t} onClick={() => startTransition(() => setTab(t))}>{t}</button>
  ))}
</div>
<ViewTransition key={tab} enter="fade-in" exit="fade-out" default="none">
  <div role="tabpanel"><TabBody tab={tab} /></div>
</ViewTransition>
```

```css
::view-transition-old(.fade-out) { animation: 120ms ease-out both fade-out; }
::view-transition-new(.fade-in)  { animation: 160ms ease-out both fade-in; }
@keyframes fade-out { to { opacity: 0 } }
@keyframes fade-in  { from { opacity: 0 } }
```

## Modal enter and exit

A native `<dialog>` handles focus, the top layer and Escape; Motion animates it in and out. Keep the dialog mounted and open until the exit finishes, then let React remove it:

```tsx
import { useId, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

const MotionDialog = motion.create('dialog')

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  return (
    <AnimatePresence>
      {open && (
        <MotionDialog key="dialog" aria-labelledby={titleId}
          ref={(el: HTMLDialogElement | null) => {
            if (!el) return
            el.showModal()                                  // focus moves in, the rest of the page goes inert
            return () => el.close()                         // runs when the exit is over: focus returns to the opener
          }}
          onCancel={(e) => { e.preventDefault(); onClose() }}   // Escape: play the exit instead of closing at once
          initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.16 }}>
          <h2 id={titleId}>{title}</h2>
          {children}
        </MotionDialog>
      )}
    </AnimatePresence>
  )
}
```

```css
dialog::backdrop { background: rgb(0 0 0 / 0.4); }
```

The backdrop belongs to the dialog, so it needs no element of its own. With a custom `role="dialog"` instead, you own focus trapping and returning focus yourself (`react-accessibility`); a headless dialog component plus Motion is often less work.

## Staggered entrance

Variants let a parent orchestrate its children, for example a short stagger when a dashboard first loads:

```tsx
const container = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } }
const item = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }

<motion.ul variants={container} initial="hidden" animate="show">
  {cards.map((c) => <motion.li key={c.id} variants={item}><Card card={c} /></motion.li>)}
</motion.ul>
```

Use it once on first load, never on every data refresh.

## Scroll-linked progress bar

`useScroll` gives scroll progress as a motion value that updates without React renders:

```tsx
import { motion, useScroll } from 'motion/react'

export function ReadingProgress() {
  const { scrollYProgress } = useScroll()
  return <motion.div className="reading-progress" style={{ scaleX: scrollYProgress, transformOrigin: '0 50%' }} aria-hidden />
}
```

CSS scroll-driven animations (`animation-timeline: scroll()`) do the same without JavaScript where supported.

## Drag to reorder

`Reorder.Group` and `Reorder.Item` handle drag-to-reorder for a vertical or horizontal list:

```tsx
import { Reorder } from 'motion/react'

<Reorder.Group axis="y" values={items} onReorder={setItems}>
  {items.map((it) => <Reorder.Item key={it.id} value={it}>{it.label}</Reorder.Item>)}
</Reorder.Group>
```

Dragging is pointer-only. Provide a keyboard alternative (Move up and Move down buttons, or arrow keys on a focused item) to meet WCAG 2.5.7; for complex boards, dnd-kit has keyboard sensors and screen reader announcements built in.
