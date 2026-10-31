---
name: react-styling
description: Styles React components - choosing Tailwind CSS 4, CSS Modules or a zero-runtime CSS-in-JS library, the cn helper with clsx and tailwind-merge, typed variants with class-variance-authority, shadcn/ui components you own (Radix, Base UI or React Aria base), design tokens and dark mode through CSS variables, dynamic values, styling by state with data and aria attributes, and moving off styled-components or Emotion. Use when styling a component, building a Button with variants, setting up shadcn/ui, when Tailwind classes do not apply, a dynamic class is missing in production, two classes conflict, or when choosing a styling approach.
metadata:
  tags:
  - react
  - styling
  - tailwind
  - css-modules
  - shadcn
  - cva
  - tailwind-merge
  - css-in-js
  - design-tokens
---

# React styling

React has no styling system of its own: a component sets `className` or `style`, and the CSS comes from somewhere else. This skill picks that somewhere for a client-rendered React 19 app and shows the patterns that keep styles predictable: one class helper, typed variants, tokens in CSS variables, and state styled from attributes. Tailwind setup in a new Vite project is in `react-project-setup`; theme switching is in `react-app-layouts`.

## Step 0: read the installed styling packages

The styling packages decide which syntax works (Tailwind 3 and 4 differ a lot), so read them first:

```bash
node -p "['tailwindcss','@tailwindcss/vite','tailwind-merge','clsx','class-variance-authority','tailwind-variants','styled-components','@emotion/react','shadcn'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
ls components.json 2>/dev/null && npx shadcn@latest info      # a shadcn/ui project: base library, aliases, installed components
```

Versions this was written against (October 2026): `tailwindcss` 4.3, `tailwind-merge` 3.7 (supports Tailwind 4 only; Tailwind 3 needs `tailwind-merge` 2), `clsx` 2.1, `class-variance-authority` 0.7, `shadcn` CLI 4.23.

## Choose a styling approach

Choosing a styling approach for React comes down to who writes the CSS and whether it must run at build time. Default to Tailwind CSS 4 for new apps:

| Approach | Pick it when | Where it loses |
|---|---|---|
| Tailwind CSS 4 | most new apps; a team that wants one vocabulary and no naming of classes | long class strings: extract components, not `@apply` everywhere |
| CSS Modules (`*.module.css`) | plain CSS with local class names, no new tooling (Vite supports them out of the box) | sharing tokens: use CSS variables |
| Plain CSS with tokens and BEM-like names | small apps, design systems shipped as CSS | global name clashes |
| Zero-runtime CSS-in-JS (vanilla-extract, Panda CSS, StyleX) | typed styles in TypeScript files, extracted to CSS at build time | build plugin per bundler |
| Runtime CSS-in-JS (styled-components, Emotion) | an existing codebase only | style injection during render, extra work with streaming and Server Components; styled-components went into maintenance mode in 2025 |

Do not mix two systems for the same components. A UI kit with its own styling engine (MUI, Mantine, Chakra) brings its theme; style around it with its APIs rather than layering Tailwind over its internals.

## The cn helper for conditional classes

The `cn` helper joins conditional class names and resolves Tailwind conflicts, so a caller's `className` wins over the component's default. It is two small libraries:

```bash
npm i clsx tailwind-merge
```

```ts
// src/shared/lib/cn.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

```tsx
<div className={cn('rounded-md p-4', selected && 'ring-2 ring-accent', className)} />
// cn('px-2 py-1', 'px-4') === 'py-1 px-4': the later padding wins instead of both applying
```

- `clsx` handles strings, arrays, objects (`{ 'opacity-50': disabled }`) and drops `false`, `null` and `undefined`.
- Without `tailwind-merge`, `px-2 px-4` both apply and the winner is whichever rule comes later in the stylesheet, not in the string.
- Custom theme names that look like a built-in group can be merged wrongly: a custom font size `text-body` may be treated as a colour and removed by a later `text-red-500`. Teach the merger with `extendTailwindMerge({ extend: { theme: { text: ['body'] } } })`.

## Typed variants with class-variance-authority

Variants map a small set of props to classes, so a `Button` has `variant` and `size` instead of a dozen booleans. `class-variance-authority` (cva) types them:

```tsx
// src/shared/ui/button.tsx
import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/shared/lib/cn'

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:bg-accent-hover',
        secondary: 'bg-surface-2 text-fg hover:bg-surface-3',
        danger: 'bg-danger text-on-danger hover:bg-danger-hover',
        ghost: 'hover:bg-surface-2',
      },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-10 px-4', icon: 'size-10' },
    },
    compoundVariants: [{ variant: 'ghost', size: 'icon', class: 'rounded-full' }],
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof button>

