#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Usage: node find-legacy-apis.mjs [source-dir ...]        (default: src)
// Lists React code that React 19, React Router 8, TanStack Query 5, Vite and current tooling no longer support
// ("removed": breaks after the upgrade) or have replaced ("replace": works today, migrate when you touch the file).
// It is a text scan, so review each hit: a match inside a comment or string is reported too.
// Exit code: 0 when nothing "removed" was found, 1 when something was, 2 on a usage error. No dependencies.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const USAGE = 'Usage: node find-legacy-apis.mjs [source-dir ...]   (default: src; exit 1 when a removed API is found)'
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(USAGE); process.exit(0) }

// A rule's optional fourth entry decides from the whole file. Classes keep defaultProps in React 19, and React Hook
// Form has a current hook also named useFormState.
const notAClass = (found, source) => !new RegExp(`\\bclass\\s+${found[1]}\\b`).test(source)
const fromReactDom = (found, source) => /\bReactDOM\.useFormState\b/.test(found.input)
  || /import\s*\{[^}]*\buseFormState\b[^}]*\}\s*from\s*["']react-dom["']/.test(source)

const RULES = [
  ['removed', /\bReactDOM\.(render|hydrate)\s*\(/, 'ReactDOM.render/hydrate: use createRoot / hydrateRoot from react-dom/client'],
  ['removed', /\bunmountComponentAtNode\s*\(/, 'unmountComponentAtNode: use root.unmount()'],
  ['removed', /\bfindDOMNode\s*\(/, 'findDOMNode: use a ref'],
  ['removed', /\bref\s*=\s*["'][^"']+["']/, 'string ref: use useRef or a callback ref'],
  ['removed', /\b(contextTypes|childContextTypes|getChildContext)\b/, 'legacy context: use createContext'],
  ['removed', /from\s+["']react-dom\/test-utils["']/, 'act moved: import { act } from "react"'],
  ['removed', /\b([A-Z]\w*)\.defaultProps\s*=/, 'defaultProps (ignored on function components in React 19): use default parameters', notAClass],
  ['removed', /\b[A-Z]\w*\.propTypes\s*=/, 'propTypes (ignored in React 19): use TypeScript props'],
  ['removed', /\buseFormState\b/, 'useFormState from react-dom: useActionState from react', fromReactDom],
  ['removed', /from\s+["']react-router-dom["']/, 'react-router-dom (removed in React Router 8): import from react-router'],
  ['removed', /from\s+["']react-query["']/, 'react-query (v3 and older): @tanstack/react-query'],
  ['removed', /\bcacheTime\s*:/, 'cacheTime: gcTime in TanStack Query 5'],
  ['removed', /\bkeepPreviousData\s*:\s*true\b/, 'keepPreviousData: true: placeholderData: keepPreviousData'],
  ['removed', /from\s+["']enzyme["']/, 'Enzyme has no React 18/19 adapter: Testing Library'],
  ['removed', /\bprocess\.env\.REACT_APP_\w+/, 'process.env.REACT_APP_*: import.meta.env.VITE_*'],
  ['removed', /\bcomponentWill(Mount|ReceiveProps|Update)\s*\(/, 'unsafe lifecycle: move to effects, derived state or a key'],
  ['replace', /\bforwardRef\s*[<(]/, 'forwardRef: take ref as a prop (React 19)'],
  ['replace', /\.Provider\b/, 'Context.Provider: render <Context value> (React 19)'],
  ['replace', /from\s+["']framer-motion["']/, 'framer-motion: motion (import from motion/react)'],
  ['replace', /from\s+["']react-test-renderer["']/, 'react-test-renderer (deprecated): Testing Library'],
  ['replace', /from\s+["']@testing-library\/react-hooks["']/, '@testing-library/react-hooks: renderHook from @testing-library/react'],
  ['replace', /from\s+["']react-helmet(-async)?["']/, 'react-helmet: React 19 <title> and <meta> in components'],
  ['replace', /from\s+["']recoil["']/, 'recoil (archived): Jotai or Zustand'],
  ['replace', /\b(ensureQueryData|prefetchQuery|fetchQuery)\s*\(/, 'TanStack Query 5.10x: queryClient.query(...)'],
  ['replace', /\buseViewTransitionState\b|\bviewTransition\s*[=:{]/, 'React Router view transition APIs (deprecated in 8.5): React <ViewTransition>'],
]
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts'])
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git'])

const roots = process.argv.slice(2)
if (roots.length === 0) roots.push('src')
const hits = { removed: [], replace: [] }

function walk(path) {
  const info = statSync(path)
  if (info.isDirectory()) {
    for (const name of readdirSync(path)) if (!SKIP.has(name) && !name.startsWith('.')) walk(join(path, name))
    return
  }
  if (!EXTENSIONS.has(extname(path))) return
  const source = readFileSync(path, 'utf8')
  source.split('\n').forEach((line, i) => {
    for (const [level, pattern, advice, applies] of RULES) {
      const found = line.match(pattern)
      if (found && (!applies || applies(found, source))) hits[level].push(`${relative(process.cwd(), path)}:${i + 1}  ${advice}`)
    }
  })
}

for (const root of roots) {
  try { walk(root) } catch (error) {
    console.error(`Cannot scan ${root}: ${String(error?.message ?? error)}`)
    console.error('Usage: node find-legacy-apis.mjs [source-dir ...]')
    process.exit(2)
  }
}

for (const level of ['removed', 'replace']) {
  console.log(`\n${level === 'removed' ? 'Removed or broken after the upgrade' : 'Replaced, migrate when touched'}: ${hits[level].length}`)
  for (const line of hits[level]) console.log(`  ${line}`)
}
process.exit(hits.removed.length > 0 ? 1 : 0)
