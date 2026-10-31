#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Checks design-token discipline in a React codebase:
//   1. raw colour literals (hex, rgb, hsl, oklch, lab) in components instead of tokens,
//   2. var(--token) references that no CSS file defines,
//   3. colour tokens defined in :root but given no value in the dark theme.
// Token files are the CSS files that define custom properties; pass --tokens to choose them.
// Usage: node check-tokens.mjs [dir=src] [--tokens file.css,...] [--dark-selector "[data-theme='dark']"] [--json]
// Exit code: 0 when clean, 1 when problems were found, 2 on a usage error.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node check-tokens.mjs [dir=src] [--tokens a.css,b.css] [--dark-selector SELECTOR] [--json]')
  process.exit(0)
}
const opt = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined)
const json = argv.includes('--json')
const root = argv.find((a, i) => !a.startsWith('--') && !['--tokens', '--dark-selector'].includes(argv[i - 1])) ?? 'src'
try { statSync(root) } catch { console.error(`No such folder: ${root}`); process.exit(2) }

const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', 'storybook-static'])
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = resolve(dir, name)   // absolute, so it compares equal to the resolved --tokens paths
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(css|scss|tsx?|jsx?|mdx)$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(root)
const tokenFiles = opt('--tokens') ? opt('--tokens').split(',').map((f) => resolve(f)) : files.filter((f) => f.endsWith('.css') && /--[\w-]+\s*:/.test(readFileSync(f, 'utf8')))
const darkSelector = opt('--dark-selector')
const DARK = darkSelector ? [darkSelector] : ["[data-theme='dark']", '[data-theme="dark"]', '[data-theme=dark]', '.dark', 'prefers-color-scheme: dark']
const COLOR_RE = /#(?:[0-9a-fA-F]{3,4}){1,2}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(\s*[\d.]/g

// Parse custom-property definitions per block: { name -> Set(scope) } where scope is 'root', 'dark' or 'other'.
const defined = new Map()
for (const file of tokenFiles) {
  const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const stack = []
  let buf = ''
  for (const ch of css) {
    if (ch === '{') { stack.push(buf.trim()); buf = '' }
    else if (ch === '}') { flush(buf, stack); buf = ''; stack.pop() }
    else if (ch === ';') { flush(buf, stack); buf = '' }
    else buf += ch
  }
}
function flush(decl, stack) {
  const m = decl.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+)$/)
  if (!m) return
  const ctx = stack.join(' ')
  const scope = DARK.some((d) => ctx.includes(d)) ? 'dark' : /(^|[\s,]):root\b|@theme|\[data-theme=['"]?light/.test(ctx) ? 'root' : 'other'
  const entry = defined.get(m[1]) ?? { scopes: new Set(), value: m[2].trim() }
  entry.scopes.add(scope)
  if (scope === 'root') entry.value = m[2].trim()
  defined.set(m[1], entry)
}

const problems = { rawColours: [], undefinedTokens: [], missingDark: [] }
const tokenSet = new Set(tokenFiles)
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const rel = relative(process.cwd(), file)
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    if (!tokenSet.has(file) && !/^\s*(\/\/|\*|\/\*)/.test(line)) {
      for (const m of line.matchAll(COLOR_RE)) problems.rawColours.push(`${rel}:${i + 1}  ${m[0]}…`)
    }
    for (const m of line.matchAll(/var\(\s*(--[\w-]+)/g)) {
      if (!defined.has(m[1]) && !/^--tw-/.test(m[1])) problems.undefinedTokens.push(`${rel}:${i + 1}  ${m[1]}`)
    }
  })
}
const COLOUR_TEST = new RegExp(COLOR_RE.source)
// A size in a colour-sounding name (--text-sm, --ring-width) is one length or a maths function. Bare HSL channels
// (--background: 0 0% 100%) hold several numbers, so they still count as a colour.
const SIZE_VALUE = /^(?:-?[\d.]+(?:[a-z]+|%)?|(?:calc|clamp|min|max)\(.*\))$/i
const isColour = (name, value) => COLOUR_TEST.test(value)
  || (/colou?r|surface|text|accent|border|bg|background|danger|success|warning|focus|ring/.test(name) && !SIZE_VALUE.test(value))
for (const [name, { scopes, value }] of defined) {
  const primitive = /^--[a-z]+-\d{2,3}$/.test(name)
  if (scopes.has('root') && !scopes.has('dark') && !primitive && isColour(name, value)) problems.missingDark.push(name)
}
// Tokens from @theme inline that only point at a themed variable do not need their own dark value.
problems.missingDark = problems.missingDark.filter((name) => {
  const v = defined.get(name).value.match(/^var\((--[\w-]+)\)$/)
  return !(v && defined.get(v[1])?.scopes.has('dark'))
})

const count = problems.rawColours.length + problems.undefinedTokens.length + problems.missingDark.length
if (json) {
  console.log(JSON.stringify({ root, tokenFiles: tokenFiles.map((f) => relative(process.cwd(), f)), tokens: defined.size, problems }, null, 2))
} else {
  console.log(`Token files: ${tokenFiles.map((f) => relative(process.cwd(), f)).join(', ') || 'none found'} (${defined.size} tokens)`)
  const show = (title, list) => { if (list.length) console.log(`\n${title} (${list.length}):\n${list.slice(0, 50).map((l) => '  ' + l).join('\n')}${list.length > 50 ? `\n  … ${list.length - 50} more` : ''}`) }
  show('Raw colour values outside token files, use a semantic token', problems.rawColours)
  show('var() references to tokens no CSS file defines', problems.undefinedTokens)
  show('Colour tokens with no dark-theme value', problems.missingDark)
  console.log(count ? `\n${count} problem(s).` : '\nTokens are consistent.')
}
process.exit(count ? 1 : 0)
