---
name: react-drag-and-drop
description: Builds drag and drop in React with dnd-kit - which package line to pick (the new @dnd-kit/react with @dnd-kit/helpers, or the legacy @dnd-kit/core with @dnd-kit/sortable), sortable lists, kanban boards with columns and cross-column moves, drag handles and overlays, keyboard dragging and screen reader announcements, a non-drag alternative for WCAG 2.5.7, saving the new order optimistically with rollback, and dropping files from the desktop with native drag events. Use when making a list reorderable, building a kanban or a board, moving items between groups, when dragging does not work with the keyboard or on touch, the order snaps back after a drop, or when users need to drop files onto the page.
metadata:
  tags:
  - react
  - drag-and-drop
  - dnd-kit
  - sortable
  - kanban
  - accessibility
  - file-drop
---

# React drag and drop

Drag and drop moves things by pointer, touch or keyboard: reordering a list, moving a card between columns, dropping a file. dnd-kit is the usual React toolkit; it handles sensors (pointer, keyboard), collision detection, sorting and announcements, and leaves the markup and the data to you. Dropping files from the operating system is a different mechanism (native drag events) covered at the end.

## Step 0: read which dnd-kit line is installed

dnd-kit has two package lines with different APIs. Read which one the project uses before writing code:

```bash
node -p "['@dnd-kit/react','@dnd-kit/helpers','@dnd-kit/abstract','@dnd-kit/dom','@dnd-kit/core','@dnd-kit/sortable','@dnd-kit/utilities','react'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

As of October 2026: `@dnd-kit/react` 0.5.1 and `@dnd-kit/helpers` 0.5.1 (released October 2026, the line the dndkit.com docs list as "Latest"); `@dnd-kit/core` 6.3.1 and `@dnd-kit/sortable` 10.0.0 (last released December 2024, listed as "Legacy").

## Decision table: which dnd-kit package line to pick

| Situation | Pick | Why |
|---|---|---|
| New code, React 18 or 19 | `@dnd-kit/react` + `@dnd-kit/helpers`, pinned to an exact version | the maintained line: hooks with refs, sortable groups for kanban, accessibility plugin, `move()` helper |
| An existing app on `@dnd-kit/core` that works | stay on `@dnd-kit/core` + `@dnd-kit/sortable` | stable and widely used; migrate when you touch the feature, following the official migration guide |
| A library you publish that must not churn | `@dnd-kit/core` line, or wrap `@dnd-kit/react` behind your own API | `@dnd-kit/react` is 0.x: minor releases may change APIs |
| Very large boards, cross-window or native-feel dragging | `@atlaskit/pragmatic-drag-and-drop` 4 | built on native drag events; smaller, but you build more of the UI |
| Files from the desktop | native `dragover` and `drop` events, or `react-dropzone` | dnd-kit moves elements inside the page, not OS files |

Never mix the two dnd-kit lines in one drag context: `useSortable` from `@dnd-kit/sortable` does not work inside `DragDropProvider` from `@dnd-kit/react`. Install with exact versions (`npm i -E @dnd-kit/react @dnd-kit/helpers @dnd-kit/abstract`) because 0.x minors can break; `@dnd-kit/abstract` is listed because the code imports `CollisionPriority` from it, and all three stay on the same version. The legacy API and a migration map: [dnd-kit-legacy-and-migration.md](references/dnd-kit-legacy-and-migration.md).

## A sortable list with @dnd-kit/react

Wrap the list in `DragDropProvider`, make each item sortable with `useSortable({ id, index })`, and apply the result in `onDragEnd` with `move()`:

```tsx
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { move } from '@dnd-kit/helpers'

function SortableItem({ id, index, label }: { id: string; index: number; label: string }) {
  const { ref, isDragging } = useSortable({ id, index })
  return <li ref={ref} data-dragging={isDragging || undefined}>{label}</li>
}

function List({ initial }: { initial: { id: string; label: string }[] }) {
  const [items, setItems] = useState(initial)
  return (
    <DragDropProvider onDragEnd={(event) => { if (!event.canceled) setItems((current) => move(current, event)) }}>
      <ul>{items.map((item, index) => <SortableItem key={item.id} id={item.id} index={index} label={item.label} />)}</ul>
    </DragDropProvider>
  )
}
```

- `move(items, event)` works on an array of ids or of objects with an `id`, and on a record of arrays for grouped lists.
- `useSortable` returns `ref` for the whole item and `handleRef` for a drag handle; with a handle, only the handle starts the drag.
- Pointer and keyboard sensors are on by default; on touch, the pointer sensor waits for a 250 ms press (5 px tolerance) so scrolling still works.
- dnd-kit animates items optimistically during the drag and reverts them itself when the drag is cancelled (Escape).

## Kanban boards with columns and cross-column moves

A board keeps items as a record of column id to item ids. Items are sortable within a `group` (their column); columns are droppable so an empty column accepts items. Update the record in `onDragOver` so the card moves between columns live, and restore a snapshot on cancel:

```tsx
import { CollisionPriority } from '@dnd-kit/abstract'
import { useDroppable } from '@dnd-kit/react'

