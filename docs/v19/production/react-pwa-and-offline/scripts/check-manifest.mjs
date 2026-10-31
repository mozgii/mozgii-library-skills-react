#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Checks a built PWA: the web app manifest's fields and icons, that icon files exist with the declared PNG size,
// that index.html links the manifest, and that a service worker file is present.
// Usage: node check-manifest.mjs [dist-dir=dist] [--manifest path/to/manifest.webmanifest] [--json]
// Exit code: 0 when no errors (warnings allowed), 1 when errors were found, 2 on a usage error.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node check-manifest.mjs [dist-dir=dist] [--manifest FILE] [--json]')
  process.exit(0)
}
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
const json = argv.includes('--json')
const dist = resolve(argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--manifest') ?? 'dist')
if (!existsSync(dist) || !statSync(dist).isDirectory()) { console.error(`No such build folder: ${dist} (run the build first)`); process.exit(2) }

const errors = [], warnings = [], info = []
const indexPath = join(dist, 'index.html')
const html = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
if (!html) errors.push('index.html is missing from the build folder')

// Find the manifest: --manifest, the <link rel="manifest"> in index.html, or a known file name.
let manifestPath = opt('--manifest') && resolve(opt('--manifest'))
const link = html.match(/<link[^>]+rel=["']manifest["'][^>]*>/i)?.[0]
const href = link?.match(/href=["']([^"']+)["']/i)?.[1]
if (!link && html) errors.push('index.html has no <link rel="manifest">')
if (!manifestPath && href && !/^https?:/.test(href)) manifestPath = join(dist, href.replace(/^\//, '').split(/[?#]/)[0])
if (!manifestPath) manifestPath = ['manifest.webmanifest', 'manifest.json', 'site.webmanifest'].map((f) => join(dist, f)).find(existsSync)
if (!manifestPath || !existsSync(manifestPath)) { console.error('No manifest found (looked at the link in index.html and manifest.webmanifest/json).'); process.exit(1) }

let m
try { m = JSON.parse(readFileSync(manifestPath, 'utf8')) } catch (e) { console.error(`Manifest is not valid JSON: ${e.message}`); process.exit(1) }
info.push(`manifest: ${manifestPath}`)

const need = (cond, msg) => { if (!cond) errors.push(msg) }
const want = (cond, msg) => { if (!cond) warnings.push(msg) }
need(m.name || m.short_name, 'name or short_name is required')
want(m.name, 'name is missing (shown in install dialogs)')
want(m.short_name, 'short_name is missing (shown under the home screen icon)')
want(!m.short_name || m.short_name.length <= 12, `short_name "${m.short_name}" is longer than 12 characters and may be truncated`)
need(m.start_url, 'start_url is required')
want(m.id, 'id is missing; without it the app identity follows start_url and changes if start_url changes')
want(m.scope, 'scope is missing; it defaults to the folder of start_url')
need(['standalone', 'fullscreen', 'minimal-ui', 'browser'].includes(m.display) || Array.isArray(m.display_override), 'display must be standalone, fullscreen, minimal-ui or browser')
want(m.display !== 'browser', 'display "browser" opens in a normal tab; use "standalone" for an app window')
want(/^#|^rgb|^hsl|^[a-z]+$/i.test(m.theme_color ?? ''), 'theme_color is missing')
want(/^#|^rgb|^hsl|^[a-z]+$/i.test(m.background_color ?? ''), 'background_color is missing (used for the splash screen)')
if (m.start_url && m.scope) {
  const base = 'https://example.invalid/'
  want(new URL(m.start_url, base).href.startsWith(new URL(m.scope, base).href), 'start_url is outside scope')
}

// Icons: sizes, purposes, files on disk, PNG dimensions.
const icons = Array.isArray(m.icons) ? m.icons : []
need(icons.length > 0, 'icons are required')
const manifestDir = dirname(manifestPath)
const sizes = new Set()
let maskable = false
for (const icon of icons) {
  const declared = String(icon.sizes ?? '').split(/\s+/).filter(Boolean)
  declared.forEach((s) => sizes.add(s))
  if (String(icon.purpose ?? 'any').split(/\s+/).includes('maskable')) maskable = true
  if (!icon.src) { errors.push('an icon has no src'); continue }
  if (/^https?:|^data:/.test(icon.src)) continue
  const file = icon.src.startsWith('/') ? join(dist, icon.src.slice(1)) : join(manifestDir, icon.src)
  if (!existsSync(file)) { errors.push(`icon file not found: ${icon.src}`); continue }
  const buf = readFileSync(file)
  if (buf.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20)
    if (declared.length && !declared.includes(`${w}x${h}`) && !declared.includes('any')) errors.push(`${icon.src} is ${w}x${h} but declared as ${declared.join(' ')}`)
    if (icon.type && icon.type !== 'image/png') warnings.push(`${icon.src} is a PNG but declared as ${icon.type}`)
  }
}
need(sizes.has('192x192') || sizes.has('any'), 'a 192x192 icon is required')
need(sizes.has('512x512') || sizes.has('any'), 'a 512x512 icon is required')
want(maskable, 'no icon with purpose "maskable"; Android will shrink the icon into a white circle')
want(/apple-touch-icon/i.test(html), 'index.html has no apple-touch-icon link (used by iOS home screen)')
want(/<meta[^>]+name=["']theme-color["']/i.test(html), 'index.html has no <meta name="theme-color">')

// Service worker presence.
const files = readdirSync(dist)
const sw = files.find((f) => /^(sw|service-worker)\.(js|mjs)$/.test(f))
if (!sw) errors.push('no sw.js or service-worker.js in the build root; the app will not work offline')
else {
  info.push(`service worker: ${sw}`)
  const swText = readFileSync(join(dist, sw), 'utf8')
  want(/precache|__WB_MANIFEST|workbox/i.test(swText), `${sw} does not look like a Workbox service worker with a precache list`)
  want(!/registerRoute\([^)]*\/api\//.test(swText) || /NetworkOnly|NetworkFirst/.test(swText), 'API routes are cached; check that personal data is not cached by URL')
}

if (json) {
  console.log(JSON.stringify({ manifest: manifestPath, errors, warnings, info }, null, 2))
} else {
  info.forEach((l) => console.log(l))
  errors.forEach((l) => console.log(`ERROR   ${l}`))
  warnings.forEach((l) => console.log(`warning ${l}`))
  console.log(errors.length ? `\n${errors.length} error(s), ${warnings.length} warning(s).` : `\nManifest OK (${warnings.length} warning(s)).`)
}
process.exit(errors.length ? 1 : 0)
