---
name: react-architecture
description: Structures React codebases so they stay easy to change as they grow - folders by feature instead of by file type, layers with one dependency direction (app, pages, features, shared), a public API per feature through one index file, import rules enforced by a script or linter, where server state, URL state and client state live, cross-feature communication, avoiding circular dependencies and barrel traps, naming, and when to split into workspace packages or separate apps. Use when starting a React project that will grow, reorganizing a messy src folder, deciding where a new file or hook goes, features import each other's internals, a change in one screen breaks another, onboarding is slow, or when planning a monorepo.
metadata:
  tags:
  - react
  - architecture
  - project-structure
  - feature-folders
  - module-boundaries
  - monorepo
  - dependency-rules
---

# React architecture

Architecture in a React app is mostly about dependencies: which code may import which. When every file can import every other file, a change anywhere can break anything, and nothing can be deleted safely. Group code by feature, give each feature a small public surface, let dependencies point one way, and check the rules automatically. React itself imposes none of this, so the codebase does what its structure allows.

## Step 0: read the project's structure and tooling

Look at what exists before proposing a structure, and run the import check to see current violations:

```bash
node -p "['react','typescript','vite','react-router','@tanstack/react-router','@tanstack/react-query','eslint','oxlint','dependency-cruiser','eslint-plugin-boundaries'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
find src -maxdepth 2 -type d | sort | head -50
node <this-skill>/scripts/check-imports.mjs src        # layer, feature-boundary and cycle violations
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

Written against `react` 19.3.1, `typescript` 7.0.2 and `vite` 8.3.5. The structure below needs only TypeScript path aliases; the check script has no dependencies.

## Decision table: structure by codebase size

| Size | Structure | Why bigger structures lose here |
|---|---|---|
| Prototype, under ~30 files | flat `src/` with `components/`, `hooks/`, `lib/` | layers add ceremony before there is anything to separate |
| One product, growing team, 30 to ~1,000 files | feature folders with layers: `app`, `pages`, `features`, `shared` | — |
| Several apps sharing UI and logic | a monorepo with workspace packages (`packages/ui`, `packages/api-client`) plus feature folders inside each app | a single app folder cannot version or own shared code |
| Independent teams deploying separately | separate apps (or micro-frontends) with contracts between them | one repo and one deploy couple release schedules |

Move up a row when the pain appears (merge conflicts in shared folders, accidental coupling), not before.

## Feature folders over type folders

Type folders (`components/`, `hooks/`, `services/`) scatter one feature across the tree; deleting it means hunting through every folder. A feature folder holds everything for one capability:

```
src/
├── app/                    entry, providers, router, global styles; may import everything below
├── pages/                  one folder per route: composes features, owns layout and URL state
│   └── invoices/           invoices-page.tsx, route.tsx
├── features/
│   ├── invoices/
│   │   ├── api/            queries.ts (queryOptions), mutations.ts, schemas.ts
│   │   ├── components/     invoice-list.tsx, invoice-row.tsx, invoice-status-badge.tsx
│   │   ├── hooks/          use-invoice-filters.ts
│   │   ├── lib/            totals.ts (pure functions, unit-tested)
│   │   └── index.ts        the public API: the only file other folders import
│   └── customers/
└── shared/                 no business knowledge
    ├── ui/                 design-system components (Button, Dialog, DataState)
    ├── api/                http client, error types
    ├── lib/                format, dates, invariant
    └── config/             runtime config
