---
name: react-overlays-and-feedback
description: Builds dialogs, alert dialogs, drawers, popovers, dropdown menus, tooltips and toasts in React that work with a keyboard and a screen reader - choosing between the native dialog and popover elements, a headless library (Base UI, Radix) and Floating UI, focus on open and on close, Escape and outside-click dismissal, scroll lock and inert backgrounds, stacking nested overlays, confirmations versus undo, and toasts with Sonner that are announced but never steal focus. Use when adding a modal, a confirm step for a destructive action, a menu, a popover, a tooltip or a notification, when focus is lost after closing an overlay, a toast is not announced, a menu is clipped by a parent, or Escape closes the wrong layer.
metadata:
  tags:
  - react
  - dialog
  - modal
  - popover
  - menu
  - tooltip
  - toast
  - focus-management
  - accessibility
---

# React overlays and feedback

Overlays sit above the page: modal dialogs block it, popovers and menus float next to a trigger, tooltips describe a control, and toasts report what happened. Each has a fixed contract for focus, keyboard and announcements, and users notice when one is broken. This skill covers choosing the right overlay, building it on tested primitives, and giving feedback after actions.

## Step 0: read the installed overlay libraries

The headless library decides the component API, so read what the project has:

```bash
node -p "['react','@base-ui/react','radix-ui','@floating-ui/react','sonner','react-aria-components'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `@base-ui/react` 1.9.0, `radix-ui` 1.8.1, `@floating-ui/react` 0.27.20, `sonner` 2.0.8, `react` 19.3.1. Base UI parts take a `render` prop for composition, Radix parts take `asChild`.

## Decision table: which overlay for which job

Pick the overlay by what the user must do next:

| Need | Use | Why the others lose |
|---|---|---|
| A task that must finish or be cancelled before continuing | modal Dialog | a popover lets the user wander off mid-task |
| Confirm a destructive, irreversible action | AlertDialog with the safe button focused | a plain Dialog closes on outside click; a toast cannot block |
| A reversible action (archive, remove from list) | do it, then a toast with Undo | a confirm dialog on every delete trains users to click through |
| A list of actions for one object | Menu (menu button) | a popover of buttons lacks arrow keys and typeahead |
| Extra controls or info anchored to a trigger, non-blocking | Popover | a modal is heavier than needed |
| A short label for an icon button | Tooltip, plus `aria-label` on the button | a tooltip alone is invisible to touch users |
| Secondary content on small screens | Drawer (a dialog from the edge) | a centered modal wastes space on phones |
| Status after an action ("Saved", "Upload failed") | Toast in a live region | an alert dialog interrupts for news that needs no decision |

## Decision table: native elements, a headless library or Floating UI

| Option | Pick when | Loses when |
|---|---|---|
| Native `<dialog>` with `showModal()` | a simple modal in an app without a component library | you need animations on close, nested-stack control or consistent behaviour in older browsers |
| Native `popover` attribute | a simple non-modal popup with light dismiss and top-layer stacking | you must place it next to its trigger in browsers older than CSS anchor positioning (Chrome 125, Firefox 147, Safari 26; their initial value of `position-anchor` differs until Chrome 151, Firefox 151, Safari 27, so set it explicitly), or need the interactions Floating UI adds |
| Base UI or Radix parts | most apps: Dialog, AlertDialog, Popover, Menu, Tooltip, Toast with focus, keyboard and ARIA done | you need a widget they lack; build that one on Floating UI |
| `@floating-ui/react` | a custom floating widget: positioning, interactions, focus management as hooks | you would be rebuilding a Menu or Dialog the libraries already ship |

## Focus rules for modal dialogs

A modal dialog moves focus in, keeps it in, and gives it back. Every modal must:

1. Move focus into the dialog when it opens: to the first field, or to the least destructive button in an alert dialog, never to a Delete button.
2. Keep Tab and Shift+Tab inside the dialog; the page behind is `inert` (not focusable, not read).
3. Close on Escape and return focus to the element that opened it, or to a sensible next element if that one is gone (a deleted row's trigger).
4. Have an accessible name (`aria-labelledby` the title) and, when useful, a description.
5. Lock page scroll without shifting the layout.

The native `<dialog>` opened with `showModal()` and the Dialog parts of Base UI and Radix do all five. Base UI lets you choose the targets with `initialFocus` and `finalFocus` on `Dialog.Popup`; Radix uses `onOpenAutoFocus` and `onCloseAutoFocus` on `Dialog.Content`.

## Popovers, menus and positioning

Popovers and menus are non-modal: Tab may leave them, outside click and Escape close them, and focus returns to the trigger on Escape. Rules:

- Render floating content in a portal or the top layer, so a parent's `overflow: hidden` or `transform` cannot clip it.
- Let the library flip and shift the popup to stay in the viewport (Floating UI's `flip()` and `shift()` middleware, or the Positioner part).
- A Menu uses `role="menu"` with arrow keys, Home and End, and typeahead; its items are actions. A list of links is navigation, not a menu: use a disclosure with links.
- Keep one menu open at a time; opening another closes the first.

## Tooltips that meet WCAG 1.4.13

A tooltip shows on hover and on keyboard focus, stays while the pointer moves onto it, closes on Escape, and holds only a short description. Never put the only label, an error or an interactive element in a tooltip: touch and screen reader users may never see it. Icon buttons need `aria-label` even when they have a tooltip.

## Toasts that are announced and never steal focus

A toast is a status message in a live region: screen readers announce it politely and focus stays where the user is. Sonner mounts the region once with `<Toaster />`:

```tsx
import { Toaster, toast } from 'sonner'

