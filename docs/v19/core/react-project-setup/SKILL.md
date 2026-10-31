---
name: react-project-setup
description: Starts or audits a React 19 single-page app built with Vite 8 and TypeScript 7 - the create command and templates, tsconfig, Oxlint or ESLint with the Rules of React and compiler rules, Tailwind CSS 4, environment variables, path aliases, folder layout and the scripts a project needs. Use when creating a new React app, upgrading Vite or TypeScript, wiring lint or Tailwind, deciding a folder structure, or when a build, dev server or env variable misbehaves.
metadata:
  tags:
  - react
  - vite
  - typescript
  - oxlint
  - eslint
  - tailwind
  - setup
  - project-structure
---

# React project setup with Vite

This skill sets up a React 19 app the way current tooling expects: Vite 8 (Rolldown inside), TypeScript 7, a linter that knows the Rules of React, and a folder layout that keeps features easy to find and delete. Use a framework (React Router framework mode, Next.js and others) when the app needs server rendering; this skill covers the client-rendered app.

## Step 0: read what is installed

Installed versions decide which APIs and flags exist, so read them before writing config. Run this skill's script with the project root as the working directory:

```bash
node <this-skill>/scripts/installed-versions.mjs      # in Claude Code: node ${CLAUDE_SKILL_DIR}/scripts/installed-versions.mjs
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

It prints the versions of React, Vite, TypeScript, the router, the data and test libraries, and the Node version. Versions this library was written against (October 2026): `react` and `react-dom` 19.3.1, `vite` 8.3.5, `@vitejs/plugin-react` 6.1.2, `typescript` 7.0.2, `oxlint` 1.90.0, `eslint` 10.14.0, `eslint-plugin-react-hooks` 7.1.1, `typescript-eslint` 8.72.1, `tailwindcss` 4.3.3. Vite 8 needs Node `^20.19.0 || >=22.12.0`; Vitest 5 and MSW 3 need 22.12 or newer; React Router 8.5.1 needs `>=22.22.0`. Use Node 22.22 or newer.

## Choose the app type, compiler and linter

Choosing the setup is three decisions: where the HTML is rendered, whether the React Compiler is on, and which linter runs. Decide them before the first commit, because each is costly to change later:

| Decision | Choose | When | Why the alternatives lose |
|---|---|---|---|
| App type | Vite 8 SPA (this skill) | dashboards, admin tools, apps behind a login, desktop shells | a server framework adds a server to run and secure that the app does not need |
| App type | React Router framework mode or Next.js | public pages that need SEO, first paint from the server, server actions | a Vite SPA ships an empty `<div id="root">` and renders only after the bundle runs |
| Compiler | `react-compiler-ts` template | new code, code that passes the compiler lint rules | hand-written `useMemo`, `useCallback` and `memo` cost review time and miss cases the compiler catches |
| Compiler | `react-ts`, compiler later | a large legacy codebase with many Rules of React violations | turning the compiler on before the lint is clean makes it skip components silently |
| Linter | Oxlint | TypeScript 7 projects, fast CI | ESLint with `typescript-eslint` 8.72 refuses TypeScript 7 at install time |
| Linter | ESLint 10 with TypeScript 6.0 | the project needs an ESLint-only plugin | Oxlint cannot load arbitrary ESLint plugins |

Server rendering and Server Components are covered in `react-server-components`; module boundaries for large apps in `react-architecture`.

## Create a new app with create-vite

The create-vite templates give a working React app in one command. Pick the template with the React Compiler unless you have a reason not to:

```bash
npm create vite@latest my-app -- --template react-compiler-ts
cd my-app && npm install && npm run dev
```

| Template | What you get |
|---|---|
| `react-ts` | React 19, TypeScript 7, `@vitejs/plugin-react` (Oxc transforms), Oxlint |
| `react-compiler-ts` | the same plus the React Compiler through Babel |
| `react`, `react-compiler` | the JavaScript versions |

- The template's `build` script is `tsc -b && vite build`: Vite strips types without checking them, so the type check is a separate step.
- `@vitejs/plugin-react-swc` 4 is the SWC alternative to the Oxc-based plugin; install it by hand when a project needs SWC plugins.
- With pnpm: `pnpm create vite my-app --template react-compiler-ts`. With Bun: `bun create vite my-app --template react-compiler-ts`.

## Vite config for a React app

The Vite config holds plugins, aliases and dev server options. A typical config with the compiler, Tailwind and an `@` alias:

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
})
```

