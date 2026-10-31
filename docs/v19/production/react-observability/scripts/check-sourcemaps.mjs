#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Checks the source maps of a built app before or after uploading them to an error tracker:
// every JS file has a valid map (version 3, sources, sourcesContent), maps are not referenced publicly
// (no sourceMappingURL comment) unless allowed, debug IDs in JS and map agree, and maps carry no local file paths.
// Usage: node check-sourcemaps.mjs [dist=dist] [--expect-hidden | --expect-deleted] [--allow-public] [--json]
//   --expect-hidden   maps must exist and JS must not reference them (before upload)
//   --expect-deleted  no .map files may remain (after upload, what gets deployed)
// Exit code: 0 ok, 1 problems found, 2 usage error.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node check-sourcemaps.mjs [dist=dist] [--expect-hidden | --expect-deleted] [--allow-public] [--json]')
  process.exit(0)
}
const dist = argv.find((a) => !a.startsWith('--')) ?? 'dist'
const expectHidden = argv.includes('--expect-hidden'), expectDeleted = argv.includes('--expect-deleted')
const allowPublic = argv.includes('--allow-public'), json = argv.includes('--json')
if (expectHidden && expectDeleted) { console.error('Choose one of --expect-hidden and --expect-deleted'); process.exit(2) }
if (!existsSync(dist) || !statSync(dist).isDirectory()) { console.error(`No such build folder: ${dist}`); process.exit(2) }

const walk = (d, out = []) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p) } return out }
const files = walk(dist)
const jsFiles = files.filter((f) => /\.(m?js|cjs)$/.test(f))
const mapFiles = new Set(files.filter((f) => f.endsWith('.map')))
const problems = [], notes = []
const rel = (f) => relative(dist, f)
const LOCAL_PATH = /^(?:\/Users\/|\/home\/|[A-Za-z]:[\\/]|\/private\/|\/var\/folders\/)/

if (expectDeleted) {
  for (const m of mapFiles) problems.push(`${rel(m)}: a source map is still in the build folder; delete maps after upload (filesToDeleteAfterUpload)`)
}

let withMap = 0, withDebugId = 0
for (const js of jsFiles) {
  const text = readFileSync(js, 'utf8')
  const tail = text.slice(-600)
  const urlComment = tail.match(/\/\/[#@] sourceMappingURL=([^\s'"]+)\s*$/)
  const jsDebugId = tail.match(/\/\/# debugId=([0-9a-fA-F-]{32,36})/)?.[1]?.toLowerCase()
  if (jsDebugId) withDebugId++
  if (urlComment && !urlComment[1].startsWith('data:') && !allowPublic) {
    problems.push(`${rel(js)}: references ${urlComment[1]} publicly; build with sourcemap: 'hidden'`)
  }
  if (urlComment?.[1].startsWith('data:')) problems.push(`${rel(js)}: inline source map embedded in the shipped file`)
  if (expectDeleted) continue
  const mapPath = urlComment && !urlComment[1].startsWith('data:') ? join(dirname(js), urlComment[1].split(/[?#]/)[0]) : `${js}.map`
  if (!existsSync(mapPath)) { problems.push(`${rel(js)}: no source map (${basename(mapPath)}); stack traces from this file stay minified`); continue }
  withMap++
  let map
  try { map = JSON.parse(readFileSync(mapPath, 'utf8')) } catch { problems.push(`${rel(mapPath)}: not valid JSON`); continue }
  if (map.version !== 3) problems.push(`${rel(mapPath)}: version ${map.version}, expected 3`)
  if (!Array.isArray(map.sources) || map.sources.length === 0) problems.push(`${rel(mapPath)}: no sources`)
  else {
    const missing = (map.sourcesContent ?? []).filter((c) => c == null).length + Math.max(0, map.sources.length - (map.sourcesContent?.length ?? 0))
    if (missing) notes.push(`${rel(mapPath)}: ${missing} source(s) without sourcesContent; the tracker needs the original files to show code`)
    const local = map.sources.filter((s) => LOCAL_PATH.test(String(s)))
    if (local.length) problems.push(`${rel(mapPath)}: ${local.length} absolute local path(s) in sources (e.g. ${String(local[0]).replace(/^(.{0,40}).*$/, '$1…')}); build from the project root with relative paths`)
  }
  const mapDebugId = String(map.debugId ?? map.debug_id ?? '').toLowerCase() || undefined
  if (jsDebugId && mapDebugId && jsDebugId !== mapDebugId) problems.push(`${rel(js)}: debug ID ${jsDebugId} differs from its map's ${mapDebugId}`)
  if (jsDebugId && !mapDebugId) problems.push(`${rel(js)}: has a debug ID but its map does not`)
  mapFiles.delete(mapPath)
}
if (!expectDeleted) for (const orphan of mapFiles) notes.push(`${rel(orphan)}: map without a matching JS file`)
if (expectHidden && withMap === 0 && jsFiles.length) problems.push('no source maps were found: enable build.sourcemap (hidden) before uploading')
if (!expectDeleted && jsFiles.length && withDebugId === 0) notes.push('no debug IDs found: the error tracker matches maps by file name and release only (the Sentry bundler plugin injects debug IDs)')

if (json) console.log(JSON.stringify({ dist, js: jsFiles.length, withMap, withDebugId, problems, notes }, null, 2))
else {
  console.log(`${jsFiles.length} JS file(s); ${expectDeleted ? 'maps should be gone' : `${withMap} with source maps, ${withDebugId} with debug IDs`}.`)
  for (const p of problems) console.log(`ERROR ${p}`)
  notes.forEach((note) => console.log(`note  ${note}`))
  console.log(problems.length ? `\n${problems.length} problem(s).` : '\nSource maps OK.')
}
process.exit(problems.length ? 1 : 0)
