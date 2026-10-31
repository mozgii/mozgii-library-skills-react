#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Reports what a Vite build ships: raw, gzip and brotli size per JS and CSS file, the JS and CSS that index.html
// loads up front, the largest npm packages (from source maps, when present), packages bundled from more than one
// path, and strings that look like leaked API keys (reported by pattern name only, never printed).
// Usage: node analyze-dist.mjs [dist=dist] [--budget-initial KB] [--budget-chunk KB] [--top N] [--json]
//   budgets are gzip kilobytes; the script exits 1 when one is exceeded or a key pattern is found.
// Exit code: 0 ok, 1 budget exceeded or possible secret, 2 usage error.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { gzipSync, brotliCompressSync, constants } from 'node:zlib'

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node analyze-dist.mjs [dist=dist] [--budget-initial KB] [--budget-chunk KB] [--top N] [--json]')
  process.exit(0)
}
const VALUE_FLAGS = ['--budget-initial', '--budget-chunk', '--top']
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? Number(argv[i + 1]) : undefined }
const dist = argv.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1])) ?? 'dist'
const json = argv.includes('--json')
const top = opt('--top') ?? 10
if (!existsSync(dist) || !statSync(dist).isDirectory()) { console.error(`No such build folder: ${dist}`); process.exit(2) }

const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p) } return out }
const all = walk(dist)
const kb = (n) => `${(n / 1024).toFixed(1)} kB`
const sizeOf = (buf) => ({
  raw: buf.length,
  gzip: gzipSync(buf, { level: 9 }).length,
  brotli: brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
})

// 1. Per-file sizes for JS and CSS.
const assets = all.filter((f) => ['.js', '.mjs', '.css'].includes(extname(f))).map((f) => ({ file: relative(dist, f), ...sizeOf(readFileSync(f)) }))
assets.sort((a, b) => b.gzip - a.gzip)