- Keep the alias in two places: `resolve.alias` here and `compilerOptions.paths` in `tsconfig.app.json` (`"@/*": ["./src/*"]`, with no `baseUrl`: TypeScript 7 rejects it). Vite does not read `paths` by itself.
- `@vitejs/plugin-react` 6 has no `babel` option. Babel plugins go through `@rolldown/plugin-babel`; the compiler details are in the `react-performance` skill.
- A backend on another port: `server.proxy: { '/api': 'http://localhost:3000' }` avoids CORS in development.

## TypeScript config for React

The tsconfig decides how strict the type check is. Start from the template's `tsconfig.app.json` and add strictness:

```jsonc
// tsconfig.app.json (compilerOptions, added to the template's)
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitOverride": true,
  "paths": { "@/*": ["./src/*"] }
}
```

- The template already sets `jsx: "react-jsx"`, `moduleResolution: "bundler"`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. The last one forbids `enum` and parameter properties, because Vite strips types and cannot compile them; use union types and plain objects.
- Run the check with `npx tsc -b` (project references) or `npx tsc -p tsconfig.app.json --noEmit`.
- Typing components, props and hooks: the `react-typescript` skill.

## Lint with the Rules of React

A linter that knows the Rules of React catches broken hooks and code the React Compiler cannot optimize. The create-vite templates ship Oxlint 1.x, which runs the same compiler diagnostics as `eslint-plugin-react-hooks` 7 and works with TypeScript 7. Turn the rules on explicitly:

```jsonc
// .oxlintrc.json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc", "jsx-a11y", "vitest"],
  "categories": { "correctness": "error" },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/exhaustive-deps": "warn",
    "react/purity": "error",
    "react/refs": "error",
    "react/immutability": "error",
    "react/set-state-in-effect": "error",
    "react/set-state-in-render": "error",
    "react/static-components": "error",
    "react/preserve-manual-memoization": "error",
    "react/incompatible-library": "warn",
    "react/jsx-key": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }],
    "jsx-a11y/prefer-tag-over-role": "off"
  }
}
```

```bash
npx oxlint            # add "lint": "oxlint" to package.json
```

`jsx-a11y/prefer-tag-over-role` is off because it flags correct markup: `role="status"` on a live region (`<output>` means the result of a calculation or user action and holds phrasing content only, so a toast region cannot be one), `role="list"` on a virtual list, `role="img"` on an inline `svg`. A clickable `div` with no focus or key handler is still caught by `interactive-supports-focus` and `click-events-have-key-events`.

ESLint is the other choice when the project needs ESLint-only plugins. Its React rules come from `eslint-plugin-react-hooks` 7 (`reactHooks.configs.flat.recommended`, which includes the compiler rules; the separate `eslint-plugin-react-compiler` package is retired). TypeScript files need `typescript-eslint`, and version 8.72 declares `typescript >=4.8.4 <6.1.0` as its peer: with TypeScript 7 installed, `npm install` stops on the peer conflict. Until `typescript-eslint` supports 7, use Oxlint, or keep TypeScript 6.0 in that project.

```js
// eslint.config.js (TypeScript 6.0 projects)
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended, reactRefresh.configs.vite()],
    languageOptions: { globals: globals.browser },
  },
])
```

- `eslint-plugin-jsx-a11y` 6.10.2 declares ESLint up to 9 as its peer; on ESLint 10 use Oxlint's `jsx-a11y` plugin instead.
- Run the linter in CI. The compiler skips a component that breaks a rule without failing the build, so the linter is the only place you see it.

## Tailwind CSS 4 in a Vite app

Tailwind 4 is configured in CSS, not in a JavaScript config file. Install the Vite plugin and import Tailwind once:

```bash
npm i -D tailwindcss @tailwindcss/vite
```

```css
/* src/index.css */
@import "tailwindcss";

@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@theme {
  --font-sans: system-ui, -apple-system, "Segoe UI", sans-serif;
  --color-accent: oklch(62% 0.19 255);
}
```

- `@theme` variables become utilities (`bg-accent`, `font-sans`) and CSS variables at the same time.
- The `@custom-variant dark` line lets a user setting override the OS theme; the `react-app-layouts` skill shows the theme switch.
- There is no `tailwind.config.js` and no `content` list: Tailwind 4 detects source files itself.
- Component styling (the `cn` helper, variants, shadcn/ui, tokens): the `react-styling` skill.

## Environment variables in Vite

Vite exposes only variables that start with `VITE_` to client code, through `import.meta.env`. Anything in the client bundle is public, so never put a secret there.

