---
name: react-design-system
description: Builds a React component library and design system teams can share - choosing the headless base (Radix through radix-ui, Base UI, React Aria) or shadcn/ui as owned code, three layers of design tokens as CSS variables with Tailwind CSS 4 @theme, light and dark themes, typed variants, accessible components with every state, Storybook 10 for documentation, interaction and accessibility tests, and publishing as an npm package or a shadcn registry with exports, peer dependencies, CSS and versioning. Use when starting a design system, adding a component to a shared library, setting up tokens or dark mode for several apps, writing Storybook stories, packaging components for other repos, or when colours and spacing drift between screens.
metadata:
  tags:
  - react
  - design-system
  - component-library
  - design-tokens
  - radix
  - base-ui
  - shadcn
  - storybook
  - dark-mode
---

# React design system

A design system is a set of decisions (tokens), the components that apply them, and the documentation that shows how to use them. In React it is usually a package of accessible components built on a headless library, styled from CSS-variable tokens, documented and tested in Storybook, and versioned so apps can upgrade on their own schedule. This skill covers building that library; styling a single app is the `react-styling` skill.

## Step 0: read the installed design-system packages

Read versions before choosing APIs; the headless libraries differ by major version:

```bash
node -p "['react','radix-ui','@base-ui/react','@base-ui-components/react','react-aria-components','shadcn','tailwindcss','class-variance-authority','storybook','@storybook/react-vite'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
node <this-skill>/scripts/check-tokens.mjs src          # hard-coded colours, undefined tokens, tokens missing a dark value
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

Written against (October 2026): `radix-ui` 1.8.1, `@base-ui/react` 1.9.0, `shadcn` 4.23.0, `tailwindcss` 4.3, `storybook` and `@storybook/react-vite` 10.6.5. `@base-ui-components/react` is the deprecated pre-1.0 name of Base UI: move to `@base-ui/react`. Storybook 10 is ESM-only and needs a recent Node (22 is safe).

## Decision table: the headless base for a design system

The base library supplies behaviour (focus, keyboard, ARIA); you supply the look:

| Base | Pick when | Composition API | Loses when |
|---|---|---|---|
| Radix Primitives (`radix-ui` package) | broad widget set, large community, many shadcn examples | `asChild` merges props into your element | you need a combobox or date fields: Radix has no combobox |
| Base UI (`@base-ui/react`) | you want a maintained 1.x API with combobox, autocomplete, number field, toast, menubar | `render` prop takes an element or function | the team already has a Radix codebase to keep |
| React Aria Components | strictest accessibility and internationalization (dates, locales, right-to-left) | slots and render props | you want the smallest bundle or Tailwind-first examples |
| shadcn/ui on any of the three | you want to own and edit the component source | the base's API | many apps must upgrade from one versioned package |
| Your own widgets from scratch | never for menus, comboboxes, dialogs or date pickers | | keyboard and screen reader behaviour takes months to get right |

shadcn/ui is a distribution method, not a library: `npx shadcn@latest init -b base` (or `-b radix`, `-b aria`) copies components into your repo. A design system can be both: build components with the shadcn CLI, then publish them as a package or as your own shadcn registry.

## Design tokens in three layers

Tokens are named decisions. Three layers keep themes and rebrands cheap:

| Layer | Example | Who uses it |
|---|---|---|
| Primitive (raw palette) | `--blue-600: oklch(0.55 0.2 260)` | only the semantic layer |
| Semantic (purpose) | `--color-accent: var(--blue-600)`, `--color-danger`, `--color-surface`, `--color-text-muted`, `--radius-control`, `--space-3` | components and app code |
| Component (optional) | `--button-height-md: 2.25rem` | one component |

Components read only semantic or component tokens, never primitives and never raw values; a theme or a brand swaps the semantic layer.

```css
/* tokens.css: the package ships this file */
@import 'tailwindcss';
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));

