---
name: react-accessibility
description: Builds accessible React interfaces to WCAG 2.2 AA - semantic HTML first, accessible names, labels and descriptions, keyboard operation and visible focus, focus management on route changes and in dialogs, ARIA used correctly for custom widgets, live regions for async updates, reduced motion, colour contrast, and checking with linters, axe-core, Testing Library roles and a screen reader. Use when building or reviewing any interactive component, a dialog, menu, tabs or combobox, a form, when a screen reader or keyboard user cannot reach something, before a release, or when an accessibility audit reports issues.
metadata:
  tags:
  - react
  - accessibility
  - a11y
  - aria
  - wcag
  - keyboard
  - focus
  - screen-reader
---

# React accessibility

An accessible React app can be used with a keyboard alone, with a screen reader, with zoom at 200 percent and with reduced motion, and meets WCAG 2.2 level AA. React does not make this harder or easier than HTML does; most problems come from replacing native elements with `div`s and forgetting what the native element did for free. This skill covers what to do in React components and how to check it.

## Step 0: read the installed React and accessibility tools

Which checks you can run depends on what the project already has. Read the React version and the test and scan tools from the project root:

```bash
node -p "['react','react-dom','@testing-library/react','@playwright/test','@axe-core/playwright','axe-core','eslint-plugin-jsx-a11y','oxlint'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `react` 19.3.1, `axe-core` 4.14.0, `@axe-core/playwright` 4.14.0, `@playwright/test` 1.64.1, `eslint-plugin-jsx-a11y` 6.10.2, `oxlint` 1.90.0. A `missing` Playwright or `@axe-core/playwright` line means the page scan in Verify needs them installed first; everything else in this skill is plain React and HTML.

## Use semantic HTML first

Native elements carry roles, keyboard behaviour and states that assistive technology already understands. Reach for them before ARIA:

| Need | Use | Not |
|---|---|---|
| An action | `<button type="button">` | `<div onClick>` |
| Navigation to a URL | `<a href>` or the router's `<Link>` | `<button onClick={() => navigate()}>` |
| A field | `<input>`, `<select>`, `<textarea>` with `<label>` | a contenteditable `div` |
| A group of choices | `<fieldset>` with `<legend>` | a `div` with a heading |
| Page regions | `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>` | `div`s with classes |
| A modal | `<dialog>` with `showModal()` | a `div` overlay |
| Disclosure | `<details>` and `<summary>` | a custom toggle, when the styling allows |

A `div` with `onClick` is not focusable, does not respond to Enter or Space, and is announced as plain text. Adding `role="button"`, `tabIndex={0}` and key handlers rebuilds what `<button>` already is.

## Choose native HTML, a headless library or custom ARIA

Choosing how to build an interactive widget decides most of its accessibility before any code is written. Take the first row that fits:

| Widget | Build it with | Why the alternatives lose |
|---|---|---|
| Button, link, text field, checkbox, radio, select, disclosure, modal | the native element (`<button>`, `<a>`, `<input>`, `<select>`, `<details>`, `<dialog>`) | custom ARIA must rebuild focus, keyboard and states that browsers and screen readers already support |
| Tabs, menu button, toolbar, simple listbox | a headless library, or a small component that follows its APG pattern exactly | an improvised keyboard model confuses screen reader users who expect the APG one |
| Combobox with autocomplete, date picker, tree, grid, drag and drop, virtualized listbox | a tested headless library (React Aria, Radix Primitives, Base UI, Ariakit, Headless UI) | hand-built versions miss screen reader and browser quirks that take years to find |
| A message that appears after async work | a live region mounted in advance | moving focus to every message interrupts the user; no announcement leaves them guessing |
| Extra information on hover | `aria-describedby` to a tooltip or popover that is never the only source | the `title` attribute is not shown on keyboard focus or touch |

## Accessible names, labels and descriptions

Every interactive element needs an accessible name, which is what a screen reader says and what `getByRole(…, { name })` matches:

```tsx
<label htmlFor={id}>Email</label><input id={id} type="email" autoComplete="email" />      // visible label
<button aria-label="Close dialog"><XIcon aria-hidden /></button>                           // icon-only button
<nav aria-label="Breadcrumb">…</nav>                                                        // distinguishes two navs
<input aria-describedby={`${id}-hint`} /><p id={`${id}-hint`}>8 characters or more</p>     // extra description
```

- Generate ids with `useId()`, never hard-code them in reusable components.
- Decorative icons get `aria-hidden`; informative images get `alt` text that says what the image tells; decorative images get `alt=""`.
- The visible label text should be part of the accessible name (WCAG 2.5.3), so voice-control users can say what they see.
- Link text says where it goes ("View invoice 2026-001"), not "click here".

## Keyboard operation and visible focus

Everything a mouse can do, a keyboard must do: reach it with Tab, operate it with Enter, Space or arrow keys, and leave it again. Rules:

- Tab order follows the visual order; do not use positive `tabIndex` values.
- Focus is always visible. Style `:focus-visible` with a clear outline (at least 2 px, contrasting); never `outline: none` without a replacement.
- Composite widgets (tabs, menus, listboxes, grids, toolbars) are one Tab stop with arrow keys inside, using roving `tabIndex` (the active item `0`, the rest `-1`).
- Escape closes the topmost popup and returns focus to what opened it.
- Pointer-only gestures (drag, hover) need a keyboard or single-click alternative (WCAG 2.5.7 for dragging).

## Focus management in single-page apps

A single-page app changes content without a page load, so the browser does not move focus or announce the new page. Manage it explicitly:

```tsx
// in the root layout: move focus to the main heading after navigation
const location = useLocation()
const heading = useRef<HTMLHeadingElement>(null)
useEffect(() => { heading.current?.focus() }, [location.pathname])

