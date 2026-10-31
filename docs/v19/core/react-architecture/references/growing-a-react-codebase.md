---
title: Growing a React codebase
author: MOZGII, Inc.
lang: en
---

# Growing a React codebase

How a React codebase changes shape as it grows: moving a type-folder app to feature folders without a big-bang rewrite, enforcing boundaries with linters, splitting into workspace packages, ownership and decision records, and when separate apps or micro-frontends are worth it. Sources: the TypeScript handbook (project references, path mapping), npm and pnpm workspace documentation, the Node.js packages documentation (`exports`), and the dependency-cruiser and eslint-plugin-boundaries documentation.

## Migrating from type folders to feature folders incrementally

A big-bang move breaks every open branch. Move one feature at a time:

1. Add the target folders (`app`, `pages`, `features`, `shared`) and the `@/` alias beside the old structure.
2. Pick the feature with the fewest dependents; move its components, hooks and API calls into `features/<name>/`, add its `index.ts`, and update imports with an editor refactor or a codemod.
3. Move domain-free helpers into `shared/` only when a second feature needs them.
4. Turn on the import check for the new folders only (`check-imports.mjs src/features`), and widen it as more code moves.
5. Delete the old type folders when they are empty; keep the commit history readable by moving files in commits without other changes (`git mv`).

## Boundary rules in ESLint or Oxlint

`no-restricted-imports` with patterns blocks deep imports into features from any file, and works in ESLint and Oxlint:

```js
// eslint.config.js (flat config)
export default [{
  files: ['src/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', { patterns: [
      { group: ['@/features/*/*'], message: 'Import a feature through its index: @/features/<name>' },
      { group: ['@/app/*', '@/pages/*'], message: 'Lower layers must not import app or pages' },
    ] }],
  },
}]
```

The pattern rule cannot express "a feature may import its own internals"; files inside a feature use relative imports (`../api/queries`), which the pattern does not match. For full layer rules per folder, use `eslint-plugin-boundaries` element types, or dependency-cruiser.

## dependency-cruiser rules for layers and cycles

dependency-cruiser analyzes the import graph and checks rules in CI; it also draws the graph. A minimal configuration for the layers in this skill:

```js
// .dependency-cruiser.cjs
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'shared-is-domain-free', severity: 'error', from: { path: '^src/shared' }, to: { path: '^src/(app|pages|features)' } },
    { name: 'features-not-up', severity: 'error', from: { path: '^src/features' }, to: { path: '^src/(app|pages)' } },
    { name: 'feature-public-api', severity: 'error',
      from: { path: '^src/features/([^/]+)/' }, to: { path: '^src/features/([^/]+)/.+', pathNot: ['^src/features/$1/', '^src/features/[^/]+/index\\.tsx?$'] } },
  ],
  options: { tsConfig: { fileName: 'tsconfig.app.json' }, doNotFollow: { path: 'node_modules' } },
}
```

Run `npx -p dependency-cruiser depcruise src --config .dependency-cruiser.cjs` in CI, and `--output-type dot` to render the graph when discussing structure.

## Splitting into workspace packages

When two apps (a customer app and an admin app) share code, move the shared parts into workspace packages:

```
apps/
├── web/            the customer app (feature folders inside)
└── admin/
packages/
├── ui/             design system: components, tokens
├── api-client/     typed client and schemas generated from the API contract
└── config/         shared tsconfig, lint and test configuration
```

- Each package has a `package.json` with `exports`; apps import `@acme/ui`, never `../../packages/ui/src/button`.
- During development, point `exports` at the TypeScript source (or use the bundler's workspace resolution) so changes show without a build step; build packages only for publishing.
- TypeScript project references (`"composite": true`, `references`) make type checks incremental across packages.
- A package earns its existence by having two consumers or a separate owner; a package per feature inside one app adds friction without benefit.

## Ownership and code review boundaries

A `CODEOWNERS` file maps folders to teams (`/src/features/billing/ @acme/billing-team`), so changes to a feature request review from its owners. Feature folders make ownership lines match code lines. Pair it with a short architecture decision record (ADR) per structural decision (one Markdown file with context, decision, consequences), so the reasons outlive the people.

## When separate apps or micro-frontends are worth it

Micro-frontends (independently deployed parts of one page, composed at runtime with module federation or iframes) solve an organizational problem: teams that must release independently. They cost duplicated dependencies, version skew between React copies, harder shared state, and a more complex build. Prefer, in order: feature folders in one app; workspace packages with shared ownership; separate apps linked by URLs; micro-frontends only when independent deployment is a hard requirement and the team can afford a platform group to maintain the composition layer.

## Signs the structure needs to change

- Merge conflicts concentrate in a few shared files (routes table, a global store, `utils.ts`): split them by feature.
- A "small" change touches more than three features: a boundary is in the wrong place.
- Tests for one feature need half the app mocked: the feature depends on too much; invert the dependency with props or query keys.
- New developers ask where things go: write the layer table down and enforce it.