function Column({ id, children }: { id: string; children: React.ReactNode }) {
  const { ref, isDropTarget } = useDroppable({ id, type: 'column', accept: 'item', collisionPriority: CollisionPriority.Low })
  return <section ref={ref} aria-label={id} data-over={isDropTarget || undefined}>{children}</section>
}

function Card({ id, index, column }: { id: string; index: number; column: string }) {
  const { ref } = useSortable({ id, index, group: column, type: 'item', accept: 'item' })
  return <article ref={ref}>{id}</article>
}

// in the board
const snapshot = useRef(items)
<DragDropProvider
  onDragStart={() => { snapshot.current = items }}
  onDragOver={(event) => setItems((current) => move(current, event))}
  onDragEnd={(event) => { if (event.canceled) setItems(snapshot.current); else void persist(items) }}
>
```

`CollisionPriority.Low` on columns makes card collisions win over the column under them, so cards sort instead of dropping at the column's end. Reorder columns themselves with a second sortable of `type: 'column'`.

## Keyboard dragging and screen reader announcements

dnd-kit's keyboard sensor picks an item up with Space or Enter, moves it with the arrow keys, drops it with Space or Enter and cancels with Escape. The accessibility plugin adds screen reader instructions and live announcements ("Picked up item 3", "Item 3 was dropped"). Customize the words when the default ids are meaningless to users:

- Make each draggable a focusable element (a `button` handle or `tabIndex={0}` on the item) with an accessible name.
- Announce what moved and where in the user's terms ("Moved “Fix login” to Done, position 2"), not the internal id.
- Keep the focused item focused after the drop; re-rendering with stable keys does this.

## A non-drag alternative for WCAG 2.5.7

WCAG 2.2 success criterion 2.5.7 (Dragging Movements, AA) requires a way to do the same with a single pointer, without dragging. Give each item a menu or buttons: "Move up", "Move down", "Move to column…". They also help keyboard users who do not know the drag keys, and they make the action testable without simulating a drag.

## Worked example: a reorderable task list that saves the order

A sortable task list with drag handles, move buttons, optimistic saving with rollback, and loading, error and empty states:

```tsx
import { useState } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { arrayMove, move } from '@dnd-kit/helpers'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

type Task = { id: string; title: string }
const key = ['tasks'] as const