// 2. What index.html loads before the app can run.
const indexFile = join(dist, 'index.html')
const html = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : ''
const refs = new Set()
for (const m of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) refs.add(m[1])
for (const m of html.matchAll(/<link[^>]+rel=["'](?:modulepreload|stylesheet)["'][^>]*href=["']([^"']+)["']/gi)) refs.add(m[1])
const hrefFirst = /<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:modulepreload|stylesheet)["']/gi
for (const tag of html.matchAll(hrefFirst)) refs.add(tag[1])
const initial = [...refs].filter((r) => !/^https?:/.test(r)).map((r) => r.replace(/^\.?\//, '').split(/[?#]/)[0])
  .map((r) => assets.find((a) => a.file === r || a.file.endsWith(r.replace(/^.*?assets\//, 'assets/')))).filter(Boolean)
const initialJs = initial.filter((a) => !a.file.endsWith('.css'))
const sum = (list, k) => list.reduce((n, a) => n + a[k], 0)

// 3. Packages by bytes of original source, from source maps.
const pkgBytes = new Map(), pkgPaths = new Map()
let mapsRead = 0
for (const f of all.filter((f) => f.endsWith('.js.map'))) {
  let map
  try { map = JSON.parse(readFileSync(f, 'utf8')) } catch { continue }
  mapsRead++
  ;(map.sources ?? []).forEach((src, i) => {
    const m = String(src).match(/(.*node_modules[\\/])((?:@[^\\/]+[\\/])?[^\\/]+)/)
    const name = m ? m[2].replace(/\\/g, '/') : '(your code)'
    pkgBytes.set(name, (pkgBytes.get(name) ?? 0) + (map.sourcesContent?.[i]?.length ?? 0))
    if (m) { const set = pkgPaths.get(name) ?? new Set(); set.add(m[1].replace(/^.*?node_modules/, 'node_modules')); pkgPaths.set(name, set) }
  })
}
const packages = [...pkgBytes].sort((a, b) => b[1] - a[1])
const totalSrc = packages.reduce((n, [, b]) => n + b, 0) || 1
const duplicates = [...pkgPaths].filter(([, paths]) => paths.size > 1).map(([name, paths]) => ({ name, paths: [...paths] }))

// 4. Possible secrets in shipped files: pattern names and file names only.
const PATTERNS = {
  'AWS access key id': /AKIA[0-9A-Z]{16}/g, 'Stripe secret key': /sk_live_[0-9a-zA-Z]{20,}/g,
  'GitHub token': /gh[pousr]_[A-Za-z0-9]{36,}/g, 'Slack token': /xox[abposr]-[A-Za-z0-9-]{10,}/g,
  'private key block': /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, 'OpenAI-style secret key': /sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
}
const secrets = []
for (const f of all.filter((f) => /\.(js|mjs|html|json|txt|map)$/.test(f))) {
  const text = readFileSync(f, 'utf8')
  for (const [name, re] of Object.entries(PATTERNS)) {
    const n = (text.match(re) ?? []).length
    if (n) secrets.push({ file: relative(dist, f), pattern: name, count: n })
  }
}

// 5. Budgets.
const problems = []
const budgetInitial = opt('--budget-initial'), budgetChunk = opt('--budget-chunk')
if (budgetInitial !== undefined && sum(initialJs, 'gzip') / 1024 > budgetInitial) problems.push(`initial JS ${kb(sum(initialJs, 'gzip'))} gzip exceeds the ${budgetInitial} kB budget`)
if (budgetChunk !== undefined) for (const a of assets) if (a.gzip / 1024 > budgetChunk && !a.file.endsWith('.css')) problems.push(`${a.file} is ${kb(a.gzip)} gzip, over the ${budgetChunk} kB chunk budget`)
if (secrets.length) problems.push(`${secrets.length} possible secret(s) in shipped files`)

const report = {
  dist, files: assets.length,
  total: { raw: sum(assets, 'raw'), gzip: sum(assets, 'gzip'), brotli: sum(assets, 'brotli') },
  initial: { files: initial.map((a) => a.file), jsGzip: sum(initialJs, 'gzip'), cssGzip: sum(initial, 'gzip') - sum(initialJs, 'gzip') },
  largest: assets.slice(0, top), packages: packages.slice(0, top).map(([name, bytes]) => ({ name, share: +(bytes / totalSrc * 100).toFixed(1) })),
  duplicates, secrets, problems, sourceMapsRead: mapsRead,
}
if (json) { console.log(JSON.stringify(report, null, 2)); process.exit(problems.length ? 1 : 0) }

console.log(`${assets.length} JS/CSS files: ${kb(report.total.raw)} raw, ${kb(report.total.gzip)} gzip, ${kb(report.total.brotli)} brotli`)
console.log(`Loaded by index.html up front: ${kb(report.initial.jsGzip)} JS + ${kb(report.initial.cssGzip)} CSS (gzip) in ${initial.length} file(s)`)
console.log(`\nLargest files (gzip):`)
for (const a of report.largest) console.log(`  ${kb(a.gzip).padStart(10)}  ${kb(a.raw).padStart(10)} raw  ${a.file}`)
if (mapsRead) {
  console.log(`\nLargest packages by share of bundled source (from ${mapsRead} source map(s)):`)
  for (const p of report.packages) console.log(`  ${String(p.share).padStart(5)} %  ${p.name}`)
} else console.log('\nNo source maps found: build with build.sourcemap (true or "hidden") to see packages.')
if (duplicates.length) { console.log('\nPackages bundled from more than one path (possible duplicate versions):'); duplicates.forEach((d) => console.log(`  ${d.name}: ${d.paths.join(', ')}`)) }
if (secrets.length) { console.log('\nPossible secrets (values not shown):'); secrets.forEach((s) => console.log(`  ${s.file}: ${s.pattern} x${s.count}`)) }
if (problems.length) { console.log('\nProblems:'); problems.forEach((p) => console.log(`  ! ${p}`)) }
process.exit(problems.length ? 1 : 0)