export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(button({ variant, size }), className)} {...props} />
}
```

- The focus ring names its colour with `focus-visible:outline-accent`. Tailwind's `outline-2` sets no colour, so the ring would take the button's text colour, and on primary and danger that sits on the surface at 1:1 in both themes.
- Text on a filled button uses its own token (`text-on-accent`, `text-on-danger`), never `text-white`: the dark theme lightens the accent, and white on `oklch(70% 0.17 260)` is about 2.7:1, under the 4.5:1 text needs. Both tokens live in `src/index.css` beside `--accent-base` and `--danger`, with a value per theme.
- Hover fills are tokens too (`--accent-hover`, `--danger-hover`), never an opacity such as `hover:bg-accent/90`: in the light theme 90% accent over the white surface drops the on-accent text to about 4.12:1, and `bg-danger/90` to about 4.06:1, both under 4.5:1. A darker fill in light and a lighter one in dark keep the text above it: 6.33:1 and 8.72:1 for accent, 6.17:1 and 7.65:1 for danger.
- Export `button` too when links must look like buttons: `<Link className={button({ variant: 'secondary' })}>`.
- `tailwind-variants` is an alternative with slots (several parts per component) and built-in merging.
- Component API design (variants versus separate components, compound parts): `react-composition-patterns`.

## shadcn/ui components you own

shadcn/ui is not a dependency you import: its CLI copies component source into your project, built on Tailwind and a headless base library, and the code is yours to edit. In a Vite app:

```bash
npx shadcn@latest init -t vite                  # new project from the template
npx shadcn@latest init -b radix                 # existing Vite app with Tailwind 4 and the @ alias; -b base or -b aria for the other bases
npx shadcn@latest add button dialog field       # writes src/components/ui/*.tsx
npx shadcn@latest add button --diff             # compare your copy with the registry before updating
```

- The base library (Radix, Base UI or React Aria) decides the composition API: Radix parts take `asChild`, Base UI parts take a `render` prop. Read `components.json` or `npx shadcn@latest info` before writing code that composes them.
- Theme colours are CSS variables in your CSS file, mapped to utilities with `@theme inline`; change tokens there, not in each component.
- Updates never overwrite your edits on their own; `add --diff` shows what changed upstream, and you merge by hand.
- The CLI's MCP server (`npx shadcn@latest mcp`) lets an agent search and add registry items.

## Design tokens and dark mode with CSS variables

Design tokens are named values (colours, radii, spacing) defined once as CSS variables and used everywhere, so a theme change is one place. In Tailwind 4, `@theme` turns tokens into utilities; `@theme inline` maps utilities to variables that change at runtime:

```css
/* src/index.css */
@import "tailwindcss";
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

:root {
  --surface: oklch(99% 0 0);
  --fg: oklch(20% 0.01 260);
  --accent-base: oklch(55% 0.2 260);
  --on-accent: oklch(99% 0 0);          /* text on accent fills: about 4.9:1 */
  --accent-hover: oklch(49% 0.2 260);   /* darker on hover: on-accent text about 6.3:1 */
}
[data-theme="dark"] {
  --surface: oklch(18% 0.01 260);
  --fg: oklch(94% 0.01 260);
  --accent-base: oklch(70% 0.17 260);
  --on-accent: oklch(18% 0.01 260);     /* the lighter dark-theme accent needs dark text: about 6.9:1 */
  --accent-hover: oklch(76% 0.12 260);  /* lighter on hover: on-accent text about 8.7:1 */
}

@theme inline {
  --color-surface: var(--surface);
  --color-fg: var(--fg);
  --color-accent: var(--accent-base);
  --color-on-accent: var(--on-accent);
  --color-accent-hover: var(--accent-hover);
}
```

- Components use semantic names (`bg-surface text-fg`), never raw palette steps, so dark mode needs no `dark:` prefix on every element.
- Use `@theme` (not `inline`) for fixed values such as fonts and breakpoints.
- Setting `data-theme` and avoiding a flash of the wrong theme: `react-app-layouts`.

## Dynamic values and why dynamic class names vanish

Tailwind finds classes by scanning source files as text, so a class built from a variable at runtime is never generated. `bg-${color}-500` works in development by luck and is missing in production:

```tsx
// Wrong: Tailwind never sees "bg-red-500" in the source
<span className={`bg-${color}-500`} />

// Right: a lookup of complete class names
const tone = { red: 'bg-red-500', green: 'bg-green-500', gray: 'bg-gray-400' } as const
<span className={tone[color]} />