```

A feature is a capability users recognize ("invoices", "billing settings", "search"), not a technical layer. Name files in kebab-case and name the component inside in PascalCase; one component per file for anything exported.

## Layers and one dependency direction

Each layer may import only from layers below it:

| Layer | May import | Must not import |
|---|---|---|
| `app` | `pages`, `features`, `shared` | — |
| `pages` (or `routes`) | `features`, `shared` | `app`, other pages |
| `features` | `shared`, and other features only through their `index.ts` | `app`, `pages`, another feature's internal files |
| `shared` | `shared` only | `app`, `pages`, `features` |

When two features need each other, the composition belongs one layer up: the page renders both and passes data or callbacks between them. If two features keep needing each other's internals, they are one feature, or the shared part belongs in a lower feature both depend on.

## The public API of a feature

Each feature exposes a small, deliberate surface through `index.ts`. Everything else is private:

```ts
// features/invoices/index.ts
export { InvoiceList } from './components/invoice-list'
export { InvoiceStatusBadge } from './components/invoice-status-badge'
export { invoiceQueries } from './api/queries'
export type { Invoice, InvoiceStatus } from './api/schemas'
```

- Export what pages and other features use, nothing more; a smaller surface is cheaper to change.
- Keep one `index.ts` per feature, not barrels in every folder: nested barrels slow down dev servers and tests, hide circular imports, and can defeat tree-shaking when modules have side effects.
- Import a feature as `@/features/invoices`, never `@/features/invoices/components/invoice-row`.

## Where each kind of state lives

| State | Lives in | Owned by |
|---|---|---|
| Server data | the query cache, through `queryOptions` defined in `features/<f>/api` | the feature |
| Shareable UI state (filters, tab, page, selected id) | the URL search params | the page (route) |
| Form drafts | the form library or `useActionState` | the component |
| Ephemeral UI (open, hover, input text) | `useState` in the component | the component |
| Cross-cutting client state (theme, sidebar, command palette) | a small store or Context in `app` or `shared` | the app |

Most "global state" in older apps is server data that belongs in the query cache. Put query keys and fetchers next to the feature they describe, so invalidation stays local.

## Cross-feature communication without coupling

Features talk through things lower in the stack, never by reaching into each other:

- **Data**: one feature invalidates query keys that another reads (`queryClient.invalidateQueries({ queryKey: invoiceQueries.all() })`), using the other feature's exported query helpers.
- **Composition**: the page passes a callback from one feature's component to another's.
- **Events**: for truly decoupled reactions (analytics, toasts), a tiny typed event bus in `shared`, used sparingly.
- **Routing**: features link to each other through route paths, never by importing the other page.

## Enforce import rules automatically

Rules that are not checked erode within weeks. Check them in CI:

| Tool | Pick when |
|---|---|
| `check-imports.mjs` from this skill | no extra dependencies; layers, feature public APIs and cycles from a small JSON config |
| `eslint-plugin-boundaries` or `import/no-restricted-paths` | the project uses ESLint and wants errors in the editor |
| `no-restricted-imports` patterns | a handful of simple rules (`@/features/*/*` forbidden) in ESLint or Oxlint |
| dependency-cruiser | large codebases; rich rules, cycle detection and graphs |

## Worked example: an invoices feature with a public API and every state

A feature with query options, a list component with loading, error and empty states, a page that composes it with URL state, and the import rules that keep it isolated:

```ts
// features/invoices/api/schemas.ts
import { z } from 'zod'
export const Invoice = z.object({ id: z.string(), number: z.string(), customer: z.string(), total: z.number(), currency: z.string(), status: z.enum(['draft', 'sent', 'paid', 'overdue']) })
export type Invoice = z.infer<typeof Invoice>
export type InvoiceStatus = Invoice['status']
```

```ts
// features/invoices/api/queries.ts
import { queryOptions } from '@tanstack/react-query'
import { http } from '@/shared/api/http'
import { Invoice, type InvoiceStatus } from './schemas'

export const invoiceQueries = {
  all: () => ['invoices'] as const,
  list: (status: InvoiceStatus | 'all') => queryOptions({
    queryKey: [...invoiceQueries.all(), 'list', status] as const,
    queryFn: async ({ signal }) => Invoice.array().parse(await http.get(`/api/invoices${status === 'all' ? '' : `?status=${status}`}`, { signal })),
    staleTime: 30_000,
  }),
}
```

```tsx
// features/invoices/components/invoice-list.tsx
import { useQuery } from '@tanstack/react-query'
import { DataState } from '@/shared/ui/data-state'
import { formatMoney } from '@/shared/lib/format'
import { invoiceQueries } from '../api/queries'
import type { InvoiceStatus } from '../api/schemas'
import { InvoiceStatusBadge } from './invoice-status-badge'

export function InvoiceList({ status, onOpen }: { status: InvoiceStatus | 'all'; onOpen: (id: string) => void }) {
  const q = useQuery(invoiceQueries.list(status))
  return (
    <DataState query={q} label="invoices" empty={<p>No {status === 'all' ? '' : `${status} `}invoices.</p>}>
      {(invoices) => (
        <table>
          <caption className="sr-only">Invoices</caption>
          <thead><tr><th scope="col">Number</th><th scope="col">Customer</th><th scope="col">Total</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td><button type="button" className="link" onClick={() => onOpen(inv.id)}>{inv.number}</button></td>
                <td>{inv.customer}</td>
                <td>{formatMoney(inv.total, inv.currency)}</td>
                <td><InvoiceStatusBadge status={inv.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </DataState>
  )
}
```

```tsx
// shared/ui/data-state.tsx: one place for loading, error and empty UI
import type { UseQueryResult } from '@tanstack/react-query'
export function DataState<T extends unknown[]>({ query, label, empty, children }: {
  query: UseQueryResult<T>; label: string; empty: React.ReactNode; children: (data: T) => React.ReactNode
}) {
  if (query.isPending) return <p role="status">Loading {label}…</p>
  if (query.isError) return <div role="alert"><p>Could not load {label}.</p><button type="button" onClick={() => query.refetch()}>Retry</button></div>
  if (query.data.length === 0) return <>{empty}</>
  return <>{children(query.data)}</>
}
```

```tsx
// pages/invoices/invoices-page.tsx: composes features, owns URL state
import { useNavigate, useSearchParams } from 'react-router'
import { InvoiceList, type InvoiceStatus } from '@/features/invoices'
const STATUSES = ['all', 'draft', 'sent', 'paid', 'overdue'] as const

export function InvoicesPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const raw = params.get('status')
  const status: InvoiceStatus | 'all' = STATUSES.includes(raw as never) ? (raw as InvoiceStatus | 'all') : 'all'
  return (
    <main aria-labelledby="inv-title">
      <h1 id="inv-title">Invoices</h1>
      <label>Status{' '}
        <select value={status} onChange={(e) => setParams({ status: e.target.value })}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <InvoiceList status={status} onOpen={(id) => navigate(`/invoices/${id}`)} />
    </main>
  )
}
```

`check-imports.mjs` reads its layers from `.import-rules.json`:

```json
{ "root": "src", "alias": { "@/": "src/" }, "layers": ["app", "pages", "features", "shared"], "featureLayers": ["features"] }
```

The page imports only `@/features/invoices`; the feature imports only `shared` and itself; `shared` knows nothing about invoices. Growing from here (packages, monorepos, code ownership): [growing-a-react-codebase.md](references/growing-a-react-codebase.md).

## Verify the architecture

```bash
node <this-skill>/scripts/check-imports.mjs src --config .import-rules.json   # exit 1 on any violation or cycle
npx tsc --noEmit                                                              # aliases resolve
git grep -n "features/[a-z-]*/\(components\|api\|hooks\|lib\)/" -- 'src/pages' 'src/app'   # deep imports into features
```

Then try the deletion test: delete one feature folder on a branch and run the type check. Errors should appear only in pages or app files that render it, never in other features or `shared`.

## Gotchas and anti-patterns in React architecture

Each gotcha names the symptom, its cause and the fix.

1. **Changing one screen breaks another.** Cause: features import each other's internals. Fix: public `index.ts` per feature and a check in CI.
2. **"Cannot access X before initialization" at startup.** Cause: a circular import, often through barrels. Fix: one barrel per feature, no barrel imports inside a feature, and the cycle report from `check-imports.mjs`.
3. **`shared/` became a junk drawer.** Cause: business logic placed there because two features needed it. Fix: shared holds only domain-free code; domain code shared by features becomes its own lower feature.
4. **Tests and the dev server slowed down.** Cause: deep barrel files pulling whole folders into every import. Fix: import from a feature's single entry; no `index.ts` in every folder.
5. **A global store holds server data and goes stale.** Cause: copying API responses into Redux or Zustand. Fix: the query cache per feature; global stores for client-only state.
6. **Filters reset when users share a link or press Back.** Cause: filter state in component state. Fix: the page keeps it in the URL.
7. **Nobody knows where a new file goes.** Cause: an unwritten structure. Fix: a short `ARCHITECTURE.md` with the layer table, and the import check.
8. **A "utils" file with 80 unrelated functions.** Cause: grouping by type. Fix: move each function next to its only user, or into a named module in `shared/lib`.

## Pre-merge checklist for architecture

1. New code sits in the right layer and feature; nothing new in a type folder at the root.
2. Imports point down the layers; other features are imported only through `index.ts`.
3. A feature's `index.ts` exports only what others use.
4. Server state lives in feature query options; shareable UI state lives in the URL.
5. No new barrels inside features; no import cycles.
6. `check-imports.mjs` (or the configured linter rule) passes in CI.

See also: react-project-setup, react-state-management, react-data-fetching, react-code-review, react-ci-quality-gates.
