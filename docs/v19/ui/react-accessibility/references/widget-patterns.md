---
title: ARIA widget patterns for React
author: MOZGII, Inc.
lang: en
---

# ARIA widget patterns for React

The roles, states and keys for the custom widgets React apps build most often, summarized from the WAI-ARIA Authoring Practices Guide (W3C, `https://www.w3.org/WAI/ARIA/apg/patterns/`). Read the APG page for the full pattern before building one; prefer a tested headless library for the complex ones.

## Contents

This page, ARIA widget patterns for React, has these sections.

1. Disclosure (show and hide)
2. Tabs
3. Menu button and menu
4. Listbox and select-only combobox
5. Editable combobox with autocomplete
6. Modal dialog and alert dialog
7. Switch and toggle button
8. Tooltip
9. Toolbar and roving tabindex

## Disclosure (show and hide)

A disclosure is a button that shows or hides a section. Use `<details>` and `<summary>` when styling allows; otherwise:

- Button: `aria-expanded="true|false"`, `aria-controls` pointing to the panel id.
- Panel: hidden with `hidden` when closed.
- Keys: Enter and Space toggle (native button behaviour).

## Tabs

Tabs switch between panels in one place. Roles and states:

- Container `role="tablist"` with `aria-label` or `aria-labelledby`; each tab `role="tab"`, `aria-selected`, `aria-controls`; each panel `role="tabpanel"`, `aria-labelledby` the tab.
- Only the selected tab has `tabIndex={0}`; the others `-1`.
- Keys: Left and Right arrows move between tabs (Up and Down for vertical tabs with `aria-orientation="vertical"`), Home and End jump to first and last. Automatic activation selects on arrow; manual activation waits for Enter or Space.
- A complete React implementation is in the `react-composition-patterns` skill.

## Menu button and menu

A menu offers actions or choices, like a desktop app menu. It is not for site navigation (use a list of links in `<nav>`):

- Button: `aria-haspopup="menu"`, `aria-expanded`, `aria-controls`.
- Menu: `role="menu"`; items `role="menuitem"`, `menuitemcheckbox` or `menuitemradio` with `aria-checked`.
- Keys: Enter, Space or Down on the button opens and focuses the first item; Up and Down move; Home and End jump; typing a letter jumps to the next item starting with it; Escape closes and returns focus to the button; Tab closes the menu and moves on.

## Listbox and select-only combobox

A listbox is a list of options to choose from. Prefer native `<select>` when its styling is acceptable; a custom select is a select-only combobox:

- Trigger: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant` pointing to the highlighted option id while open.
- Popup: `role="listbox"`; options `role="option"` with `aria-selected`.
- Keys: Down and Up open and move, Enter selects and closes, Escape closes without changing, typing jumps to matching options.
- Focus stays on the combobox; the highlighted option is announced through `aria-activedescendant`.

## Editable combobox with autocomplete

An editable combobox is a text input with a popup of suggestions (search, autocomplete, tag input). It is among the hardest widgets to get right across screen readers; use React Aria's `useComboBox`, Ariakit, Base UI or Headless UI unless you have a strong reason:

- Input: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`.
- Announce the result count in a polite live region after typing stops.
- Keys: Down opens and moves into suggestions, Enter accepts, Escape closes then clears, Alt+Down opens without moving.

## Modal dialog and alert dialog

A modal dialog blocks the page until closed. Use native `<dialog>` with `showModal()`:

- `aria-labelledby` the dialog heading; `aria-describedby` the main text for an alert dialog (`role="alertdialog"`, used for confirmations that need an answer).
- Focus moves into the dialog on open: to the first field, or to the least destructive button in a confirmation.
- Tab stays inside; Escape closes; focus returns to the trigger on close.
- The page behind is inert (native with `showModal()`; otherwise set `inert` on the app root).

## Switch and toggle button

A switch turns a setting on or off immediately; a toggle button is pressed or not:

- Switch: `<button role="switch" aria-checked={on}>` with a visible label; or `<input type="checkbox" role="switch">`.
- Toggle button: `<button aria-pressed={pressed}>Bold</button>`; the label stays the same when the state changes.
- Keys: Space (and Enter for buttons) toggles.

## Tooltip

A tooltip shows a short description on hover and focus. It never holds interactive content or anything the user must read to proceed:

- Trigger: `aria-describedby` the tooltip id (or the tooltip text is the accessible name for an icon button).
- Tooltip: `role="tooltip"`; appears on focus as well as hover; Escape hides it; stays visible while the pointer moves onto it (WCAG 1.4.13).
- The HTML `popover="hint"` attribute with CSS anchor positioning handles top-layer placement; check browser support for your audience.

## Toolbar and roving tabindex

A toolbar groups controls (formatting buttons, view switches) as one Tab stop:

- Container `role="toolbar"` with `aria-label`.
- Roving tabindex: the current control has `tabIndex={0}`, the others `-1`; Left and Right move focus and update which one is `0`; Home and End jump.
- React 19.3 Fragment refs (`FragmentInstance.focus()` and `focusLast()`) help libraries move focus across children without wrapper elements.