// Right for continuous values: a CSS variable in style, a class that reads it
<div className="h-2 w-(--progress) bg-accent" style={{ '--progress': `${pct}%` } as React.CSSProperties} />
```

- `style` is fine for values that change per render (positions, sizes, user colours); classes for everything from a fixed set.
- Classes in a package Tailwind does not scan (a component library in `node_modules`) need `@source "../node_modules/my-ui";` in the CSS. A class that only comes from data (a CMS) can be listed with `@source inline("bg-red-500 bg-green-500");`.

## Style by state with data and aria attributes

Styling from attributes keeps state in one place: the component sets `aria-expanded`, `aria-selected` or a `data-state`, and CSS reacts, instead of computing class strings in JavaScript:

```tsx
<button aria-expanded={open} className="group flex items-center gap-1">
  Filters
  <ChevronIcon className="transition-transform group-aria-expanded:rotate-180" aria-hidden />
</button>

<li data-selected={selected || undefined} className="data-selected:bg-accent/10 data-selected:font-medium">{name}</li>
```

- Pass `undefined`, not `false`, to drop a boolean data attribute; `data-selected="false"` still matches `data-selected:`.
- Headless libraries (Radix, Base UI, React Aria) already expose state as `data-*` attributes: style those rather than tracking state twice.
- The same attributes make tests and screen readers agree with what is drawn.

## CSS Modules in a Vite app

CSS Modules scope class names to the file, so `.title` in two components never clash. Vite handles any file named `*.module.css`:

```tsx
import styles from './InvoiceCard.module.css'

export function InvoiceCard({ overdue, children }: { overdue: boolean; children: React.ReactNode }) {
  return <article className={cn(styles.card, overdue && styles.overdue)}>{children}</article>
}
```

- `vite/client` types (in the template's `vite-env.d.ts`) type the import as a record of strings; a typo is `undefined`, not an error. `typescript-plugin-css-modules` adds editor checks.
- Share tokens through CSS variables defined globally; `composes: base from './shared.module.css'` reuses a class.

## Moving off runtime CSS-in-JS

Runtime CSS-in-JS libraries create style rules while components render, which costs time on every render and needs extra setup for streaming and Server Components. For an existing styled-components or Emotion codebase, migrate gradually rather than in one rewrite:

1. Freeze: new components use the new approach (Tailwind or CSS Modules); no new `styled.` calls.
2. Move tokens out first: the theme object becomes CSS variables both systems read (`color: var(--fg)` inside the styled template).
3. Convert leaf components first (buttons, badges), then layouts, deleting each styled file as it goes.
4. Remove the library's provider and Babel or SWC plugin last, then check bundle size.

A codebase that stays on styled-components 6 keeps working on React 19; it gets fixes, not new features.

## Worked example: state messages and skeletons styled from tokens

A worked example of the patterns together: one `StateMessage` component styles the info, empty and error states of every screen through a cva `tone` variant and semantic tokens, so both themes work with no `dark:` classes, and a skeleton pulses only when motion is allowed:

```tsx
// src/shared/ui/state-message.tsx
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/cn'

const message = cva('flex flex-col items-start gap-2 rounded-lg border p-4 text-sm', {
  variants: {
    tone: {
      info: 'border-border bg-surface-2 text-fg',
      empty: 'border-dashed border-border bg-surface text-fg-muted',
      error: 'border-danger/40 bg-danger/10 text-fg',
    },
  },
  defaultVariants: { tone: 'info' },
})

type StateMessageProps = VariantProps<typeof message> & { title: string; children?: ReactNode; action?: ReactNode; className?: string }

