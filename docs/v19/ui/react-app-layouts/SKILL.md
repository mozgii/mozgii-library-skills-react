---
name: react-app-layouts
description: Builds application-style React screens that show several things at once - an app shell with CSS grid, resizable split views, a side peek panel driven by the URL, a status bar, hover previews with the Popover API, a command palette with keyboard shortcuts, light and dark themes that follow the OS with a user override, density, and complete loading, empty and error states, with notes for desktop shells such as Electron. Use when building a dashboard, admin tool, editor or any productivity app layout, adding a resizable panel, sidebar, command palette or theme switch, or when screens force users to switch pages just to check something.
metadata:
  tags:
  - react
  - layout
  - split-view
  - command-palette
  - theming
  - dark-mode
  - dashboard
  - desktop
---

# React app layouts

An application screen differs from a web page: people work in it for hours, compare things, and expect to see related information without navigating away. Good app layouts answer "what do I need to see at the same time?" with panes, peeks and an always-visible status area, and they keep that layout in the URL and in saved preferences. This skill covers those patterns in React 19.3 with plain CSS or Tailwind 4.

## Step 0: read the installed React, router and styling versions

Layouts lean on the router (the side peek lives in the URL), a small store for saved preferences, and the styling setup. Read what the project has, from its root:

```bash
node -p "['react','react-dom','react-router','@tanstack/react-router','zustand','tailwindcss'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `react` 19.3.1, `react-router` 8.5.1, `zustand` 5.0.16, `tailwindcss` 4.3.3. The Popover API, CSS grid and `prefers-color-scheme` used here are browser features and need no package.

## Choose split view, side peek, dialog or a new page

Choosing where secondary content opens decides whether people keep their place. Ask what the user must see at the same time, then take the matching row:

| The user needs to | Use | Why the alternatives lose |
|---|---|---|
| Work in two things at length (list and editor, source and preview) | a resizable split view | switching pages loses scroll, selection and the other half of the comparison |
| Glance at an item's details and keep scanning the list | a side peek bound to a search param | a modal hides the list and traps focus; a new page loses the place in the list |
| Finish one short task before anything else (confirm, rename) | a modal `<dialog>` | a peek lets the user wander off with the task half done |
| Focus on one long task (writing, a large form) | a full page with its own route | side panes crowd the content and halve the line length |
| Skim details while moving across many items | a hover preview after a delay, also reachable by click | opening each item costs a click and a close; a preview must never be the only path |
| Know that background work finished | a status bar | toasts vanish before people read them; dialogs interrupt |

## Design every state of a data view

Every screen that shows data has at least four states, and each needs a design before the screen is done:

| State | Show |
|---|---|
| Loading, first time | a skeleton shaped like the content, after about 150 ms (fast responses show nothing) |
| Loading, refreshing | the old content plus a small progress hint; never blank it |
| Empty | what this area is for and the one action that fills it ("No invoices yet" plus "Create invoice") |
| Error | what failed, in plain words, and Try again; the rest of the screen keeps working |
| Success | the content, with a clear primary action |
| Partial or offline | what is stale and when it was last updated |

Skeletons match the final layout so nothing jumps when data arrives (no layout shift). Data states come from the query (`react-data-fetching`); failures are contained by boundaries (`react-error-handling`).

## App shell with CSS grid

The app shell is the frame that stays while content changes: navigation, header, main area and status bar. CSS grid with named areas keeps it simple:

```tsx
export function AppShell({ nav, header, children, status }: { nav: React.ReactNode; header: React.ReactNode; children: React.ReactNode; status: React.ReactNode }) {
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to main content</a>
      <nav aria-label="Main" className="app-nav">{nav}</nav>
      <header className="app-header">{header}</header>
      <main id="main" className="app-main">{children}</main>
      <footer className="app-status" aria-label="Status">{status}</footer>
    </div>
  )
}
```

```css
.app-shell {
  display: grid; height: 100dvh;
  grid-template: "nav header" auto "nav main" 1fr "nav status" 28px / var(--nav-width, 240px) 1fr;
}
.app-nav { grid-area: nav; overflow: auto; }
.app-header { grid-area: header; }
.app-main { grid-area: main; overflow: auto; min-width: 0; }
.app-status { grid-area: status; }
@media (max-width: 768px) { .app-shell { grid-template: "header" auto "main" 1fr "status" 28px / 1fr; } .app-nav { display: none; } }
```

- `min-width: 0` on grid children stops long content from pushing columns wider.
- The main area scrolls, not the page, so header and status bar never scroll away.
- `100dvh` uses the dynamic viewport height, which is correct on mobile browsers with moving toolbars.

## Resizable split view

A split view shows two panes side by side with a draggable separator. Store the split as a fraction so it survives window resizes, update it while dragging, and save it when the drag ends. Full component with pointer capture and keyboard support: [layout-patterns.md](references/layout-patterns.md).

- The separator is a focusable `role="separator"` with `aria-orientation`, `aria-valuenow` and arrow-key resizing.
- Clamp the fraction (for example 15 to 80 percent) so a pane never disappears by accident; offer a collapse button instead.
- Save sizes per layout in user preferences (local storage or the server), not per session.

## Side peek driven by the URL

A side peek opens an item's details next to the list, so the user keeps their place. Bind it to a search param, so Back closes it and a link reopens it:

```tsx
import { useEffect, useEffectEvent, useRef } from 'react'
import { useSearchParams } from 'react-router'