```ts
// src/env.ts
const apiUrl = import.meta.env.VITE_API_URL
if (!apiUrl) throw new Error('VITE_API_URL is not set')
export const env = { apiUrl, dev: import.meta.env.DEV } as const
```

```ts
// src/vite-env.d.ts
interface ImportMetaEnv { readonly VITE_API_URL: string }
interface ImportMeta { readonly env: ImportMetaEnv }
```

- Files: `.env`, `.env.local` (git-ignored), `.env.development`, `.env.production`. Restart the dev server after changing them.
- `process.env` does not exist in the browser build; code ported from webpack or Next.js must switch to `import.meta.env`.

## Folder layout by feature

A feature folder holds everything one feature needs, so it is one folder to read or delete. Shared code moves to `shared/` only when a second feature needs it.

```
src/
├── main.tsx            createRoot + providers + router
├── app/                app shell: providers.tsx, router.tsx, layout
├── features/
│   └── invoices/
│       ├── api.ts          query options and mutations (react-data-fetching)
│       ├── InvoiceList.tsx
│       ├── InvoiceForm.tsx
│       ├── invoice.schema.ts
│       └── InvoiceList.test.tsx
├── shared/
│   ├── ui/             design-system components (Button, Dialog, Field)
│   ├── hooks/          hooks used by several features
│   └── lib/            fetch client, formatting, env
└── index.css
```

More on layout rules, barrel files and naming: [project-structure.md](references/project-structure.md). Boundaries between features, dependency rules and monorepos at scale: `react-architecture`.

## Scripts every React project needs

The `package.json` scripts are the commands CI and people run. Keep the names standard:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b",
    "lint": "oxlint",
    "test": "vitest",
    "test:run": "vitest run --coverage"
  }
}
```

Test setup (Vitest 5, Testing Library, MSW): the `react-testing` skill.

## Worked example: setting up an invoices app from create-vite to a green build

This worked example walks a new client-rendered invoices app through every step of the setup, in order, with the commands to run:

1. **Create** on Node 22.22 or newer: `npm create vite@latest invoices -- --template react-compiler-ts`, then `cd invoices && npm install`.
2. **Tailwind**: `npm i -D tailwindcss @tailwindcss/vite`, add `tailwindcss()` to `plugins` in `vite.config.ts`, and start `src/index.css` with `@import "tailwindcss";`.
3. **Alias**: `resolve.alias` maps `'@'` to `./src` in `vite.config.ts`, and `"paths": { "@/*": ["./src/*"] }` goes in `tsconfig.app.json`, with no `baseUrl` (TypeScript 7 rejects it).
4. **Strict types**: add `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `noImplicitOverride` to `tsconfig.app.json`, then fix what `npx tsc -b` reports.
5. **Lint**: write `.oxlintrc.json` with the React rules on (`react/rules-of-hooks`, `react/exhaustive-deps`, the compiler rules), then `npx oxlint --deny-warnings`.
6. **Environment**: `VITE_API_URL=http://localhost:3000` in `.env.local` (git-ignored), read only through `src/env.ts`, which throws when it is missing, and typed in `src/vite-env.d.ts`.
7. **Layout**: `src/features/invoices/` holds `api.ts`, `InvoiceList.tsx`, `invoice.schema.ts` and `InvoiceList.test.tsx`; `src/shared/` stays empty until a second feature needs something.
8. **Tests**: the template has no Vitest, so run `npm i -D vitest jsdom @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom msw @vitest/coverage-v8`, then add a `vitest.config.ts` with `export default mergeConfig(viteConfig, defineConfig({ test: { environment: 'jsdom' } }))`, both helpers from `vitest/config`.
9. **Scripts**: `typecheck`, `lint`, `test` and `test:run` beside the template's `dev`, `build` and `preview`.
10. **Prove it**: `npx tsc -b`, `npx oxlint --deny-warnings`, `npx vitest run` and `npm run build` each exit 0, and `npx vite preview` serves a page with `id="root"`.

## Verify a React project setup

These commands prove the setup works end to end; run them from the project root after any change to config, dependencies or scripts. Each must exit 0:

```bash
node <this-skill>/scripts/installed-versions.mjs     # expected majors; warns when Node is older than 22.22
npx tsc -b                                           # types, with the strict flags on
npx oxlint --deny-warnings                           # or: npx eslint . --max-warnings 0
npx vitest run                                       # tests (react-testing)
npm run build                                        # tsc -b && vite build
npx vite preview --port 4173 --strictPort & PREVIEW=$!   # serve the production build
sleep 2; curl -fsS http://localhost:4173/ | grep -q 'id="root"' && echo "preview ok"; kill "$PREVIEW"
```

