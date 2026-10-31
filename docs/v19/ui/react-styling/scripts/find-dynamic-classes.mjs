#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Usage: node find-dynamic-classes.mjs [source-dir ...]        (default: src)
// Finds Tailwind class names built at runtime, such as `bg-${color}-500` or `text-${size}`. Tailwind finds
// classes by scanning source text, so these are never generated and the style is missing in production.
// Fix each hit with a lookup of complete class names, or a CSS variable read by a fixed class.
// Exit code: 0 when none were found, 1 when some were, 2 on a usage error. No dependencies.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

const USAGE = 'Usage: node find-dynamic-classes.mjs [source-dir ...]   (default: src; exit 1 when a runtime-built class is found)'
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(USAGE); process.exit(0) }

const PREFIX = [
  'bg', 'text', 'border(?:-[trblxyse])?', 'ring', 'outline', 'fill', 'stroke', 'shadow', 'from', 'via', 'to', 'decoration',
  'divide', 'placeholder', 'accent', 'caret', 'w', 'h', 'size', 'min-w', 'max-w', 'min-h', 'max-h', 'p[trblxyse]?',
  'm[trblxyse]?', 'gap(?:-[xy])?', 'space-[xy]', 'top', 'right', 'bottom', 'left', 'inset(?:-[xy])?', 'start', 'end', 'z',
  'grid-cols', 'grid-rows', 'col-span', 'row-span', 'rounded(?:-[trblse]{1,2})?', 'opacity', 'font', 'leading', 'tracking',
  'translate-[xy]', 'rotate', 'scale', 'duration', 'delay', 'order', 'basis', 'columns',
].join('|')
const PATTERNS = [
  new RegExp(`(?<![\\w/.=?&#-])(?:[a-z0-9-]+:)*(?:${PREFIX})-\\$\\{`),        // bg-${tone}, md:p-${n}; not /api/top-${id}
  /\$\{[^}]+\}-(?:50|[1-9]00|950)\b/,                                   // ${color}-500
  new RegExp(`(?<![\\w/.=?&#-])(?:[a-z0-9-]+:)*(?:${PREFIX})-[a-z]+-\\$\\{`),     // text-red-${shade}
]
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte'])
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage'])

const roots = process.argv.slice(2)
if (roots.length === 0) roots.push('src')
const hits = []

function walk(path) {
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path)) if (!SKIP.has(name) && !name.startsWith('.')) walk(join(path, name))
    return
  }
  if (!EXTENSIONS.has(extname(path))) return
  readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
    if (PATTERNS.some((p) => p.test(line))) hits.push(`${relative(process.cwd(), path)}:${i + 1}  ${line.trim().slice(0, 140)}`)
  })
}

for (const root of roots) {
  try { walk(root) } catch (error) {
    console.error(`Cannot scan ${root}: ${String(error?.message ?? error)}`)
    console.error('Usage: node find-dynamic-classes.mjs [source-dir ...]')
    process.exit(2)
  }
}
for (const hit of hits) console.log(hit)
console.log(hits.length === 0 ? 'No runtime-built Tailwind classes found.' : `\n${hits.length} runtime-built class name(s): map them to complete class names`)
process.exit(hits.length === 0 ? 0 : 1)