export function InvoicesScreen() {
  const [params, setParams] = useSearchParams()
  const peekId = params.get('peek')
  const opener = useRef<HTMLElement | null>(null)
  const open = (id: string) => {
    opener.current = document.activeElement as HTMLElement | null
    setParams((p) => { p.set('peek', id); return p })
  }
  const close = () => {
    setParams((p) => { p.delete('peek'); return p })
    opener.current?.focus()
  }
  const onEscape = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('dialog:modal')) close()
  })
  useEffect(() => {                                       // on the document: focus usually stays on the list
    if (!peekId) return
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [peekId])
  return (
    <div className="with-peek" data-peek={peekId ? 'open' : 'closed'}>
      <InvoiceTable onOpen={open} selectedId={peekId} />
      {peekId && (
        <aside aria-label="Invoice details" className="peek">
          <button type="button" onClick={close} aria-label="Close details">×</button>
          <InvoicePeek id={peekId} />
        </aside>
      )}
    </div>
  )
}
```

The same URL then describes the whole screen: list filters, the selected row and the peek. With TanStack Router, validate `peek` in `validateSearch`. Escape listens on the document because a peek is not a dialog: the user keeps working in the list, and a handler on the panel would fire only with focus inside it. A modal dialog open on top keeps Escape for itself.

## Status bar for background work

A status bar is a thin strip, always visible, that shows what is happening in the background: running jobs, sync state, connection, the last error. Users stop wondering whether something finished.

| Slot | Content |
|---|---|
| Activity | count of running jobs, the latest label, overall progress |
| Sync | saved, saving, offline with N pending changes |
| Connection | live updates connected or reconnecting |
| Last error | one line; click opens details |

Feed it from small external stores (one render per frame for progress, `react-performance`), so a busy queue never re-renders the page above it. Announce important changes through a polite live region (`react-accessibility`).

## Hover previews with the Popover API

A hover preview shows details of an item when the pointer rests on it, after about 400 ms, and hides 100 ms after it leaves, so sweeping across a list does not flash previews. It stays open while the pointer is over the preview itself, and Escape closes it wherever focus is (WCAG 1.4.13, Content on Hover or Focus). The HTML Popover API puts the preview in the top layer without a portal library:

```tsx
import { useEffect, useRef } from 'react'

export function HoverPreview({ id, label, children }: { id: string; label: React.ReactNode; children: React.ReactNode }) {
  const timer = useRef<number | undefined>(undefined)
  const pop = useRef<HTMLDivElement>(null)
  const popId = `preview-${id}`
  const toggle = (open: boolean, delay: number) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => pop.current?.togglePopover(open), delay)    // the force argument: no error if already there
  }
  const show = () => toggle(true, 400)
  const hide = () => toggle(false, 100)
  const stay = () => window.clearTimeout(timer.current)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggle(false, 0) }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); window.clearTimeout(timer.current) }
  }, [])
  return (
    <>
      <button type="button" onPointerEnter={show} onPointerLeave={hide} onFocus={show} onBlur={hide} aria-describedby={popId}
        style={{ anchorName: `--a-${id}` } as React.CSSProperties}>{label}</button>
      <div ref={pop} id={popId} popover="manual" role="tooltip" className="preview" onPointerEnter={stay} onPointerLeave={hide}
        style={{ positionAnchor: `--a-${id}`, top: 'anchor(bottom)', left: 'anchor(left)', margin: 0 } as React.CSSProperties}>
        {children}
      </div>
    </>
  )
}
```

- `margin: 0` matters: the browser's popover styles set `margin: auto`, which pushes an anchored popover away from its anchor.
- `popover="manual"` gets no light dismiss and no built-in Escape, so the component closes it itself.
- The preview repeats what a click reveals; keyboard and touch users must reach the same information.
- Prefetch the preview's data on pointer enter (`queryClient.query(...).catch(() => {})`), so it is cached by 400 ms.
- CSS anchor positioning support differs between browsers; check your audience's browsers, or position with Floating UI (`@floating-ui/react`) as a fallback.

## Command palette and keyboard shortcuts

A command palette (Ctrl+K or Cmd+K) lets users run any command by typing its name. Build it from one command registry that also feeds menus and shortcut hints, so they never disagree:

```ts
// src/app/commands.ts
export type Command = { id: string; label: string; shortcut?: string; run: () => void; enabled?: () => boolean }
export const commands: Command[] = [
  { id: 'invoice.new', label: 'New invoice', shortcut: 'Alt+Shift+N', run: () => router.navigate('/invoices/new') },
  { id: 'theme.toggle', label: 'Toggle dark mode', run: () => prefs.toggleTheme() },
]
```

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true) }
  }
  window.addEventListener('keydown', onKey)
  return () => window.removeEventListener('keydown', onKey)
}, [])
```

