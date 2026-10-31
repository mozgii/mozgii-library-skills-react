---
title: React project structure and naming
author: MOZGII, Inc.
lang: en
---

# React project structure and naming

How to lay out a React codebase so a feature is easy to find, change and delete. These are conventions, not rules React enforces; pick them once per project and keep them.

## Feature folders over type folders

A feature folder groups the components, hooks, data access, schema and tests of one feature. Type folders (`components/`, `hooks/`, `services/` at the top level) spread one feature across five places and grow without limit.

- A file starts inside the feature that uses it.
- It moves to `shared/` when a second feature imports it, not before.
- A feature never imports another feature's internal files. If two features need the same thing, that thing belongs in `shared/`, or one feature exposes it from an `index.ts` on purpose.
- Deleting a feature is deleting its folder plus its route entry. If more breaks, the boundary leaked.

## Where routes, providers and the app shell live

The app shell is the code every screen shares: providers (query client, theme, router), the root layout, the error boundary at the top. Keep it in `src/app/` so `main.tsx` stays a few lines:

```tsx
// src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Providers } from './app/providers'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers />
  </StrictMode>,
)
```

```tsx
// src/app/providers.tsx
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router/dom'
import { queryClient } from '@/shared/lib/query-client'
import { router } from './router'

export function Providers() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
```

Keep `StrictMode` on in development: it runs effects twice on mount and renders twice, which surfaces missing cleanups and impure renders early.

## File and component naming

File and component naming conventions let people and tools find things by guessing. A common set:

| Kind | Name | Example |
|---|---|---|
| Component file | PascalCase, one main component per file | `InvoiceList.tsx` |
| Hook file | camelCase starting with `use` | `useInvoiceFilters.ts` |
| Data access | `api.ts` or `<thing>.queries.ts` in the feature | `features/invoices/api.ts` |
| Schema | `<thing>.schema.ts` | `invoice.schema.ts` |
| Test | next to the file, `.test.tsx` | `InvoiceList.test.tsx` |
| Styles | Tailwind classes inline, or `<Component>.module.css` beside it | `InvoiceList.module.css` |

- Name a component after what it shows (`InvoiceTotals`), not where it sits (`RightPanel`).
- Event props start with `on` (`onSelect`); handlers inside start with `handle` (`handleSelect`).
- Boolean props read as adjectives (`disabled`, `selected`), not `isDisabledFlag`.

## Barrel files and their cost

A barrel file (`index.ts` that re-exports a folder) makes imports short, but every import of it pulls the whole folder into the module graph. Vite's dev server then loads every re-exported module, test runners transform them all, and tree shaking can fail on side effects.

- Use a barrel only as a deliberate public surface of a feature (`features/invoices/index.ts` exporting two things).
- Never a barrel for `shared/ui` with fifty components; import `@/shared/ui/Button` directly.
- Icon libraries: import each icon from its own path when the library offers it.

## Where shared UI components go

The design-system components (Button, Input, Dialog, Field, Tooltip) live in `shared/ui/`. Each one is accessible on its own (label, focus ring, keyboard), styled from design tokens, and has no knowledge of any feature. A component that knows about invoices is a feature component even when two screens use it.

## Absolute imports and their limits

The `@/` alias (`@/shared/ui/Button`) avoids `../../../`. Use it for imports that cross folders; keep `./` for files in the same feature, so moving a feature folder keeps its own imports working. Configure the alias in `vite.config.ts` and `tsconfig.app.json` both.

## Monorepo note for React apps

A monorepo with several apps and shared packages (pnpm workspaces, Turborepo, Nx) keeps the same feature layout inside each app. Shared UI becomes a workspace package with its own `package.json`, built or consumed as TypeScript source through the bundler. React and React DOM must resolve to one copy: list them as `peerDependencies` in shared packages, or two Reacts break hooks with "Invalid hook call".
