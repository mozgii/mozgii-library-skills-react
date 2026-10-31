#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Scans the lines a pull request adds for React review findings a person should look at: unsafe HTML, suppressed
// hook rules and type errors, index keys, async effects, fetches in effects without an AbortController, clickable divs, images without
// alt, focused or skipped tests, debug leftovers, tokens in storage, secret-looking VITE_ variables, new dependencies
// and very large files. It reads `git diff` only; it never runs project code and never prints secret values.
// Usage: node pr-scan.mjs [--base origin/main] [--json] [--fail-on blocker|warn]
//        node pr-scan.mjs --diff-file pr.diff          (scan a saved unified diff instead of git)
// Exit code: 0 no findings at the --fail-on level (default blocker), 1 findings at that level, 2 usage or git error.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node pr-scan.mjs [--base origin/main] [--diff-file FILE] [--json] [--fail-on blocker|warn]')
  process.exit(0)
}
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const base = opt('--base', 'origin/main')
const failOn = opt('--fail-on', 'blocker')
const json = argv.includes('--json')

let diff
const diffFile = opt('--diff-file')
if (diffFile) {
  try { diff = readFileSync(diffFile, 'utf8') } catch (e) { console.error(`Cannot read ${diffFile}: ${e.message}`); process.exit(2) }
} else {
  const r = spawnSync('git', ['diff', '--unified=0', '--no-color', '--no-ext-diff', `${base}...HEAD`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) { console.error(`git diff against ${base} failed: ${(r.stderr || '').trim() || 'not a git repository?'}\nPass --base <ref> or --diff-file <file>.`); process.exit(2) }
  diff = r.stdout
}

// Each rule: severity, a test on one added line (and its file), and the reason a reviewer cares.
const CODE = /\.(tsx?|jsx?|mts|mjs)$/
const TEST = /\.(test|spec)\.[jt]sx?$|\/e2e\//
const RULES = [
  { id: 'unsafe-html', sev: 'blocker', files: CODE, re: /dangerouslySetInnerHTML/, why: 'renders raw HTML: sanitize with DOMPurify or render as text' },
  { id: 'hooks-rule-disabled', sev: 'blocker', files: CODE, re: /eslint-disable(?:-next-line|-line)?\s+react-hooks\//, why: 'suppresses a Rules of Hooks or dependency warning: fix the effect instead' },
  { id: 'ts-suppressed', sev: 'warn', files: CODE, re: /@ts-ignore|@ts-nocheck/, why: 'silences the type checker: prefer @ts-expect-error with a reason, or fix the type' },
  { id: 'any-type', sev: 'warn', files: /\.(tsx?|mts)$/, re: /(?::\s*any\b|\bas\s+any\b|<\s*any\b|\bany\[\])/, why: 'an any spreads unchecked types: use unknown and narrow, or a real type' },
  { id: 'index-key', sev: 'warn', files: CODE, re: /key=\{\s*(?:i|idx|index)\s*\}|key=\{`[^`]*\$\{\s*(?:i|idx|index)\s*\}[^`]*`\}/, why: 'index keys break state and focus when the list reorders: use a stable id' },
  { id: 'clickable-div', sev: 'warn', files: /\.[jt]sx$/, re: /<(div|span|li|td)\b[^>]*\bonClick=/, why: 'not focusable or keyboard operable: use a button or a link' },
  { id: 'img-no-alt', sev: 'warn', files: /\.[jt]sx$/, re: /<img\b(?![^>]*\balt=)[^>]*>/, why: 'an image without alt: describe it, or alt="" when decorative' },
  { id: 'focused-test', sev: 'blocker', files: TEST, re: /\b(?:it|test|describe)\.only\(|\bfit\(|\bfdescribe\(/, why: 'a focused test skips the rest of the suite in CI' },
  { id: 'skipped-test', sev: 'warn', files: TEST, re: /\b(?:it|test|describe)\.skip\(|\bxit\(/, why: 'a skipped test hides a failure: fix it or delete it with a reason' },
  { id: 'debug-leftover', sev: 'warn', files: CODE, re: /\bdebugger\b|console\.log\(/, why: 'debug output left in the change' },
  { id: 'token-in-storage', sev: 'blocker', files: CODE, re: /(?:local|session)Storage\.setItem\(\s*['"`][^'"`]*(?:token|jwt|secret|password)/i, why: 'tokens in web storage are readable by any injected script: use HttpOnly cookies or memory' },
  { id: 'secret-env', sev: 'blocker', files: /(^|\/)\.env(\.[\w-]+)?$|\.[jt]sx?$/, re: /\bVITE_[A-Z0-9_]*(?:SECRET|PRIVATE|PASSWORD|API_KEY|TOKEN)\b/, why: 'VITE_ variables ship to every browser: secrets belong on the server' },
  { id: 'todo-without-ticket', sev: 'nit', files: CODE, re: /\b(?:TODO|FIXME)\b(?![^\n]*(?:#\d+|[A-Z]{2,}-\d+|https?:\/\/))/, why: 'a TODO without a ticket is rarely done: link an issue' },
]

// Effect rules read a whole effect, which often spans lines, so they run per file on the added lines (see scanEffects).
const ASYNC_EFFECT = 'an async effect returns a promise, not a cleanup: define and call an inner async function with an abort check'
const FETCH_IN_EFFECT = 'fetching in an effect needs cancellation and race handling: abort it in the cleanup, or use the query cache or a loader'
// Cancelled: the effect makes an AbortController, passes its signal on, and aborts it in the cleanup it returns.
const cancelled = (effect) => /\bnew\s+AbortController\s*\(/.test(effect) && /\bsignal\b/.test(effect) &&
  /\breturn\s*(?:\(\s*\)\s*=>|function(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*\))[\s\S]*\.abort\s*\(/.test(effect)

const findings = []
const added = new Map()          // file -> added line count
const addedText = new Map()      // file -> [{ line, text }] for the effect rules
const deps = []
let file = null, line = 0
for (const raw of diff.split('\n')) {
  if (raw.startsWith('+++ ')) { file = raw.slice(4).replace(/^b\//, ''); if (file === '/dev/null') file = null; continue }
  if (raw.startsWith('--- ')) continue
  const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
  if (hunk) { line = Number(hunk[1]); continue }
  if (!file) continue
  if (raw.startsWith('+')) {
    const text = raw.slice(1)
    added.set(file, (added.get(file) ?? 0) + 1)
    if (CODE.test(file)) { if (!addedText.has(file)) addedText.set(file, []); addedText.get(file).push({ line, text }) }
    if (/(^|\/)package\.json$/.test(file)) {
      // With --unified=0 the "dependencies" key is often not in the diff, so recognise entries by their version range.
      const dep = text.match(/^\s*"(@?[\w./-]+)"\s*:\s*"((?:[~^<>=*]|\d|workspace:|npm:|github:|git\+|https?:|file:|latest|next)[^"]*)"/)
      if (dep && !['version', 'packageManager'].includes(dep[1])) deps.push({ file, name: dep[1], range: dep[2] })
    }
    for (const r of RULES) {
      if (!r.files.test(file) || !r.re.test(text)) continue
      if (r.id === 'any-type' && /\/\/.*any|\bany\s+(of|other|more)\b/.test(text)) continue
      findings.push({ rule: r.id, severity: r.sev, file, line, why: r.why })
    }
    line++
  } else if (!raw.startsWith('-')) line++
}
// Index just past the bracket that closes the one at text[i], skipping strings and comments; text.length if unclosed.
function closeOf(text, i) {
  const open = text[i], close = { '(': ')', '{': '}' }[open]
  let depth = 0
  for (let j = i; j < text.length; j++) {
    const c = text[j]
    if (c === '/' && text[j + 1] === '/') { j = text.indexOf('\n', j); if (j < 0) return text.length; continue }
    if (c === '/' && text[j + 1] === '*') { j = text.indexOf('*/', j + 2); if (j < 0) return text.length; j++; continue }
    if (c === '"' || c === "'" || c === '`') { for (j++; j < text.length && text[j] !== c; j++) if (text[j] === '\\') j++; continue }
    if (c === open) depth++
    else if (c === close && --depth === 0) return j + 1
  }
  return text.length
}

// The body of a function defined as `function name(`, `const name = (async) (...) =>` or `const name = useCallback(...`,
// or '' when none is found.
function bodyOf(text, rawName) {
  const name = rawName.replace(/\$/g, '\\$')
  const def = new RegExp(`\\bfunction\\s+${name}\\s*\\(|\\b(?:const|let|var)\\s+${name}\\s*=\\s*(?:useCallback\\s*\\(\\s*)?(?:async\\s*)?(?:function\\s*\\(|\\(|\\w+\\s*=>)`).exec(text)
  if (!def) return ''
  let i = def.index + def[0].length - 1
  if (text[i] === '(') i = closeOf(text, i)
  const rest = text.slice(i)
  const brace = rest.match(/^\s*(?:=>\s*)?\{/) ?? rest.match(/^[^\n]*?=>\s*\{/)
  if (brace) { const start = i + brace[0].length - 1; return text.slice(start, closeOf(text, start)) }
  return rest.split('\n')[0]                       // an arrow with an expression body
}

const EFFECT = /\b(?:React\.)?use(?:Layout)?Effect\s*\(/g
const FETCHES = /\bfetch\s*\(/
function scanEffects(file, rows) {
  const text = rows.map((r) => r.text).join('\n')
  const lineAt = (i) => rows[text.slice(0, i).split('\n').length - 1].line
  for (const m of text.matchAll(EFFECT)) {
    const open = m.index + m[0].length - 1
    const effect = text.slice(open + 1, closeOf(text, open) - 1)
    if (/^\s*async\b/.test(effect)) findings.push({ rule: 'async-effect', severity: 'blocker', file, line: lineAt(m.index), why: ASYNC_EFFECT })
    // fetch( in the effect itself, or in a function of this file the effect calls (useEffect(() => { void load() }))
    const called = [...effect.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((c) => c[1]).filter((n) => !/^(?:if|for|while|switch|return|function|fetch|catch)$/.test(n))
    if ((FETCHES.test(effect) || called.some((n) => FETCHES.test(bodyOf(text, n)))) && !cancelled(effect)) {
      findings.push({ rule: 'fetch-in-effect', severity: 'warn', file, line: lineAt(m.index), why: FETCH_IN_EFFECT })
    }
  }
}
for (const [f, rows] of addedText) scanEffects(f, rows)
for (const d of deps) findings.push({ rule: 'new-dependency', severity: 'warn', file: d.file, line: 0, why: `adds or changes ${d.name}@${d.range}: check size, licence, maintenance and whether it is needed` })
for (const [f, n] of added) if (n > 400 && CODE.test(f)) findings.push({ rule: 'large-change', severity: 'nit', file: f, line: 0, why: `${n} added lines in one file: consider splitting the change or the module` })

const order = { blocker: 0, warn: 1, nit: 2 }
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line)
const failing = findings.filter((f) => order[f.severity] <= (order[failOn] ?? 0))
if (json) {
  console.log(JSON.stringify({ base: diffFile ? null : base, files: added.size, findings }, null, 2))
} else {
  console.log(`Scanned added lines in ${added.size} file(s)${diffFile ? '' : ` against ${base}`}.`)
  for (const sev of ['blocker', 'warn', 'nit']) {
    const list = findings.filter((f) => f.severity === sev)
    if (!list.length) continue
    console.log(`\n${sev.toUpperCase()} (${list.length})`)
    for (const f of list) console.log(`  ${f.file}${f.line ? `:${f.line}` : ''}  [${f.rule}] ${f.why}`)
  }
  console.log(findings.length ? `\n${findings.length} finding(s); these are prompts for a reviewer, not proof of a bug.` : '\nNo findings in the added lines.')
}
process.exit(failing.length ? 1 : 0)