- "Mod" means Cmd on macOS and Ctrl elsewhere; show the right symbol per platform.
- Do not override browser and OS shortcuts users rely on (Ctrl+T, Ctrl+W, Cmd+Q). Chrome never hands Ctrl+N, Ctrl+T or Ctrl+W to a page in a normal tab, so a `Mod+N` shortcut opens a new window there instead of running your command; on the web, pick a free chord such as Alt+Shift+N, which matches on `e.code`, because macOS changes `e.key` under Option.
- Ignore single-key shortcuts while focus is in an input, textarea or contenteditable.
- The palette itself is a dialog with an editable combobox: use a library (cmdk, React Aria) for the keyboard and screen reader behaviour.

## Light and dark themes with a user override

A theme follows the OS by default and lets the user override it. Store the choice (`system`, `light`, `dark`), resolve it to a theme, and set it on the root element:

```ts
// src/shared/lib/theme.ts
export type ThemeChoice = 'system' | 'light' | 'dark'
const media = window.matchMedia('(prefers-color-scheme: dark)')

export function applyTheme(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && media.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'     // native controls and scrollbars follow
}
```

```html
<!-- index.html, before the app script: no flash of the wrong theme -->
<script>
  try { const c = localStorage.getItem('theme') ?? 'system';
        const d = c === 'dark' || (c === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.dataset.theme = d ? 'dark' : 'light' } catch {}
</script>
```

- Listen to `media.addEventListener('change', …)` while the choice is `system`, so the app follows the OS live.
- Define colours as CSS variables per theme (`[data-theme="dark"] { --surface: … }`); with Tailwind 4, `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));` makes `dark:` utilities follow the attribute.
- Check both themes for contrast; dark mode is not inverted colours.

## Density and desktop-like behaviour

Productivity apps often need more on screen than content sites. Offer a compact density (smaller row heights and paddings through CSS variables) rather than shrinking text, and keep pointer targets at least 24 px. Other habits:

- Keep selection, scroll position and open panels when switching between views (`<Activity>`, `react-performance`).
- Use the system font stack (`system-ui`) for UI text so the app feels native on each OS.
- Multi-select with Shift and Cmd or Ctrl click in lists, plus keyboard equivalents (Shift+Arrow, Space).
- Right-click menus only duplicate actions available elsewhere.

## Desktop shells: Electron and Tauri notes