export function StateMessage({ tone, title, children, action, className }: StateMessageProps) {
  return (
    <div role={tone === 'error' ? 'alert' : undefined} className={cn(message({ tone }), className)}>
      <p className="font-medium">{title}</p>
      {children}
      {action}
    </div>
  )
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-4 rounded bg-surface-3 motion-safe:animate-pulse" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  )
}
```

```css
/* tokens it relies on, next to the others in src/index.css */
:root { --surface-2: oklch(96% 0 0); --surface-3: oklch(92% 0 0); --fg-muted: oklch(45% 0.01 260); --border: oklch(88% 0 0); --danger: oklch(58% 0.2 25); --danger-hover: oklch(51% 0.19 25); --on-danger: oklch(99% 0 0); }
[data-theme="dark"] { --surface-2: oklch(24% 0.01 260); --surface-3: oklch(30% 0.01 260); --fg-muted: oklch(72% 0.01 260); --border: oklch(34% 0.01 260); --danger: oklch(68% 0.18 25); --danger-hover: oklch(74% 0.15 25); --on-danger: oklch(18% 0.01 260); }
@theme inline { --color-surface-2: var(--surface-2); --color-surface-3: var(--surface-3); --color-fg-muted: var(--fg-muted); --color-border: var(--border); --color-danger: var(--danger); --color-danger-hover: var(--danger-hover); --color-on-danger: var(--on-danger); }
```

- `motion-safe:` applies the pulse only without "reduce motion"; the skeleton's varying widths are a `style` value, not runtime-built classes.
- Usage: `<StateMessage tone="empty" title="No invoices yet" action={<Button>Create invoice</Button>} />`.

## Verify React styling

Styling is proven on the production build, in both themes, at the extremes of window size. Run:

```bash
node <this-skill>/scripts/find-dynamic-classes.mjs src   # runtime-built Tailwind classes; exit 0 when none
npm run build
grep -l "bg-surface-2" dist/assets/*.css                 # a class you rely on exists in the built CSS
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

- Screenshot each main screen in light and dark (Playwright `page.emulateMedia({ colorScheme: 'dark' })` with the app's theme attribute set), and compare against the last approved screenshots.
- Check contrast of text and focus rings with the browser's accessibility panel or axe: 4.5:1 for text, 3:1 for UI parts and focus indicators.
- Tab through a screen: every interactive element shows a visible `focus-visible` ring in both themes.
- With shadcn/ui, `npx shadcn@latest add <component> --diff` shows how your copy differs from the registry before an update.

## Pre-merge checklist for React styling

Check each point before merging styling changes.

1. One styling approach per component layer; no second system layered over a UI kit.
2. A single `cn` helper with `tailwind-merge`, and every component accepts `className` last.
3. Variants typed (cva or tailwind-variants) instead of boolean style props.
4. Colours, radii and fonts come from tokens; dark mode switches variables, not classes on every element.
5. No class names built from runtime strings; dynamic values go through CSS variables.
6. State styled from `aria-*` and `data-*` attributes the component already sets.
7. Focus styles visible on every interactive element (`focus-visible:`), both themes checked for contrast.

## Gotchas and anti-patterns in React styling

Each entry gives the symptom you see, its cause and the fix.

1. **A Tailwind class works in development but is missing in production.** Cause: the class name is built at runtime (`text-${size}`). Fix: map to complete class names, or use a CSS variable.
2. **The caller's `className="px-6"` does not override the component's `px-4`.** Cause: both classes apply and stylesheet order decides. Fix: merge with `cn` (`tailwind-merge`) and put `className` last.
3. **`tailwind.config.js` changes do nothing.** Cause: Tailwind 4 is configured in CSS (`@theme`, `@source`, `@custom-variant`); the JavaScript config is read only when loaded with `@config`. Fix: move settings to the CSS file.
4. **Classes from a component package have no styles.** Cause: Tailwind does not scan `node_modules`. Fix: `@source "../node_modules/<package>";`.
5. **`error TS5102: Option 'baseUrl' has been removed` after `shadcn init`.** Cause: an install guide added `baseUrl`, which TypeScript 7 removed. Fix: delete `baseUrl`, keep `paths`.
6. **`asChild` is not a valid prop on a shadcn/ui component.** Cause: the project uses the Base UI base, whose parts take `render`. Fix: check `components.json` and use that base's API.
7. **`tailwind-merge` drops a custom class.** Cause: it grouped a custom token with a built-in group. Fix: `extendTailwindMerge` with the custom theme names.
8. **Dark mode utilities ignore the app's theme switch.** Cause: Tailwind 4's `dark:` follows `prefers-color-scheme` by default. Fix: `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));`.
9. **Anti-pattern: `@apply` for every component.** Symptom: a second, hand-written stylesheet that drifts from the components. Cause: avoiding long class lists. Fix: extract a React component (or a cva recipe); keep `@apply` for the rare third-party element you cannot give classes.
10. **Anti-pattern: raw palette steps in components (`bg-gray-100`, `dark:bg-gray-900`).** Symptom: a theme change means editing hundreds of files. Cause: no semantic tokens. Fix: `bg-surface`, `text-fg` and friends mapped in `@theme inline`.

Facts here were checked against the Tailwind CSS, tailwind-merge, class-variance-authority and shadcn/ui documentation (all MIT); the text and examples are original.

## See also

- `react-design-system`: tokens at scale, a component library's structure, documentation with Storybook and releasing it.
- `react-app-layouts` (theme switch without a flash), `react-composition-patterns` (variant APIs), `react-i18n` (logical utilities for RTL).