<Toaster position="bottom-right" closeButton richColors theme="system" />   // once, at the app root

toast.success('Project archived', { action: { label: 'Undo', onClick: () => restore(id) }, duration: 8000 })
toast.promise(save(), { loading: 'Saving…', success: 'Saved', error: (e) => `Save failed: ${String(e)}` })
```

- Keep toasts short; give an action toast at least 8 seconds, and let hover or focus pause the timer (Sonner does).
- Do not put the only way to recover in a toast that disappears: keep Undo reachable elsewhere for important actions, or keep error toasts until dismissed (`duration: Infinity`).
- Errors that block the user's next step belong in the page next to the cause (`role="alert"`), not only in a toast.
- Base UI also ships a headless `Toast` (Provider, Viewport, Root, Title, Description, Action, Close) when you need full control of the markup.

## Worked example: delete with an alert dialog, pending state and toast

A destructive delete with an alert dialog that focuses Cancel, shows pending and error states inside the dialog, sends focus to the list heading after a delete (the row and its trigger are gone), and confirms with a toast:

```tsx
import { useRef, useState, useTransition, type RefObject } from 'react'
import { AlertDialog } from '@base-ui/react/alert-dialog'
import { toast } from 'sonner'

type Props = {
  project: { id: string; name: string }
  onDeleted: (id: string) => void
  focusAfterDelete: RefObject<HTMLElement | null>   // the list heading, rendered with tabIndex={-1}
}