:root {
  --blue-600: oklch(0.55 0.2 260);  --red-600: oklch(0.58 0.22 27);
  --gray-50: oklch(0.985 0 0);      --gray-900: oklch(0.21 0.01 260);
  --surface: var(--gray-50);  --text: var(--gray-900);  --accent: var(--blue-600);  --danger: var(--red-600);
  --on-accent: var(--gray-50); --on-danger: var(--gray-50);   /* text and icons on accent and danger fills */
  --accent-hover: oklch(0.49 0.2 260); --danger-hover: oklch(0.51 0.2 27);   /* darker on hover: text 6.2:1, 6.1:1 */
  --focus-ring: var(--blue-600);
}
[data-theme='dark'] {
  --surface: var(--gray-900); --text: var(--gray-50); --accent: oklch(0.72 0.15 260); --danger: oklch(0.7 0.19 27);
  --on-accent: var(--gray-900); --on-danger: var(--gray-900); /* the dark theme's lighter fills need dark text */
  --accent-hover: oklch(0.78 0.11 260); --danger-hover: oklch(0.76 0.14 27);  /* lighter on hover: text 8.8:1, 7.8:1 */
  --focus-ring: oklch(0.72 0.15 260);
}
@theme inline {                      /* Tailwind utilities that point at the variables */
  --color-surface: var(--surface);  --color-text: var(--text);
  --color-accent: var(--accent);    --color-danger: var(--danger);
  --color-on-accent: var(--on-accent);  --color-on-danger: var(--on-danger);
  --color-accent-hover: var(--accent-hover);  --color-danger-hover: var(--danger-hover);
  --radius-control: 0.5rem;
}
```

- `@theme inline` makes `bg-accent` read `var(--accent)` at runtime, so switching `data-theme` re-themes without rebuilding.
- Every colour token defined in `:root` needs a dark value; `check-tokens.mjs` reports the missing ones.
- Text on a coloured fill gets its own token (`--on-accent`, `--on-danger`), never `text-white`: the dark theme lightens the accent, and white on a light fill fails contrast. Hover fills get tokens too (`--accent-hover`, `--danger-hover`): `hover:bg-accent/90` over the light surface drops the text to about 4.07:1 (danger 4.16:1), under 4.5:1.
- Follow the system preference by default and let users override: set `data-theme` from `matchMedia('(prefers-color-scheme: dark)')` and a stored choice, in an inline script before first paint to avoid a flash.
- Check contrast for every text and background pair in both themes: 4.5:1 for body text, 3:1 for large text, controls and focus rings.

Token formats, Style Dictionary pipelines and theming several brands: [tokens-and-theming.md](references/tokens-and-theming.md).

## Component API rules for a shared library

A shared component's API is a contract; changing it breaks every app. Rules that keep it stable:

- Extend the native element's props (`React.ComponentProps<'button'>`) and spread the rest, so `aria-*`, `data-*` and event props work.
- Variants as unions (`variant: 'primary' | 'secondary' | 'danger'`), never several booleans; generate classes with `cva`.
- Accept `className` and merge it last with `tailwind-merge`, so apps can adjust without forking.
- `ref` is a regular prop in React 19; do not add `forwardRef` to new components.
- Controlled and uncontrolled: `value` with `onValueChange`, plus `defaultValue`.
- Every component owns its states: default, hover, focus-visible, active, disabled, loading, invalid, empty, and dark mode.
- Export compound parts (`Dialog.Root`, `Dialog.Trigger`) when the base library does; do not flatten them into one component with twenty props.

## Storybook 10 for documentation and tests

Storybook renders each component state in isolation, documents its props and runs tests on stories. Set it up in the library package:

```bash
npm create storybook@latest                       # detects React and Vite; choose the recommended setup
npx storybook add @storybook/addon-a11y           # axe checks in the Accessibility panel and in tests
npx storybook add @storybook/addon-vitest         # runs stories as Vitest tests in a real browser
```

- Write one story per meaningful state (Default, Loading, Disabled, Invalid, LongText, Dark), not one per prop.
- `play` functions turn a story into an interaction test; with the Vitest addon, `vitest` runs every story and its `play`.
- Set `parameters.a11y.test: 'error'` in `preview.ts` so accessibility violations fail the test run.
- CSF Next (`defineMain`, `definePreview`, `preview.meta`, `meta.story`) is a preview feature in Storybook 10.6; the CSF 3 object format below is stable.

## Worked example: a Button with variants, loading state and stories

A token-driven Button with typed variants, a loading state that stays accessible, and stories that test it:

```tsx
// src/button/button.tsx
import { cva, type VariantProps } from 'class-variance-authority'
import { twMerge } from 'tailwind-merge'

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)] ' +
    'disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-on-accent hover:bg-accent-hover',
        secondary: 'border border-text/20 bg-surface text-text hover:bg-text/5',
        danger: 'bg-danger text-on-danger hover:bg-danger-hover',
      },
      size: { sm: 'h-8 px-3 text-sm', md: 'h-9 px-4 text-sm', lg: 'h-11 px-6 text-base' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export type ButtonProps = React.ComponentProps<'button'> & VariantProps<typeof button> & {
  loading?: boolean
  loadingLabel?: string
}

export function Button({ variant, size, loading = false, loadingLabel = 'Loading', className, children, disabled, type = 'button', onClick, ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={twMerge(button({ variant, size }), className)}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...props}
    >
      {loading && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />}
      <span>{children}</span>
      {loading && <span className="sr-only">{loadingLabel}</span>}
    </button>
  )
}
```

```tsx
// src/button/button.stories.tsx
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent } from 'storybook/test'
import { Button } from './button'