async function saveOrder(ids: string[]): Promise<void> {
  const res = await fetch('/api/tasks/order', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

function TaskRow({ task, index, count, onMove }: { task: Task; index: number; count: number; onMove: (from: number, to: number) => void }) {
  const { ref, handleRef, isDragging } = useSortable({ id: task.id, index })
  return (
    <li ref={ref} className={isDragging ? 'opacity-60' : undefined}>
      <button type="button" ref={handleRef} aria-label={`Drag ${task.title}`} className="cursor-grab">⠿</button>
      <span>{task.title}</span>
      <button type="button" onClick={() => onMove(index, index - 1)} aria-disabled={index === 0} aria-label={`Move ${task.title} up`}>↑</button>
      <button type="button" onClick={() => onMove(index, index + 1)} aria-disabled={index === count - 1} aria-label={`Move ${task.title} down`}>↓</button>
    </li>
  )
}

export function TaskList() {
  const qc = useQueryClient()
  const [status, setStatus] = useState('')
  const tasks = useQuery({ queryKey: key, queryFn: async (): Promise<Task[]> => {
    const res = await fetch('/api/tasks'); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json()
  } })
  const order = useMutation({
    mutationFn: (next: Task[]) => saveOrder(next.map((t) => t.id)),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<Task[]>(key)
      qc.setQueryData(key, next)
      return { previous }
    },
    onError: (_e, _next, ctx) => { if (ctx?.previous) qc.setQueryData(key, ctx.previous); setStatus('Could not save the new order. It was reverted.') },
    onSuccess: () => setStatus('Order saved.'),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })

  if (tasks.isPending) return <p role="status">Loading tasks…</p>
  if (tasks.isError) return <div role="alert">Tasks could not be loaded. <button type="button" onClick={() => tasks.refetch()}>Retry</button></div>
  const list = tasks.data
  if (list.length === 0) return <p>No tasks yet.</p>

  const moveTo = (from: number, to: number) => { if (to >= 0 && to < list.length) order.mutate(arrayMove(list, from, to)) }
  return (
    <>
      <DragDropProvider onDragEnd={(event) => { if (!event.canceled) order.mutate(move(list, event)) }}>
        <ol aria-label="Tasks, in priority order" aria-busy={order.isPending}>
          {list.map((t, i) => <TaskRow key={t.id} task={t} index={i} count={list.length} onMove={moveTo} />)}
        </ol>
      </DragDropProvider>
      <p role="status" aria-live="polite">{status}</p>
    </>
  )
}
```

The move buttons use `aria-disabled` rather than `disabled`: a row that reaches the top or the bottom would otherwise lose keyboard focus with the button that moved it, and `moveTo` already ignores a move past either end. The cache is the single source of the order: the drop and the buttons both write the new array optimistically, a failed save restores the previous one and says so, and a refetch settles the true order from the server.

## Dropping files from the desktop

Files dragged from the operating system arrive through native drag events, not dnd-kit. An element becomes a drop target when its `dragover` handler calls `preventDefault()`:

```tsx
function FileDropTarget({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false) }}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]) }}
      data-over={over || undefined}
    >
      Drop files here, or <label>choose files<input type="file" multiple className="sr-only" onChange={(e) => onFiles([...(e.target.files ?? [])])} /></label>
    </div>
  )
}
```

Always pair a drop zone with a file input: keyboard, screen reader and many touch users cannot drag files. Validation, previews and upload progress are the `react-file-uploads` skill.

## Verify drag and drop

- Pointer: drag within a list, across columns, into an empty column, and press Escape mid-drag (the order reverts).
- Keyboard: Tab to a handle, Space to lift, arrows to move, Space to drop; a screen reader announces each step.
- Touch: on a phone, a press-and-hold starts the drag and a swipe still scrolls the page.
- Failure: block the save request in DevTools; the order reverts and the status line says so.
- Playwright: test the move buttons for the logic, and one real drag with `locator.dragTo(target)` for the wiring.

## Gotchas and anti-patterns in drag and drop

Each gotcha names the symptom, its cause and the fix.

1. **Nothing drags, and the console shows no error.** Cause: hooks from `@dnd-kit/sortable` inside `DragDropProvider` from `@dnd-kit/react`, or the reverse. Fix: use one package line throughout.
2. **The item snaps back after the drop.** Cause: state was not updated in `onDragEnd`, or it was updated from a stale copy. Fix: `setItems((current) => move(current, event))`, or write the new order to the cache.
3. **The page cannot be scrolled on touch.** Cause: drag starts on any touch. Fix: keep the sensor's press delay, or use a drag handle so the rest of the item scrolls.
4. **Cards drop at the end of the column instead of between cards.** Cause: the column wins collisions. Fix: `collisionPriority: CollisionPriority.Low` on the column droppable.
5. **Keyboard users cannot reorder.** Cause: items are not focusable, or only custom pointer events were handled. Fix: a focusable handle and the default keyboard sensor, plus move buttons.
6. **An upgrade of `@dnd-kit/react` broke the board.** Cause: a 0.x minor changed an API under a caret range. Fix: pin exact versions and read the release notes before bumping.
7. **The drop zone flickers as the pointer crosses child elements.** Cause: `dragleave` fires when entering a child. Fix: ignore `dragleave` when `relatedTarget` is inside the zone.
8. **Two users reorder at once and one change is lost.** Cause: saving the whole order without a version. Fix: send the moved id and its neighbours, or a version number the server checks.

## Pre-merge checklist for drag and drop

1. One dnd-kit line is used; `@dnd-kit/react` versions are pinned exactly.
2. Items have stable ids; state updates use `move()` or `arrayMove()` on current state.
3. Drags work with pointer, touch and keyboard; Escape cancels and reverts.
4. A non-drag alternative (buttons or a menu) exists for every move.
5. Announcements use user-facing names; focus stays on the moved item.
6. The new order is saved optimistically with rollback and a visible status.
7. File drop zones also offer a file input.

See also: react-file-uploads, react-accessibility, react-data-fetching, react-virtual-lists.
