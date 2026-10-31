#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Enforces bundle-size budgets without dependencies. A budget file lists entries with a glob, a limit and a compression:
//   [{ "name": "Initial JS", "path": "dist/assets/index-*.js", "limit": "180 kB", "compression": "brotli" }]
// Sizes of all files matching an entry are summed. Optionally saves results and compares with a saved baseline.
// Usage:
//   node bundle-budget.mjs [--config .bundle-budget.json] [--markdown] [--json] [--save out.json] [--compare base.json]
//   node bundle-budget.mjs --init [--dist dist] > .bundle-budget.json      (budgets from the current build, +10 percent)
// Exit code: 0 within budget, 1 over budget or an entry matched no files, 2 usage error.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { brotliCompressSync, gzipSync, constants } from 'node:zlib'

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node bundle-budget.mjs [--config FILE] [--markdown] [--json] [--save FILE] [--compare FILE] | --init [--dist dist]')
  process.exit(0)
}
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const toPosix = (p) => p.split(sep).join('/')
const sizeOf = (buf, c) => c === 'gzip' ? gzipSync(buf, { level: 9 }).length : c === 'none' ? buf.length
  : brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length
const fmt = (n) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} kB`
function parseLimit(s) {
  const m = String(s).trim().match(/^([\d.]+)\s*(B|kB|KB|KiB|MB|MiB)$/)
  if (!m) throw new Error(`Bad limit "${s}" (use e.g. "180 kB")`)
  return Number(m[1]) * ({ B: 1, kB: 1024, KB: 1024, KiB: 1024, MB: 1024 ** 2, MiB: 1024 ** 2 })[m[2]]
}
function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++ }
    else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}
function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  if (statSync(dir).isFile()) { out.push(dir); return out }       // a path without wildcards
  for (const n of readdirSync(dir)) { const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p) }
  return out
}
function matchFiles(patterns) {
  const out = new Set()
  for (const pat of [].concat(patterns)) {
    const negate = pat.startsWith('!')
    const glob = toPosix(negate ? pat.slice(1) : pat).replace(/^\.\//, '')
    const base = glob.split('/').filter((_, i, a) => !a.slice(0, i + 1).some((s) => /[*?]/.test(s))).join('/') || '.'
    const re = globToRegExp(glob)
    for (const f of walk(base)) { const p = toPosix(relative(process.cwd(), f)); if (re.test(p)) negate ? out.delete(p) : out.add(p) }
  }
  return [...out].sort()
}

if (argv.includes('--init')) {
  const dist = opt('--dist', 'dist')
  const html = existsSync(join(dist, 'index.html')) ? readFileSync(join(dist, 'index.html'), 'utf8') : ''
  const initial = [...html.matchAll(/(?:src|href)=["']\/?([^"']+\.js)["']/g)].map((m) => m[1].split('/').pop())
  const round = (n) => `${Math.ceil((n * 1.1) / 1024)} kB`
  const budgets = []
  const js = walk(dist).filter((f) => f.endsWith('.js')).map((f) => ({ f: toPosix(relative(process.cwd(), f)), size: sizeOf(readFileSync(f), 'brotli') }))
  const pattern = (file) => file.replace(/-[A-Za-z0-9_-]{8,}\.js$/, '-*.js')        // strip the content hash
  const initialFiles = js.filter((x) => initial.includes(x.f.split('/').pop()))
  if (initialFiles.length) budgets.push({ name: 'Initial JS', path: initialFiles.map((x) => pattern(x.f)), limit: round(initialFiles.reduce((n, x) => n + x.size, 0)), compression: 'brotli' })
  for (const x of js.filter((x) => !initialFiles.includes(x) && x.size > 30 * 1024)) budgets.push({ name: `Chunk ${pattern(x.f).split('/').pop()}`, path: pattern(x.f), limit: round(x.size), compression: 'brotli' })
  const css = walk(dist).filter((f) => f.endsWith('.css'))
  if (css.length) budgets.push({ name: 'CSS', path: `${toPosix(dist)}/**/*.css`, limit: round(css.reduce((n, f) => n + sizeOf(readFileSync(f), 'brotli'), 0)), compression: 'brotli' })
  if (!budgets.length) { console.error(`No JS or CSS found in ${dist}; build first.`); process.exit(2) }
  console.log(JSON.stringify(budgets, null, 2))
  process.exit(0)
}

const configPath = opt('--config', '.bundle-budget.json')
let budgets
try { budgets = JSON.parse(readFileSync(configPath, 'utf8')) } catch (e) { console.error(`Cannot read ${configPath}: ${e.message}`); process.exit(2) }
if (!Array.isArray(budgets)) { console.error(`${configPath} must be a JSON array of budgets`); process.exit(2) }

const baseline = opt('--compare') && existsSync(opt('--compare')) ? JSON.parse(readFileSync(opt('--compare'), 'utf8')) : null
const results = []
for (const b of budgets) {
  let limit
  try { limit = parseLimit(b.limit) } catch (e) { console.error(`${b.name}: ${e.message}`); process.exit(2) }
  const compression = b.compression ?? 'brotli'
  const files = matchFiles(b.path)
  const size = files.reduce((n, f) => n + sizeOf(readFileSync(f), compression), 0)
  const before = baseline?.find((r) => r.name === b.name)?.size
  results.push({ name: b.name, files: files.length, size, limit, compression, delta: before === undefined ? null : size - before,
    status: files.length === 0 && !b.optional ? 'no-files' : size > limit ? 'over' : 'ok' })
}
if (opt('--save')) writeFileSync(opt('--save'), JSON.stringify(results, null, 2))

const failed = results.filter((r) => r.status !== 'ok')
if (argv.includes('--json')) console.log(JSON.stringify(results, null, 2))
else if (argv.includes('--markdown')) {
  console.log('### Bundle budget\n\n| Entry | Size | Limit | Change | Status |\n|---|---:|---:|---:|---|')
  for (const r of results) {
    const change = r.delta === null ? '–' : `${r.delta >= 0 ? '+' : '−'}${fmt(Math.abs(r.delta))}`
    console.log(`| ${r.name} | ${fmt(r.size)} (${r.compression}) | ${fmt(r.limit)} | ${change} | ${r.status === 'ok' ? 'ok' : r.status === 'over' ? '**over budget**' : '**no files matched**'} |`)
  }
} else {
  for (const r of results) {
    const change = r.delta === null ? '' : `  (${r.delta >= 0 ? '+' : '-'}${fmt(Math.abs(r.delta))} vs baseline)`
    console.log(`${r.status === 'ok' ? 'ok  ' : 'FAIL'}  ${r.name}: ${fmt(r.size)} ${r.compression} of ${fmt(r.limit)} in ${r.files} file(s)${change}${r.status === 'no-files' ? '  - no file matched' : ''}`)
  }
  console.log(failed.length ? `\n${failed.length} budget(s) failed.` : '\nAll budgets met.')
}
process.exit(failed.length ? 1 : 0)
