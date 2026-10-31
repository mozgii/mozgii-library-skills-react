---
title: Design tokens and theming for a React design system
author: MOZGII, Inc.
lang: en
---

# Design tokens and theming for a React design system

How to name, store, transform and theme design tokens for a component library used by several apps. Sources: the W3C Design Tokens Community Group format, the Tailwind CSS 4 theme documentation, and the Style Dictionary documentation.

## Token naming conventions

A token name says what the value is for, not what it looks like. `--color-danger` survives a rebrand; `--red` does not. A practical scheme is `--{category}-{role}-{variant}-{state}`:

| Category | Examples |
|---|---|
| colour | `--color-surface`, `--color-surface-raised`, `--color-text`, `--color-text-muted`, `--color-accent`, `--color-accent-hover`, `--color-border`, `--color-danger`, `--color-focus-ring` |
| space | `--space-1` … `--space-8` on a 4 px base |
| radius | `--radius-control`, `--radius-card`, `--radius-full` |
| type | `--font-sans`, `--text-sm`, `--text-base`, `--leading-tight` |
| elevation | `--shadow-popover`, `--shadow-dialog` |
| motion | `--duration-fast`, `--ease-out` |
| layer | `--z-dropdown`, `--z-dialog`, `--z-toast` |

Keep the semantic set small (about 20 to 40 colour roles). Each new token is a decision every theme must make.

## Store tokens as data with the DTCG format

When designers and several platforms share tokens, keep them as JSON in the Design Tokens Community Group (DTCG) format and generate CSS from it. A token has `$value` and `$type`; references use braces:

```json
{
  "blue": { "600": { "$value": "oklch(0.55 0.2 260)", "$type": "color" } },
  "color": {
    "accent": { "$value": "{blue.600}", "$type": "color" },
    "surface": { "$value": "{gray.50}", "$type": "color" }
  }
}
```

Style Dictionary 5 reads this format and writes CSS variables, TypeScript constants and native formats; `@tokens-studio/sd-transforms` adds the transforms for Tokens Studio exports from Figma. A one-team web-only system can skip the pipeline and keep `tokens.css` as the source of truth.

## Light, dark and high-contrast themes with CSS variables

A theme is a set of values for the semantic tokens. Put each theme on an attribute selector and keep primitives shared:

```css
:root, [data-theme='light'] { --surface: var(--gray-50); --text: var(--gray-900); color-scheme: light; }
[data-theme='dark'] { --surface: var(--gray-900); --text: var(--gray-50); color-scheme: dark; }
@media (prefers-contrast: more) { :root { --border: var(--gray-900); --text-muted: var(--gray-800); } }
```

- `color-scheme` makes native controls, scrollbars and form fields match the theme.
- An attribute on `<html>` lets one subtree use another theme (`<div data-theme="dark">` for a dark sidebar) when tokens are defined on the attribute, not only on `:root`.
- Tailwind 4: `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` points the `dark:` variant at the attribute.

## Set the theme before first paint

Setting the theme in a React effect paints the default theme first and then flips, a visible flash. Run a tiny inline script in `<head>` before the app bundle:

```html
<script>
  try {
    const stored = localStorage.getItem('theme')
    const theme = stored === 'light' || stored === 'dark' ? stored
      : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    document.documentElement.dataset.theme = theme
  } catch { document.documentElement.dataset.theme = 'light' }
</script>
```

If the page has a Content Security Policy, give the script a nonce or a hash. In React, a theme toggle writes `localStorage` and `document.documentElement.dataset.theme`; listen to the media query's `change` event when the user chose "system".

## Several brands from one component library

Brands differ in semantic values, not in components. Ship one component package and one token file per brand (`brand-a.css`, `brand-b.css`), each defining the same semantic variables. An app imports one brand file. Components never branch on the brand in code.

## Contrast checks for token pairs

Check each foreground and background pair the components use, in every theme. The WCAG 2.2 AA minimums are 4.5:1 for body copy and 3:1 for big type (24 px, or 18.66 px bold); UI component boundaries and focus indicators need 3:1 against adjacent colours. OKLCH makes it easier to keep lightness steps even across hues, but always check the computed ratio; lightness alone does not guarantee contrast.

## Spacing, sizing and density tokens

Use a 4 px base for spacing (`--space-1: 0.25rem`) and size controls in rem so they follow the user's font size. For dense desktop screens and roomy marketing pages, define a density attribute that changes control heights and paddings (`[data-density='compact'] { --control-h: 1.75rem }`) instead of separate components.