- Prove the alias in both places: `grep -n '"@/\*"' tsconfig.app.json` and `grep -n "alias" vite.config.ts` both print a line.
- Prove no secret is exposed: `grep -nE '^VITE_[A-Z_]*(SECRET|PRIVATE|PASSWORD)' .env*` prints nothing.
- Prove the React Compiler runs: React DevTools shows the "Memo ✨" badge on a component in `npm run dev`.
- Deep links on the real host (SPA fallback, cache headers, CI): `react-build-and-deploy`.

## Pre-merge checklist for a React project setup

Check each point before merging a new project or a setup change.

1. Node 22.22 or newer; `scripts/installed-versions.mjs` prints the expected majors.
2. Created from `react-compiler-ts` (or `react-ts` with the compiler added later on purpose).
3. `strict` and `noUncheckedIndexedAccess` on; `npx tsc -b` passes.
4. Oxlint with the `react/*` compiler rules on (or ESLint with `reactHooks.configs.flat.recommended` on TypeScript 6.0); `npm run lint` passes with no warnings.
5. Alias defined in both `vite.config.ts` and `tsconfig.app.json`.
6. Only `VITE_` variables in client code, typed in `vite-env.d.ts`, no secrets.
7. Feature folders; no `utils/` dumping ground.
8. `npm run build && npm run preview` serves the production build.

## Gotchas and anti-patterns in React project setup

Each entry gives the symptom you see, its cause and the fix.

1. **`Cannot find module '@/…'` at runtime but not in the editor.** Cause: the alias exists only in `tsconfig`; Vite does not read `paths`. Fix: add `resolve.alias` in `vite.config.ts`.
2. **`react({ babel: { plugins } })` does nothing or fails.** Cause: `@vitejs/plugin-react` 6 removed the `babel` option. Fix: `@rolldown/plugin-babel` with `reactCompilerPreset()`.
3. **`enum` fails to compile.** Cause: `erasableSyntaxOnly` in the template. Fix: a union type (`type Status = 'draft' | 'sent'`) and a `const` object when you need runtime values.
4. **`import.meta.env.API_URL` is undefined.** Cause: the variable lacks the `VITE_` prefix, or the dev server was not restarted after editing `.env`. Fix: rename it `VITE_API_URL`, type it in `vite-env.d.ts`, restart the dev server.
5. **Type errors pass the build.** Cause: `vite build` alone strips types without checking. Fix: keep `tsc -b &&` in the build script or run `typecheck` in CI.
6. **A page reload on a deep route returns 404 in production.** Cause: the static host serves files only. Fix: configure an SPA fallback to `index.html` on the host, or use a hash router where you cannot (see `react-router-data-mode`).
7. **`npm install` fails with ERESOLVE after adding typescript-eslint.** Cause: `typescript-eslint` 8.72 supports TypeScript below 6.1 and the project has TypeScript 7. Fix: lint with Oxlint, or pin TypeScript 6.0; never `--force` past it.
8. **Fast Refresh reloads the whole page.** Cause: a file exports components and non-components together. Fix: move constants and helpers to their own module (`react-refresh/only-export-components` warns about it).
9. **`error TS5102: Option 'baseUrl' has been removed` after following a setup guide.** Cause: TypeScript 7 removed `baseUrl`, and many guides written for TypeScript 5 (UI-kit install pages among them) still add `"baseUrl": "."` next to `paths`. Fix: delete `baseUrl` and keep `"paths": { "@/*": ["./src/*"] }`; `paths` entries resolve relative to the tsconfig file.
10. **Anti-pattern: a `utils/` or `components/` folder at the top that everything imports.** Symptom: deleting a feature breaks unrelated screens. Cause: type folders mix features. Fix: feature folders, with `shared/` only for code two features use.
11. **Anti-pattern: `npm install --force` or `--legacy-peer-deps` to get past a peer conflict.** Symptom: the install succeeds and a tool fails later in CI or at runtime. Cause: the conflict was real. Fix: pick versions that agree (the linter table above), and keep the lockfile committed.

## See also

- `react-build-and-deploy`: production builds, hosting, SPA fallback, CI and caching.
- `react-architecture`: module boundaries, dependency rules and monorepos beyond the folder layout here.
- `react-typescript`, `react-styling`, `react-testing`, `react-performance` (React Compiler details).