In a desktop shell the same React layouts apply, with a few platform details. A frameless window needs a drag region: `-webkit-app-region: drag` on the title bar and `no-drag` on every button and input inside it, or clicks move the window. Read the OS theme and accent colour from the shell (Electron's `nativeTheme` and `systemPreferences.getAccentColor()`) and set them as CSS variables. Several windows of one app share one origin, so `localStorage` is shared between them; keep per-window layout state in the main process or key it by window. Register global shortcuts in one place (menu accelerators in the main process), and have the renderer react to the menu event instead of binding the same keys, or the shortcut fires twice.

## Worked example: a data pane with every state

A worked example of the state table above: one `DataPane` renders loading, error, empty, refreshing, offline and success the same way in every pane of the app. The skeleton appears only after 150 ms through CSS, so fast responses never flash it:

```tsx
// src/shared/ui/DataPane.tsx
import type { ReactNode } from 'react'

export type PaneState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; onRetry: () => void }
  | { status: 'ready'; data: T; refreshing: boolean; updatedAt: Date; offline?: boolean }

const time = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

type DataPaneProps<T> = {
  title: string
  state: PaneState<T>
  skeleton: ReactNode
  isEmpty: (data: T) => boolean
  empty: ReactNode
  children: (data: T) => ReactNode
}

export function DataPane<T>({ title, state, skeleton, isEmpty, empty, children }: DataPaneProps<T>) {
  const busy = state.status === 'loading' || (state.status === 'ready' && state.refreshing)
  return (
    <section aria-label={title} aria-busy={busy} className="pane">
      <header className="pane-header">
        <h2>{title}</h2>
        {state.status === 'ready' && state.refreshing && <span role="status" className="pane-hint">Updating…</span>}
        {state.status === 'ready' && state.offline && <span role="status">Offline. Last updated {time.format(state.updatedAt)}</span>}
      </header>
      {state.status === 'loading' && (
        <><p className="sr-only">Loading {title}…</p><div className="pane-skeleton" aria-hidden="true">{skeleton}</div></>
      )}
      {state.status === 'error' && (
        <div role="alert" className="pane-error">
          <p>{title} could not be loaded. {state.message}</p>
          <button type="button" onClick={state.onRetry}>Try again</button>
        </div>
      )}
      {state.status === 'ready' && (isEmpty(state.data) ? empty : children(state.data))}
    </section>
  )
}
```

```css
.pane { min-width: 0; min-height: 0; overflow: auto; }
.pane-skeleton { animation: pane-appear 0s 150ms both; }      /* hidden for the first 150 ms */
@keyframes pane-appear { from { visibility: hidden; } }
```

- Refreshing keeps the old content and adds a small hint, as the state table says; it never blanks the pane.
- A failure in one pane shows its alert and retry while the rest of the shell keeps working.

## Verify an app layout

A layout is proven at the extremes: the smallest and largest windows, both themes, keyboard only, and a reload in every state the URL describes. Check:

```bash
npx tsc -b && npx oxlint --deny-warnings
npx vitest run src/shared/ui src/features/invoices     # DataPane states; peek opens and closes through the URL
```

- URL state: open a peek, reload, then press Back; the peek survives the reload and Back closes it. A memory-router test can assert `router.state.location.search` after each step.
- Sizes: a 320 px wide window and 200 percent zoom show no horizontal page scroll; a long file name truncates instead of pushing the sidebar away.
- Keyboard: Tab reaches the split separator, arrow keys resize it, Escape closes the peek with focus still in the list, and closes the palette; focus returns to what opened them.
- Hover preview: move the pointer from the item onto the preview and it stays open; press Escape with focus anywhere and it closes.
- Themes: take a screenshot of each main screen in light and dark (Playwright `page.emulateMedia({ colorScheme: 'dark' })`); reload with the dark choice saved and see no light flash.
- CSP: if the inline theme script stays inline, its hash is in `script-src` (`react-security`).

## Pre-merge checklist for an app layout

Check each point before merging a layout change.

1. Every data area designed for loading, refreshing, empty, error and success.
2. App shell on CSS grid; only the main area scrolls; `min-width: 0` on grid children.
3. Split panes resizable with pointer and keyboard; sizes saved in preferences.
4. Peek panels and selection in the URL; Escape closes; Back works.
5. A status bar shows background work, fed by small external stores.
6. Hover previews delayed, keyboard reachable, hoverable, closed by Escape and never the only path to information.
7. One command registry for palette, menus and shortcut hints; no clashes with browser shortcuts.
8. Theme follows the OS, user override stored, no flash on load, both themes checked for contrast.

## Gotchas and anti-patterns in app layouts

Each entry gives the symptom you see, its cause and the fix.

1. **A long file name pushes the sidebar off screen.** Cause: grid and flex children default to `min-width: auto`. Fix: `min-width: 0` on the pane and `overflow: hidden` or text truncation inside.
2. **The page flashes light before dark.** Cause: the theme is applied after React mounts. Fix: the inline script in `index.html` before the bundle.
3. **Back does not close the side panel.** Cause: panel state in component state. Fix: a search param.
4. **The whole page re-renders while a job reports progress.** Cause: progress in React state at the top. Fix: an external store read by the status bar only.
5. **Hover previews flash while moving across a list.** Cause: no show delay. Fix: about 400 ms delay to show, 100 ms to hide.
6. **Ctrl+K opens the palette and the browser's search bar.** Cause: missing `preventDefault()`. Fix: call it in the handler.
7. **Buttons in a desktop title bar do not respond.** Cause: the drag region covers them. Fix: `-webkit-app-region: no-drag` on interactive elements.
8. **Anti-pattern: the whole page scrolls.** Symptom: the header and status bar scroll away, and two scrollbars appear in nested panes. Cause: `height: auto` on the shell. Fix: `height: 100dvh` on the grid and `overflow: auto` only on panes.
9. **A hover preview appears in the middle of the screen, far from its item.** Cause: the popover's default `margin: auto`. Fix: `margin: 0` on the popover.
10. **Pressing Ctrl+N opens a browser window, not the command.** Cause: Chrome keeps that chord for itself. Fix: choose a chord the browser passes through.
11. **Anti-pattern: every detail opens in a modal.** Symptom: users open, close and reopen dialogs to compare two items. Cause: the dialog was the default choice. Fix: the decision table at the top; a peek or a split view for anything people compare.

## See also

- `react-design-system`: tokens, density scales and the shared components panes are built from.
- `react-virtual-lists`: long lists and tables inside panes.
- `react-accessibility`, `react-router-data-mode` (URL state), `react-performance` (`<Activity>` for hidden panels).
