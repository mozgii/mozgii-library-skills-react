---
title: React overlay patterns
author: MOZGII, Inc.
lang: en
---

# React overlay patterns

Recipes for the overlay cases that go wrong most: nested overlays, drawers, scroll lock, stacking, a custom floating widget with Floating UI, the native dialog in React, and opening dialogs from anywhere. Sources: WAI-ARIA Authoring Practices Guide (dialog, menu button, tooltip patterns), WCAG 2.2 success criteria 1.4.13 and 2.4.11, the Floating UI React documentation, the Base UI and Radix documentation.

## Native dialog element in React

The native `<dialog>` opened with `showModal()` puts the dialog in the top layer, makes the rest of the page inert, closes on Escape and restores focus on close. A controlled wrapper:

```tsx
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose() }}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  )
}
```

- `onCancel` fires on Escape; preventing it and calling `onClose` keeps React state as the source of truth.
- Close on backdrop click by checking `e.target === e.currentTarget` in an `onClick` on the dialog; the `closedby="any"` attribute does this natively where supported.
- Style the backdrop with `dialog::backdrop`. Closing animations need `@starting-style` and `transition-behavior: allow-discrete`, or a library.

## Nested overlays and the Escape stack

A popover inside a dialog, or a confirm dialog opened from a drawer, forms a stack. Only the top layer reacts to Escape and outside clicks. Libraries keep this stack when all layers come from the same library; mixing two libraries, or a library with hand-written key listeners, breaks it. When a custom layer must join, listen on the layer element (not `document`) and call `event.stopPropagation()` after handling Escape.

## Drawers and sheets

A drawer is a modal dialog that enters from an edge. It follows every dialog focus rule. Base UI 1.x ships a `Drawer`; with Radix, style a `Dialog.Content` to slide from the edge. On phones prefer a bottom sheet for short choices; give it a visible close button, since swipe-to-close is not discoverable and not keyboard accessible.

## Scroll lock without layout shift

Locking scroll by setting `overflow: hidden` on `<body>` removes the scrollbar and shifts the page sideways on desktop. Either reserve the gutter permanently with `html { scrollbar-gutter: stable; }`, or let the library add padding equal to the scrollbar width. On iOS, `overflow: hidden` on `body` is not always enough; library scroll locks handle touch scrolling.

## z-index layers for overlays

Overlays in the top layer (`showModal()`, `popover`) sit above every z-index. Overlays in portals need an agreed scale, defined once as tokens:

| Layer | Token | Typical value |
|---|---|---|
| Sticky headers | `--z-sticky` | 10 |
| Dropdowns, popovers | `--z-popover` | 50 |
| Drawers, dialogs | `--z-dialog` | 100 |
| Toasts | `--z-toast` | 200 |
| Tooltips | `--z-tooltip` | 300 |

Never write `z-index: 9999` in a component; it starts an arms race that the next overlay loses.

## A custom popover with Floating UI

For a widget no library ships (an emoji picker, a colour picker), Floating UI supplies positioning, interactions and focus management as hooks:

```tsx
import { autoUpdate, flip, offset, shift, useClick, useDismiss, useFloating, useInteractions, useRole, FloatingFocusManager, FloatingPortal } from '@floating-ui/react'

export function Picker({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open, onOpenChange: setOpen, placement: 'bottom-start',
    middleware: [offset(6), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context), useRole(context, { role: 'dialog' })])
  return (
    <>
      <button type="button" ref={refs.setReference} {...getReferenceProps()}>{label}</button>
      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div ref={refs.setFloating} style={floatingStyles} aria-label={label} {...getFloatingProps()}>{children}</div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  )
}
```

`useDismiss` handles Escape and outside press; `useRole` sets `aria-haspopup`, `aria-expanded` and `aria-controls`; `FloatingFocusManager` moves focus in and returns it.

## Opening a dialog from anywhere

Some dialogs are opened from places far from where they render (a command palette, a global "new project" shortcut). Keep one dialog component mounted at the layout and control it from a small store or the URL (`?dialog=new-project`), rather than rendering dialogs inside list rows. The URL approach makes the dialog linkable and closes it on back navigation. Base UI's `createHandle` connects a trigger to a dialog rendered elsewhere.

## Focus not obscured by sticky bars and toasts

WCAG 2.2 success criterion 2.4.11 (Focus Not Obscured, AA) requires that a focused element is not entirely hidden by author content. Sticky headers, cookie banners and toasts can hide the focused field. Add `scroll-padding-top` and `scroll-padding-bottom` on `html` equal to the sticky bars' height, and keep toasts in a corner away from forms.

## Confirmation copy for destructive dialogs

Name the object and the consequence in the title and body, and repeat the verb on the button: "Delete “Q3 report”?", "The report and its 12 comments are removed for everyone.", buttons "Cancel" and "Delete report". Avoid "Are you sure?" with "Yes" and "No": users must read the body to know what Yes does. For high-risk actions ask the user to type the object's name before the button enables.