<main><h1 ref={heading} tabIndex={-1}>{title}</h1>…</main>
```

- Update `document.title` per route (React 19 `<title>` in the route component).
- Provide a "Skip to main content" link as the first focusable element.
- After deleting an item, move focus to the next item or the list heading, not to `<body>`.
- After a failed form submit, focus the first invalid field or an error summary.

## Dialogs and focus trapping

A modal dialog must take focus when it opens, keep Tab inside, close on Escape, and return focus to the trigger when it closes. The native `<dialog>` element with `showModal()` does the trapping, Escape and inert background for you:

```tsx
export function ConfirmDialog({ open, title, children, onClose }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={onClose}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  )
}
```

The browser returns focus to the previously focused element when a modal `<dialog>` closes. For non-modal popovers, the HTML `popover` attribute gives light dismiss and top-layer stacking without a portal.

## ARIA for custom widgets

ARIA adds roles, states and properties when no native element fits. Follow the WAI-ARIA Authoring Practices Guide (APG) pattern for the widget exactly, since screen readers expect that keyboard model. The first rule of ARIA: if a native element does the job, use it. Common patterns and their key parts: [widget-patterns.md](references/widget-patterns.md).

- State attributes must follow state: `aria-expanded`, `aria-selected`, `aria-checked`, `aria-pressed`, `aria-current="page"`.
- `role` changes what the element is announced as but adds no behaviour; you write the keyboard handling.
- For complex widgets (combobox, date picker, tree, grid, drag and drop), use a tested headless library: React Aria, Radix Primitives, Base UI, Ariakit or Headless UI.

## Live regions for async updates

Content that changes without a page load (a toast, "3 results", "Saved", an error after submit) is silent to screen readers unless it is in a live region that exists before the change:

```tsx
// render once, keep mounted; change only its text
<div role="status" aria-live="polite" className="sr-only">{statusMessage}</div>
<div role="alert">{errorMessage}</div>        // assertive: interrupts; use for errors only
```

- Mount the region empty first, then set the text; a region added together with its text is often not announced.
- Do not announce every keystroke result; debounce search counts.
- `aria-busy="true"` on a region while it loads tells assistive technology to wait.

## Motion, colour and zoom

Reduced motion, colour contrast and zoom are visual settings that WCAG 2.2 AA covers as much as keyboard and screen reader use:

- Respect reduced motion: CSS `@media (prefers-reduced-motion: reduce)` and `useReducedMotion()` from Motion; replace movement with fades (`react-animation`).
- Text contrast at least 4.5:1 (3:1 for large text), UI component and focus indicator contrast at least 3:1.
- Never use colour alone to show state or errors; add text or an icon.
- Layout works at 200 percent zoom and at 320 CSS px width without horizontal scrolling (reflow).
- Target size at least 24 by 24 CSS px for pointer targets (WCAG 2.5.8).

## Check accessibility with tools and people

Automated tools find roughly a third to half of issues; the rest needs a keyboard and a screen reader. Use all layers:

| Check | How |
|---|---|
| Lint while coding | Oxlint `jsx-a11y` plugin, off by default (setup below), or `eslint-plugin-jsx-a11y` on ESLint 9 |
| Component tests | Testing Library `getByRole` with `name`: a test that cannot find the element by role found a bug |
| Automated scan in tests | `axe-core` on rendered components (`react-testing` recipes) |
| Automated scan of pages | `node <this-skill>/scripts/axe-check.mjs <url>` (Playwright + `@axe-core/playwright`, against `npm run preview`) |
| Manual keyboard pass | unplug the mouse: Tab through every screen, operate every control |
| Screen reader pass | VoiceOver (macOS, iOS), NVDA (Windows), TalkBack (Android) on the main journeys |

Oxlint leaves the `jsx-a11y` plugin off until you list it in `.oxlintrc.json`. The `plugins` list replaces the defaults, so name the others too:

```json
{ "plugins": ["react", "typescript", "oxc", "jsx-a11y"], "categories": { "correctness": "error" }, "rules": { "jsx-a11y/prefer-tag-over-role": "off" } }
```

For a one-off run without a config, `npx oxlint --jsx-a11y-plugin -A jsx-a11y/prefer-tag-over-role` turns the plugin on.

That one rule stays off because its warning is wrong for this skill's examples. It tells you to swap `role="status"` for `<output>`, but `<output>` means the result of a calculation or user action and holds phrasing content only, so a toast region or an empty state with a heading cannot be one. It also flags `role="img"` on an inline `svg`, where no tag can replace the role. A clickable `div` with no focus or key handler is still caught by `interactive-supports-focus` and `click-events-have-key-events`.

## Worked example: an accessible member search with removal

A worked example of the rules together: a labelled search field, a results region that is busy while loading, a polite live region mounted in advance that announces the debounced count, an error alert with retry, an empty message, and focus that moves to the next row after a removal instead of falling to `<body>`:

```tsx
// src/features/members/MemberSearch.tsx
import { useEffect, useId, useRef, useState } from 'react'

