#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Scans Playwright test files for patterns that make end-to-end tests flaky or let them pass when the feature is
// broken: fixed sleeps, networkidle waits, non-retrying assertions, web-first assertions without await, ElementHandle
// APIs, brittle CSS and XPath selectors, force clicks, real time and randomness, focused or serial tests.
// Usage: node find-flaky-patterns.mjs [dir=e2e] [--json] [--fail-on error|warn]
// Exit code: 0 when nothing at the --fail-on level (default error), 1 when found, 2 on a usage error.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node find-flaky-patterns.mjs [dir=e2e] [--json] [--fail-on error|warn]')
  process.exit(0)
}
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const dir = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--fail-on') ?? 'e2e'
const failOn = opt('--fail-on', 'error')
const json = argv.includes('--json')
if (!existsSync(dir)) { console.error(`No such folder: ${dir}`); process.exit(2) }

const RULES = [
  { id: 'fixed-sleep', sev: 'error', re: /\.waitForTimeout\(|setTimeout\(\s*(?:r|resolve)\b|new Promise\(\s*\(?\s*(?:r|resolve)\s*\)?\s*=>\s*setTimeout/, fix: 'wait for a visible result with await expect(locator)…' },
  { id: 'networkidle', sev: 'warn', re: /networkidle/, fix: 'networkidle never settles with polling or sockets; wait for UI state instead' },
  { id: 'non-retrying-assertion', sev: 'error', re: /expect\(\s*await\s+.*?\.(?:isVisible|isHidden|isEnabled|isDisabled|isChecked|textContent|innerText|inputValue|count|getAttribute)\(/, fix: 'use a web-first matcher: await expect(locator).toBeVisible() / toHaveText() / toHaveCount()' },
  { id: 'unawaited-assertion', sev: 'error', re: /^(?!.*\bawait\b)(?!.*\breturn\b)\s*expect(?:\.soft)?\(\s*(?:page|locator|this\.page|[a-z]\w*)\b.*\)\s*\.(?:not\.)?to(?:BeVisible|BeHidden|HaveText|ContainText|HaveURL|HaveTitle|HaveCount|BeEnabled|BeDisabled|BeChecked|BeFocused|HaveValue|HaveAttribute|HaveScreenshot|MatchAriaSnapshot)\(/, fix: 'web-first assertions return promises: add await' },
  { id: 'element-handle', sev: 'warn', re: /\bpage\.\$\$?\(|\.waitForSelector\(|\.elementHandle\(/, fix: 'use locators; element handles go stale after re-renders' },
  { id: 'xpath-selector', sev: 'warn', re: /locator\(\s*['"`](?:xpath=|\/\/)/, fix: 'prefer getByRole, getByLabel, getByText or getByTestId' },
  { id: 'brittle-css', sev: 'warn', re: /locator\(\s*['"`][^'"`]*(?::nth-child|:nth-of-type|>\s*\w+\s*>|\.[a-z][\w-]*__[\w-]+|\.css-[a-z0-9]+)/i, fix: 'structure and generated class names change; locate by role or test id' },
  { id: 'force-action', sev: 'warn', re: /force:\s*true/, fix: 'force skips actionability checks and hides real overlap bugs; wait for the element to be ready' },
  { id: 'nth-index', sev: 'warn', re: /\.(?:first|last)\(\)|\.nth\(\d+\)/, fix: 'position-based picks break when order changes; filter by text or role' },
  { id: 'real-time', sev: 'warn', re: /\bDate\.now\(\)|new Date\(\)(?!\s*\.toISOString\(\)\s*\+\s*['"`])/, fix: 'install page.clock or pass fixed dates so runs are repeatable' },
  { id: 'randomness', sev: 'warn', re: /Math\.random\(\)/, fix: 'random data without a seed makes failures unreproducible; use a seeded generator or crypto.randomUUID() only for uniqueness' },
  { id: 'focused-test', sev: 'error', re: /\b(?:test|it|describe)\.only\(/, fix: 'remove .only; set forbidOnly in CI' },
  { id: 'serial-mode', sev: 'warn', re: /describe\.serial\(|mode:\s*['"]serial['"]/, fix: 'serial tests share state and fail together; make each test set up its own data' },
  { id: 'hard-coded-origin', sev: 'warn', re: /goto\(\s*['"`]https?:\/\/(?:localhost|127\.0\.0\.1)/, fix: 'use baseURL and relative paths' },
  { id: 'zero-timeout', sev: 'warn', re: /timeout:\s*0\b/, fix: 'an unlimited timeout hangs the run on failure' },
]

const files = []
const walk = (d) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n.startsWith('.')) continue; const p = join(d, n); statSync(p).isDirectory() ? walk(p) : /\.(spec|test|setup)\.[cm]?[jt]sx?$|fixtures?\.[jt]s$/.test(n) && files.push(p) } }
statSync(dir).isDirectory() ? walk(dir) : files.push(dir)

const findings = []
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  let inBlock = false
  lines.forEach((text, i) => {
    if (/^\s*\/\*/.test(text)) inBlock = true
    const comment = inBlock || /^\s*\/\//.test(text)
    if (/\*\//.test(text)) inBlock = false
    if (comment) return
    for (const r of RULES) if (r.re.test(text)) findings.push({ file: relative(process.cwd(), f).startsWith('..') ? f : relative(process.cwd(), f), line: i + 1, rule: r.id, severity: r.sev, fix: r.fix, code: text.trim().slice(0, 120) })
  })
}

const failing = findings.filter((f) => failOn === 'warn' || f.severity === 'error')
if (json) console.log(JSON.stringify({ dir, files: files.length, findings }, null, 2))
else {
  console.log(`Scanned ${files.length} test file(s) in ${dir}.`)
  for (const sev of ['error', 'warn']) {
    const list = findings.filter((f) => f.severity === sev)
    if (!list.length) continue
    console.log(`\n${sev === 'error' ? 'ERRORS' : 'WARNINGS'} (${list.length})`)
    for (const f of list) console.log(`  ${f.file}:${f.line}  [${f.rule}] ${f.fix}\n      ${f.code}`)
  }
  console.log(findings.length ? `\n${findings.length} finding(s).` : '\nNo flaky patterns found.')
}
process.exit(failing.length ? 1 : 0)
