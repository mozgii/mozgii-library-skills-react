#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Checks import rules in a layered React codebase:
//   1. a layer imports only itself or layers listed after it (app -> pages -> features -> shared),
//   2. slices of one layer (pages/a, pages/b) do not import each other, except feature slices through their index,
//   3. anything outside a feature slice imports it only through its public entry (features/x or features/x/index.*),
//   4. no circular imports between files; `import type` and `export type` are erased at build, so they do not count.
// Config (optional) in .import-rules.json or --config FILE:
//   { "root": "src", "alias": { "@/": "src/" }, "layers": ["app","pages","features","shared"], "featureLayers": ["features"] }
// Usage: node check-imports.mjs [folder=src] [--config FILE] [--json]
// Layers are always read from the config root, so a narrower folder (src/features) checks that folder's files
// against the whole layout. A folder outside the config root is taken as its own root.
// Exit code: 0 clean, 1 violations found, 2 usage error.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node check-imports.mjs [folder=src] [--config .import-rules.json] [--json]')
  process.exit(0)
}
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const configPath = flag('--config') ?? (existsSync('.import-rules.json') ? '.import-rules.json' : null)
let config = {}
if (configPath) { try { config = JSON.parse(readFileSync(configPath, 'utf8')) } catch (e) { console.error(`Cannot read ${configPath}: ${e.message}`); process.exit(2) } }
const rootArg = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--config')
const scanRoot = resolve(rootArg ?? config.root ?? 'src')
const configRoot = resolve(config.root ?? 'src')
const inside = (parent, path) => path === parent || path.startsWith(parent + sep)
const root = inside(configRoot, scanRoot) ? configRoot : scanRoot         // where the layer folders are
const alias = config.alias ?? { '@/': 'src/' }
const layers = config.layers ?? ['app', 'pages', 'routes', 'widgets', 'features', 'entities', 'shared']
const featureLayers = new Set(config.featureLayers ?? ['features', 'entities', 'widgets'])
const openLayers = new Set(config.openLayers ?? ['app', 'shared'])      // not split into slices
const json = argv.includes('--json')
if (!existsSync(scanRoot)) { console.error(`No such folder: ${scanRoot}`); process.exit(2) }

const EXTS = ['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs']
const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'coverage'])
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    if (SKIP.has(n)) continue
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXTS.some((e) => n.endsWith(e)) && !n.endsWith('.d.ts')) out.push(p)
  }
  return out
}
const files = walk(root)                                                     // every file, so imports out of the scanned folder resolve
const fileSet = new Set(files)
const scanned = (file) => inside(scanRoot, file)

function resolveFile(base) {
  if (fileSet.has(base)) return base
  for (const e of EXTS) if (fileSet.has(base + e)) return base + e
  for (const e of EXTS) if (fileSet.has(join(base, 'index' + e))) return join(base, 'index' + e)
  const noJs = base.replace(/\.(m?js|jsx)$/, '')                           // TS ESM style: './x.js' -> './x.ts'
  if (noJs !== base) for (const e of EXTS) if (fileSet.has(noJs + e)) return noJs + e
  return null
}
function resolveSpec(from, spec) {
  if (spec.startsWith('.')) return resolveFile(resolve(dirname(from), spec))
  for (const [prefix, target] of Object.entries(alias)) {
    if (spec === prefix.replace(/\/$/, '') || spec.startsWith(prefix)) return resolveFile(resolve(target, spec.slice(prefix.length)))
  }
  return null                                                                 // a package import: not checked
}
const where = (file) => {
  const parts = relative(root, file).split(sep)
  const layer = layers.includes(parts[0]) ? parts[0] : null
  const slice = layer && !openLayers.has(layer) && parts.length > 2 ? parts[1] : null
  const isEntry = slice !== null && parts.length === 3 && /^index\.[mc]?[jt]sx?$/.test(parts[2])
  return { layer, slice, isEntry, rel: relative(process.cwd(), file) }
}

const TYPE_ONLY = /^\s*(?:import|export)\s+type\s+(?!from\s)/      // `import type from 'x'` is a default import named type
const graph = new Map()
const violations = []
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const specs = [
    ...src.matchAll(/^\s*(?:import|export)\s[^'"`]*?from\s+['"]([^'"]+)['"]/gm),
    ...src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ]
  const edges = []
  const a = where(file)
  for (const found of specs) {
    const spec = found[1]
    const target = resolveSpec(file, spec)
    if (!target || target === file) continue
    if (!TYPE_ONLY.test(found[0])) edges.push(target)
    const b = where(target)
    if (!a.layer || !b.layer) continue
    if (!scanned(file)) continue
    const ia = layers.indexOf(a.layer), ib = layers.indexOf(b.layer)
    if (ib < ia) { violations.push({ rule: 'layer', file: a.rel, spec, message: `${a.layer} must not import the higher layer ${b.layer}` }); continue }
    const sameSlice = a.layer === b.layer && a.slice === b.slice
    if (b.slice && !sameSlice) {
      if (a.layer === b.layer && !featureLayers.has(a.layer)) {
        violations.push({ rule: 'slice', file: a.rel, spec, message: `${a.layer}/${a.slice} must not import another slice of the same layer (${b.layer}/${b.slice})` })
      } else if (!b.isEntry) {
        violations.push({ rule: 'public-api', file: a.rel, spec, message: `import ${b.layer}/${b.slice} through its index, not ${relative(root, target)}` })
      }
    }
  }
  graph.set(file, edges)
}

// Circular imports: strongly connected components (Tarjan), iterative to survive deep graphs.
const cycles = []
{
  let index = 0
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = []
  for (const start of files) {
    if (idx.has(start)) continue
    const work = [[start, 0]]
    idx.set(start, index); low.set(start, index); index++; stack.push(start); onStack.add(start)
    while (work.length) {
      const frame = work[work.length - 1]
      const [v, i] = frame
      const edges = graph.get(v) ?? []
      if (i < edges.length) {
        frame[1]++
        const w = edges[i]
        if (!idx.has(w)) { idx.set(w, index); low.set(w, index); index++; stack.push(w); onStack.add(w); work.push([w, 0]) }
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)))
      } else {
        work.pop()
        if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))) }
        if (low.get(v) === idx.get(v)) {
          const comp = []
          let w
          do { w = stack.pop(); onStack.delete(w); comp.push(w) } while (w !== v)
          if (comp.length > 1 && comp.some(scanned)) cycles.push(comp.map((f) => relative(process.cwd(), f)).sort())
        }
      }
    }
  }
}

const count = violations.length + cycles.length
if (json) {
  console.log(JSON.stringify({ root: relative(process.cwd(), scanRoot) || '.', layers, files: files.filter(scanned).length, violations, cycles }, null, 2))
} else {
  console.log(`Checked ${files.filter(scanned).length} files under ${relative(process.cwd(), scanRoot) || '.'} with layers ${layers.join(' > ')}${configPath ? ` (config ${configPath})` : ''}.`)
  for (const rule of ['layer', 'slice', 'public-api']) {
    const list = violations.filter((v) => v.rule === rule)
    if (!list.length) continue
    console.log(`\n${rule} violations (${list.length}):`)
    for (const v of list.slice(0, 100)) console.log(`  ${v.file}: '${v.spec}' - ${v.message}`)
  }
  if (cycles.length) {
    console.log(`\nCircular imports (${cycles.length}):`)
    for (const c of cycles.slice(0, 20)) console.log(`  ${c.join(' <-> ')}`)
  }
  console.log(count ? `\n${count} problem(s).` : '\nNo import rule violations.')
}
process.exit(count ? 1 : 0)
