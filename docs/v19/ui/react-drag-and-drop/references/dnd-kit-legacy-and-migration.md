---
title: dnd-kit legacy API and migration
author: MOZGII, Inc.
lang: en
---

# dnd-kit legacy API and migration

The legacy dnd-kit line (`@dnd-kit/core` 6 with `@dnd-kit/sortable` 10 and `@dnd-kit/utilities` 3) is still in many codebases. This page shows its sortable pattern, maps it to the new `@dnd-kit/react` line, and lists the steps to migrate. Sources: the dndkit.com documentation (Latest and Legacy sections) and the packages' type definitions.

## A sortable list with @dnd-kit/core and @dnd-kit/sortable

The legacy line uses a context component, a sortable context with the item ids, and sensors configured by hand:

```tsx
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

function Row({ id }: { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}>
      <button type="button" {...attributes} {...listeners} aria-label={`Drag ${id}`}>⠿</button> {id}
    </li>
  )
}

export function LegacyList({ initial }: { initial: string[] }) {
  const [ids, setIds] = useState(initial)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    setIds((current) => arrayMove(current, current.indexOf(String(active.id)), current.indexOf(String(over.id))))
  }
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul>{ids.map((id) => <Row key={id} id={id} />)}</ul>
      </SortableContext>
    </DndContext>
  )
}
```

The legacy line needs the keyboard sensor added explicitly; without it, keyboard dragging does not work. `DragOverlay` renders a floating copy of the dragged item in a portal, which avoids clipping inside scroll containers.

## Legacy to new API map

| Legacy (`@dnd-kit/core`, `@dnd-kit/sortable`) | New (`@dnd-kit/react`, `@dnd-kit/helpers`) |
|---|---|
| `<DndContext sensors collisionDetection onDragEnd>` | `<DragDropProvider onDragStart onDragOver onDragEnd>`; pointer and keyboard sensors on by default |
| `<SortableContext items strategy>` | not needed; each `useSortable({ id, index })` knows its index |
| `useSortable({ id })` → `setNodeRef`, `attributes`, `listeners`, `transform`, `transition` | `useSortable({ id, index, group?, type?, accept? })` → `ref`, `handleRef`, `isDragging`, `isDropTarget` |
| `CSS.Transform.toString(transform)` on the item | not needed; the library animates the element |
| `arrayMove(ids, from, to)` from `@dnd-kit/sortable` | `move(items, event)` or `arrayMove` from `@dnd-kit/helpers` |
| `event.active.id`, `event.over.id` | `event.operation.source?.id`, `event.operation.target?.id` |
| cancel handled by not updating state | `event.canceled` on `dragend`; the library reverts its own optimistic moves |
| multiple `SortableContext`s for kanban | `group` on `useSortable`, `useDroppable` columns with `CollisionPriority.Low` |
| `announcements` prop on `DndContext` | the accessibility plugin's `announcements` and `screenReaderInstructions` |

## Steps to migrate a board to @dnd-kit/react

1. Install exact versions: `npm i -E @dnd-kit/react @dnd-kit/helpers @dnd-kit/abstract` (the last for imports such as `CollisionPriority`), and keep the legacy packages until the last screen moves.
2. Migrate one drag context (one list or one board) at a time; never put hooks of both lines under one provider.
3. Replace `DndContext` and `SortableContext` with `DragDropProvider`; pass `index` to each `useSortable`.
4. Replace `setNodeRef` and the spread `attributes`/`listeners` with `ref` (and `handleRef` for a handle); remove manual transform styles.
5. Replace the `onDragEnd` id lookup with `move(current, event)`; restore a snapshot when `event.canceled`.
6. Move custom announcements to the accessibility plugin's options.
7. Re-run the keyboard, touch and screen reader checks; remove the legacy packages when no import remains.

## Choosing between dnd-kit and native drag events

Native HTML drag and drop (`draggable`, `dragstart`, `drop`) is the only way to drag between browser windows, to the desktop, or to receive OS files. It has no keyboard support, inconsistent touch support and a drag image you barely control. Use dnd-kit for in-page reordering, native events (or `@atlaskit/pragmatic-drag-and-drop`, which wraps them) for cross-window and file scenarios.