export function DeleteProjectButton({ project, onDeleted, focusAfterDelete }: Props) {
  const [open, setOpen] = useState(false)
  const deleted = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function confirmDelete() {
    setError(null)
    startTransition(async () => {
      let res: Response
      try {
        res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' })
      } catch {                                             // uncaught here, a network failure would reach the error boundary
        setError('Could not reach the server. Check your connection and try again.')
        return
      }
      if (!res.ok) {
        setError(res.status === 403 ? 'You do not have permission to delete this project.' : 'Delete failed. Try again.')
        return
      }
      startTransition(() => {
        deleted.current = true
        setOpen(false)
        toast.success(`Deleted “${project.name}”`)
      })
    })
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => { if (!pending) { setOpen(next); setError(null) } }}
      // remove the row only after the close finished, so finalFocus runs while the dialog still exists
      onOpenChangeComplete={(isOpen) => { if (!isOpen && deleted.current) onDeleted(project.id) }}
    >
      <AlertDialog.Trigger className="btn btn-danger">Delete project</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-black/40" />
        {/* after a delete: the heading; after Cancel or Escape: true, the default (back to the trigger) */}
        <AlertDialog.Popup className="dialog" aria-busy={pending} finalFocus={() => (deleted.current ? focusAfterDelete.current : true)}>
          <AlertDialog.Title>Delete “{project.name}”?</AlertDialog.Title>
          <AlertDialog.Description>
            The project and its 3 environments are removed for everyone. This cannot be undone.
          </AlertDialog.Description>
          {error && <p role="alert" className="text-danger">{error}</p>}
          <div className="dialog-actions">
            <AlertDialog.Close className="btn" disabled={pending}>Cancel</AlertDialog.Close>
            <button type="button" className="btn btn-danger" onClick={confirmDelete} disabled={pending}>
              {pending ? 'Deleting…' : 'Delete project'}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
```

- Cancel comes first in the DOM, so it receives initial focus; Enter does not delete by accident.
- While the request runs, Escape and Cancel are ignored, so the dialog cannot close over a half-finished delete.
- `fetch` rejects when the network fails, and an async function in `useTransition` sends a rejection to the nearest error boundary, which would tear the dialog down. The `try`/`catch` keeps that failure inside the dialog with the others.
- After a delete the trigger is gone, so `finalFocus` returns the list heading; Cancel and Escape return `true`, which sends focus back to the trigger. A `null` from the ref falls back to that default, never to `<body>`.
- `onDeleted` runs in `onOpenChangeComplete`, after the close: removing the row while the dialog is still open would unmount it before focus moves.

Patterns for nested overlays, drawers, scroll lock, z-index layers and a Floating UI recipe: [overlay-patterns.md](references/overlay-patterns.md).

## Verify overlays and feedback

Check behaviour with the keyboard and a screen reader, then automate the critical parts:

- Keyboard pass: open each overlay with Enter or Space, Tab through it (focus never reaches the page behind), Escape closes only the top layer, focus returns to the trigger.
- Screen reader pass (VoiceOver or NVDA): the dialog's title is announced on open; toasts are announced without moving focus.
- Playwright: `await expect(page.getByRole('alertdialog', { name: /delete/i })).toBeVisible()`, press Escape, then `await expect(trigger).toBeFocused()`.
- Run axe on the page with each overlay open; check the overlay at 320 px width and 200 percent zoom.

## Gotchas and anti-patterns in overlays

Each gotcha names the symptom, its cause and the fix.

1. **Focus lands on `<body>` after closing.** Cause: the trigger unmounted or focus was never restored. Fix: use a library Dialog, and set the final focus target when the trigger disappears.
2. **A menu is cut off inside a card.** Cause: rendered inside an `overflow: hidden` or transformed parent. Fix: render it in a portal or the top layer.
3. **Escape closes the dialog and the popover inside it together.** Cause: two independent key listeners. Fix: use one library for both, which tracks the overlay stack; or stop propagation in the inner layer.
4. **The page scrolls behind a modal, or jumps when it opens.** Cause: no scroll lock, or a lock that removes the scrollbar without compensating. Fix: the library's scroll lock, or `scrollbar-gutter: stable` on `html`.
5. **Screen reader users read the page behind the modal.** Cause: a `div` overlay without `aria-modal` or `inert` on the background. Fix: `showModal()` or a library Dialog.
6. **A toast is never announced.** Cause: the live region is created together with its first message. Fix: mount `<Toaster />` once at the root, before any toast.
7. **A toast steals focus or hides the submit button.** Cause: a custom toast that calls `focus()`, or a position over the main action. Fix: never move focus to a toast; position it away from primary actions.
8. **Users delete by double-clicking.** Cause: the dialog's confirm button sits where the trigger was and receives the second click. Fix: focus Cancel first and place the destructive button away from the trigger position.

## Pre-merge checklist for overlays and feedback

1. The overlay type matches the job (modal, alert, popover, menu, tooltip, toast).
2. Built on native `<dialog>`/`popover` or a headless library, not on bare `div`s.
3. Focus moves in on open, stays inside modals, and returns on close, including after the trigger is removed.
4. Escape closes only the top layer; outside click closes non-modal overlays and plain dialogs, not alert dialogs.
5. Floating content renders in a portal or the top layer and stays in the viewport.
6. Toast region mounted once; toasts never take focus; errors that block are shown in the page.
7. Keyboard, screen reader and axe checks done with the overlay open.

See also: react-accessibility, react-design-system, react-composition-patterns, react-forms, react-animation.
