---
title: React Compiler adoption guide
author: MOZGII, Inc.
lang: en
---

# React Compiler adoption guide

How to turn on the React Compiler 1.0 in a new or existing React app, find what it skips, opt components in or out, and decide what to do with existing `useMemo`, `useCallback` and `memo`.

## Contents

This page, React Compiler adoption guide, has these sections.

1. What the React Compiler does
2. Setup with Vite, Babel and other bundlers
3. Incremental adoption with annotation mode
4. Opting out with use no memo
5. Finding components the compiler skipped
6. Existing manual memoization
7. Libraries and the compiler
8. React 17 and 18 targets

## What the React Compiler does

The React Compiler is a build-time transform that rewrites components and hooks so values, callbacks and JSX are recomputed only when their inputs change. It is the automatic version of `useMemo`, `useCallback` and `memo`, applied at a finer grain than people write by hand (individual JSX subtrees and values in the middle of a function). It assumes the code follows the Rules of React: pure render, no mutation of props or state, hooks at top level. Code that breaks them is left uncompiled rather than miscompiled.

## Setup with Vite, Babel and other bundlers

The compiler ships as a Babel plugin, `babel-plugin-react-compiler`. On Vite 8 with `@vitejs/plugin-react` 6, Babel runs through `@rolldown/plugin-babel` and the React plugin exports a preset:

```bash
npm i -D @rolldown/plugin-babel @babel/core babel-plugin-react-compiler
```

```ts
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

export default defineConfig({ plugins: [react(), babel({ presets: [reactCompilerPreset()] })] })
```

- A new app gets this from `npm create vite@latest my-app -- --template react-compiler-ts`.
- `react({ compiler: true })` uses `oxc-transform-react`, a Rust port, as an optional peer; it is faster and marked experimental. Use the Babel path for production until the README drops the warning.
- Other setups: `babel.config.js` with `plugins: [['babel-plugin-react-compiler', {}]]` placed first in the plugin list; frameworks (React Router framework mode, Next.js, Expo) have their own switches, see their docs.
- Adding Babel slows builds of large apps; the create-vite README calls this out as the reason the compiler is not in the default template.

## Incremental adoption with annotation mode

On a large existing codebase, compile only the components you opt in, then widen the scope. Annotation mode compiles only functions that start with the `"use memo"` directive:

```ts
babel({ presets: [reactCompilerPreset({ compilationMode: 'annotation' })] })
```

```tsx
export function InvoiceTable({ rows }: { rows: Row[] }) {
  'use memo'
  // ...
}
```

Another route is to compile one directory at a time with the Babel plugin's `sources` filter, then remove the filter once tests pass.

## Opting out with use no memo

The `"use no memo"` directive at the top of a function or file excludes it from compilation. Use it as a temporary escape hatch when a compiled component misbehaves, with a comment and an issue reference, and fix the underlying Rule of React violation later. It is not a performance tool.

## Finding components the compiler skipped

The compiler does not fail the build when it bails out on a component; it leaves the component as written. Three ways to see bailouts:

- The lint rules: Oxlint's `react/*` compiler rules or `eslint-plugin-react-hooks` 7's `recommended` preset report the same diagnostics as the compiler. In that preset, `rules-of-hooks` and `exhaustive-deps` are the two classic rules; the compiler rules are `purity`, `refs`, `immutability`, `globals`, `set-state-in-render`, `set-state-in-effect`, `static-components`, `component-hook-factories`, `error-boundaries`, `use-memo`, `unsupported-syntax`, `incompatible-library`, `preserve-manual-memoization`, and `config` and `gating` for the compiler's own options. A diagnostic means the compiler skipped that component, not that the build is broken, so fix them at your own pace.
- React DevTools: compiled components show a "Memo ✨" badge.
- With the Rust compiler option, `logDiagnostics: true` logs recoverable diagnostics through Vite.

Common causes: reading `ref.current` during render, mutating a prop or a value from a hook, defining a component inside a component, calling a hook conditionally, and hooks from libraries listed as incompatible.

## Existing manual memoization

Existing `useMemo`, `useCallback` and `memo` keep working under the compiler. Leave them in place when adopting; the compiler checks that its memoization preserves yours (`preserve-manual-memoization`). Remove them gradually, file by file, with tests, because some memoized values are effect dependencies whose identity matters. In new code, write none for performance; keep `useMemo` only where identity is part of correctness, such as a value passed to a third-party hook that compares by reference.

## Libraries and the compiler

Some library hooks return objects whose methods read changing internal state, which the compiler cannot memoize safely. The compiler knows a list of them and skips components that use them; the `incompatible-library` lint rule warns:

| Library hook | Compiler behaviour | What to do |
|---|---|---|
| TanStack Virtual `useVirtualizer` | component skipped | keep the virtualized list in a small leaf component |
| TanStack Table `useReactTable` | component skipped | isolate the table in its own component |
| React Hook Form `useForm` `watch` | component skipped where `watch` is used | `useWatch` in a child component |

State libraries that subscribe through `useSyncExternalStore` (Zustand, Redux, Jotai, TanStack Query) work with the compiler.

## React 17 and 18 targets

The compiler targets React 19 by default. Apps on React 17 or 18 install `react-compiler-runtime` and set the target option (`reactCompilerPreset({ target: '18' })` or the Babel plugin option `target: '18'`). Upgrading to React 19 first is simpler and removes the runtime package.