const meta = { component: Button, args: { children: 'Save', onClick: fn() } } satisfies Meta<typeof Button>
export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = {
  play: async ({ args, canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(args.onClick).toHaveBeenCalledOnce()
  },
}
export const Loading: Story = {
  args: { loading: true, loadingLabel: 'Saving' },
  play: async ({ args, canvas }) => {
    const btn = canvas.getByRole('button', { name: /save/i })
    await expect(btn).toHaveAttribute('aria-disabled', 'true')
    await expect(btn).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(btn)
    await expect(args.onClick).not.toHaveBeenCalled()
  },
}
export const Danger: Story = { args: { variant: 'danger', children: 'Delete project' } }
export const Dark: Story = { globals: { theme: 'dark' } }   // with a toolbar global that sets data-theme
```

The button keeps its label while loading, so its accessible name does not change and screen readers hear "Save, Saving". It uses `aria-disabled` while loading because `disabled` would drop keyboard focus from the button the person just pressed; the click handler ignores presses until it finishes, and `preventDefault` stops a form submitting twice. The spinner stops under reduced motion.

## Publish the design system as a package

Apps install a versioned package and upgrade on purpose. The package needs:

| Part | Rule |
|---|---|
| `exports` | one entry per public path (`"."`, `"./button"`, `"./tokens.css"`); nothing else is importable |
| `peerDependencies` | `react` and `react-dom`; never bundle a second React. The headless base goes in `dependencies` when the library wraps it completely, in `peerDependencies` when apps also import it, never both |
| `sideEffects` | `["**/*.css"]` so bundlers tree-shake components but keep styles |
| Types | `.d.ts` files beside the JS, declared in `exports` with a `types` condition |
| CSS | ship `tokens.css` and component styles; with Tailwind, export a `@source` path so the app scans the package's classes |
| Versioning | semver with a changelog (Changesets); a removed prop or renamed token is a major |

Build with Vite library mode or a library bundler, keep React and the base library external, and test the packed tarball in a sample app (`npm pack`, then install the `.tgz`). The full `package.json`, build config and a shadcn registry alternative: [publishing-a-component-library.md](references/publishing-a-component-library.md).

## Verify the design system

Prove tokens, components and the package before release:

```bash
node <this-skill>/scripts/check-tokens.mjs src --tokens src/tokens.css   # exit 1 on raw colours or missing dark values
npx vitest run --project=storybook                                       # every story renders, play tests and axe pass
npm pack --dry-run                                                       # only dist/, tokens and types are in the tarball
npx publint                                                              # exports, types and module format are consistent
```

Check every story in both themes and at 200 percent zoom, then install the packed tarball into a fresh Vite app and render one of each component.

## Gotchas and anti-patterns in design systems

Each gotcha names the symptom, its cause and the fix.

1. **Two Reacts: "Invalid hook call" in the consuming app.** Cause: React bundled into the library or listed in `dependencies`. Fix: React as a peer dependency and external in the build.
2. **Components render unstyled in the app.** Cause: Tailwind in the app does not scan the package's files. Fix: add `@source "../node_modules/your-ds/dist"` to the app's CSS, or ship compiled CSS.
3. **Dark mode misses some surfaces.** Cause: a raw colour or a primitive token in a component. Fix: semantic tokens only; run `check-tokens.mjs`.
4. **A flash of the light theme on load.** Cause: the theme is set in an effect after first paint. Fix: an inline script in `<head>` sets `data-theme` before the app loads.
5. **`asChild` does nothing.** Cause: the project uses Base UI, whose parts take a `render` prop. Fix: use the base library's composition API.
6. **A minor release broke apps.** Cause: a renamed prop, token or CSS class shipped as minor. Fix: treat the public API and token names as semver contracts; deprecate first.
7. **A custom select is unusable with a keyboard.** Cause: built from `div`s. Fix: use the base library's Select or Combobox.
8. **Stories pass, the app looks different.** Cause: Storybook loads different global CSS or fonts. Fix: import the same `tokens.css` and fonts in `.storybook/preview.ts`.

## Pre-merge checklist for a design system component

1. Built on the headless base; native props spread; `className` merged last.
2. Styled only with semantic tokens; light and dark values exist; contrast checked.
3. Variants are unions generated with `cva`; no boolean prop pile.
4. Stories cover default, disabled, loading, invalid, long text and dark; `play` tests and axe pass.
5. Keyboard and screen reader behaviour checked; focus ring visible in both themes.
6. Public API change recorded in the changelog with the right semver bump.
7. `check-tokens.mjs`, the Storybook tests, `npm pack --dry-run` and `publint` pass.

See also: react-styling, react-composition-patterns, react-accessibility, react-overlays-and-feedback, react-testing.