export type Member = { id: string; name: string; role: string }
export type MemberResults =
  | { status: 'loading' }
  | { status: 'error'; onRetry: () => void }
  | { status: 'ready'; members: readonly Member[] }

type Props = { query: string; onQueryChange: (q: string) => void; results: MemberResults; onRemove: (id: string) => Promise<void> }

export function MemberSearch({ query, onQueryChange, results, onRemove }: Props) {
  const id = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const [announcement, setAnnouncement] = useState('')
  const [removeError, setRemoveError] = useState<string | null>(null)
  const members = results.status === 'ready' ? results.members : []
  const count = results.status === 'ready' ? members.length : null

  useEffect(() => {
    if (count === null) return
    const timer = window.setTimeout(() => setAnnouncement(`${count} ${count === 1 ? 'member' : 'members'} found`), 500)
    return () => window.clearTimeout(timer)
  }, [count])

  async function remove(index: number, member: Member) {
    const next = members[index + 1] ?? members[index - 1]
    setRemoveError(null)
    try { await onRemove(member.id) } catch { setRemoveError(`${member.name} could not be removed. Try again.`); return }
    if (next) buttons.current.get(next.id)?.focus()
    else heading.current?.focus()
    setAnnouncement(`${member.name} removed`)
  }

  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} ref={heading} tabIndex={-1}>Members</h2>
      <label htmlFor={id}>Search members</label>
      <input id={id} type="search" value={query} onChange={(e) => onQueryChange(e.currentTarget.value)} />
      <p role="status" className="sr-only">{announcement}</p>
      {removeError && <p role="alert">{removeError}</p>}
      <div aria-busy={results.status === 'loading'}>
        {results.status === 'loading' && <p>Searching…</p>}
        {results.status === 'error' && (
          <div role="alert"><p>Members could not be loaded.</p><button type="button" onClick={results.onRetry}>Try again</button></div>
        )}
        {results.status === 'ready' && members.length === 0 && <p>No members match “{query}”.</p>}
        {members.length > 0 && (
          <ul aria-label="Search results">
            {members.map((m, i) => (
              <li key={m.id}>
                {m.name}, {m.role}{' '}
                <button type="button" onClick={() => void remove(i, m)}
                  ref={(node) => { if (node) buttons.current.set(m.id, node); return () => { buttons.current.delete(m.id) } }}>
                  Remove {m.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
```

- Each Remove button names its row ("Remove Ada Lovelace"), so a screen reader's list of buttons makes sense out of context.
- The next row's button keeps its DOM node across the re-render (same key), so focusing it right after the await is safe.

## Verify React accessibility

Accessibility is proven by three layers: lint and role-based tests in CI, an axe scan of the built pages, and a manual keyboard and screen reader pass. Run:

```bash
npx oxlint --deny-warnings                                    # jsx-a11y plugin on
npx vitest run src/features/members                           # role-based tests, plus axe-core on rendered output
npm run build
npx vite preview --port 4173 --strictPort &                   # then scan the real pages
sleep 2
node <this-skill>/scripts/axe-check.mjs http://localhost:4173/ http://localhost:4173/members   # exit 0: no WCAG A/AA violations
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

```tsx
// a role-based test for the worked example
test('announces results and keeps focus after removal', async () => {
  const user = userEvent.setup()
  const members = [{ id: 'a', name: 'Ada', role: 'Admin' }, { id: 'b', name: 'Bo', role: 'Member' }]
  render(<MemberSearch query="" onQueryChange={vi.fn()} results={{ status: 'ready', members }} onRemove={async () => {}} />)
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 members found'))   // after the 500 ms debounce
  await user.click(screen.getByRole('button', { name: 'Remove Ada' }))
  expect(screen.getByRole('button', { name: 'Remove Bo' })).toHaveFocus()
})
```

- Keyboard pass: Tab through the screen with the mouse unplugged; every control is reachable, visibly focused and operable; Escape closes popups.
- Screen reader pass on the main journeys: VoiceOver (macOS), NVDA (Windows).
- Zoom to 200 percent and a 320 px wide window: no horizontal scrolling, nothing cut off.

## Pre-merge checklist for React accessibility

Check each point before merging an interactive change.

1. Native elements for buttons, links, fields, regions and dialogs; no clickable `div`s.
2. Every control has an accessible name; icon-only buttons have `aria-label`.
3. Everything works with the keyboard; focus is always visible.
4. Route changes move focus and update the title; a skip link exists.
5. Dialogs trap focus, close on Escape and return focus.
6. Custom widgets follow their APG pattern or come from a headless library.
7. Async messages go through live regions that were mounted in advance.
8. Reduced motion respected; contrast and target sizes meet AA; zoom to 200 percent works.
9. Lint, axe and role-based tests pass; a keyboard and screen reader pass done on main flows.

## Gotchas and anti-patterns in React accessibility

Each entry gives the symptom you see, its cause and the fix.

1. **Screen reader says "button" with no name.** Cause: an icon-only button. Fix: `aria-label`, or visually hidden text inside the button.
2. **Focus disappears after closing a custom modal.** Cause: the trigger was not refocused. Fix: native `<dialog>`, or store and restore `document.activeElement`.
3. **A toast is never announced.** Cause: the live region was mounted together with its text. Fix: keep the region mounted and change its content.
4. **Axe reports `aria-hidden-focus`, and screen reader users land on silent buttons.** Cause: `aria-hidden` on a container that still has focusable elements. Fix: use `inert` on the container, or remove the elements.
5. **Keyboard users reach hidden menu items.** Cause: content hidden with `opacity: 0` or off-screen positioning. Fix: `hidden`, `display: none` or `inert` while closed.
6. **`getByRole('button', { name: 'Save' })` fails though the button shows "Save".** Cause: an `aria-label` that overrides the visible text, or the element is not a button. Fix: remove the mismatched label; use `<button>`.
7. **Navigation is silent in the SPA.** Cause: no focus move or title change after route changes. Fix: focus the main heading and set the title per route.
8. **Anti-pattern: `outline: none` with no replacement.** Symptom: keyboard users cannot see where they are. Cause: a reset stylesheet or a designer request. Fix: a `:focus-visible` outline of at least 2 px with 3:1 contrast.
9. **Anti-pattern: positive `tabIndex` values.** Symptom: Tab jumps around the page in an order nobody designed. Cause: `tabIndex={1}` and up override the DOM order. Fix: only `0` and `-1`; change the DOM order instead.
10. **Anti-pattern: `role="button"` on a `div`.** Symptom: Enter and Space do nothing, or work only in some browsers. Cause: a role adds no behaviour. Fix: a `<button type="button">`.

## See also

- `react-forms` (labels, errors and focus after submit), `react-animation` (reduced motion), `react-i18n` (`lang` and `dir`).
- `react-testing` for axe in component tests; `react-e2e-testing` for axe and keyboard checks in Playwright journeys.
