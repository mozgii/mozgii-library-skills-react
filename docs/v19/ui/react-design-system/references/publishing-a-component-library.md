---
title: Publishing a React component library
author: MOZGII, Inc.
lang: en
---

# Publishing a React component library

How to package a React design system so other apps install it as a dependency, or pull its components as source through a shadcn registry. Sources: the Node.js packages documentation (`exports`), the Vite library mode guide, the shadcn registry documentation, the Changesets documentation.

## package.json for a component library

The manifest decides what apps can import and what gets installed. A library with per-component entry points and a CSS file:

```json
{
  "name": "@acme/ui",
  "version": "1.4.0",
  "type": "module",
  "sideEffects": ["**/*.css"],
  "files": ["dist"],
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./button": { "types": "./dist/button/index.d.ts", "default": "./dist/button/index.js" },
    "./tokens.css": "./dist/tokens.css",
    "./package.json": "./package.json"
  },
  "peerDependencies": { "react": "^19.0.0", "react-dom": "^19.0.0" },
  "dependencies": { "@base-ui/react": "^1.9.0", "class-variance-authority": "^0.7.1", "tailwind-merge": "^3.7.0" },
  "devDependencies": { "react": "^19.3.1", "react-dom": "^19.3.1", "vite": "^8.3.5", "typescript": "^7.0.2" },
  "scripts": { "build": "vite build && tsc -p tsconfig.build.json", "prepublishOnly": "npm run build" }
}
```

- Put the headless base in `dependencies` when the library wraps it completely, or in `peerDependencies` when apps also import it directly; never both.
- `"files": ["dist"]` keeps stories, tests and source out of the tarball.
- ESM only is fine for apps on current bundlers; add a `require` condition only if a consumer needs CommonJS.

## Vite library mode build for components

Vite's library mode builds the components with React left external:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: { index: resolve('src/index.ts'), 'button/index': resolve('src/button/index.ts') }, formats: ['es'] },
    rolldownOptions: { external: [/^react($|\/)/, /^react-dom($|\/)/, /^@base-ui\/react/] },
    cssCodeSplit: true,
    sourcemap: true,
  },
})
```

Under Vite 8, `build.rolldownOptions` replaces the deprecated `build.rollupOptions`. Emit declarations with `tsc --emitDeclarationOnly` from a `tsconfig.build.json` that includes only `src` and excludes stories and tests.

## Tailwind CSS in a published library

Two ways to ship styles from a Tailwind 4 library:

| Approach | How | Trade-off |
|---|---|---|
| App compiles the classes | the app's CSS adds `@source "../node_modules/@acme/ui/dist";` and imports `@acme/ui/tokens.css` | one CSS bundle, no duplicates; the app must use Tailwind 4 |
| Library ships compiled CSS | the library builds `dist/styles.css` with its own Tailwind run | works in non-Tailwind apps; utilities may duplicate the app's |

Keep tokens in a separate CSS file in both cases, so an app can theme without rebuilding the library.

## Versioning and release with Changesets

Changesets records each change with its semver bump in the pull request and writes the changelog at release:

```bash
npx @changesets/cli          # pick packages and bump type, describe the change for consumers
npx @changesets/cli version  # apply bumps, write CHANGELOG.md
npm publish --provenance --access public   # from CI, with an npm token or trusted publishing
```

Breaking changes for a design system include: a removed or renamed prop, export, token or CSS class; a changed default variant; a changed DOM structure that apps style or test against; raising the React peer range.

## A shadcn registry instead of a package

A shadcn registry distributes components as source: apps run `npx shadcn@latest add https://ui.acme.dev/r/button.json` and own the copied code. Build one from a `registry.json` that lists items and their files:

```bash
npx shadcn@latest build            # reads ./registry.json, writes JSON items to ./public/r
```

| Choose | When |
|---|---|
| npm package | many apps must stay consistent and upgrade together; central fixes reach everyone |
| shadcn registry | apps need to customize components heavily; each app accepts owning its copy |

## Test the packed library in a real app

Before publishing, install the tarball, not the workspace link, so missing files and wrong exports show up:

```bash
npm pack                                  # writes acme-ui-1.4.0.tgz
cd ../sample-app && npm install ../ui/acme-ui-1.4.0.tgz && npm run build
npx publint ../ui                         # checks exports, types and file presence
npx @arethetypeswrong/cli --pack ../ui    # checks type resolution for each entry point
```
