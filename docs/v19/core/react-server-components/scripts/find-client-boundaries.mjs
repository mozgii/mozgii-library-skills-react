#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Lists every 'use client' and 'use server' module under a folder and flags boundary mistakes:
// a directive that is not the first statement, a client module importing server-only code (directly, or through a
// local module it imports, one level down), and a 'use server' file exporting something that is not an async function
// (`export async function f` and `export const f = async ...`, arrow or function expression, both pass).
// Local imports are relative paths, and '@/' or '~/' read as the scanned folder; type-only imports are skipped (erased).
// Usage: node find-client-boundaries.mjs [dir=src] [--json]
// Exit code: 0 when clean, 1 when a problem was found, 2 on a usage error.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('Usage: node find-client-boundaries.mjs [dir=src] [--json]')
  process.exit(0)
}
const json = argv.includes('--json')
const root = argv.find((a) => !a.startsWith('--')) ?? 'src'
try { statSync(root) } catch { console.error(`No such folder: ${root}`); process.exit(2) }

const SKIP = new Set(['node_modules', '.next', 'dist', 'build', '.git', 'coverage', '.react-router'])
const EXT = /\.(m?[jt]sx?|cjs)$/
const SERVER_IMPORTS = [/^server-only$/, /^node:/, /^(fs|path|child_process|crypto|os|net|tls|worker_threads)(\/|$)/, /^(pg|postgres|mysql2|@prisma\/client|drizzle-orm\/.+-core|mongodb|redis|ioredis|bcrypt|argon2)(\/|$)/]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) walk(path, out)
    else if (EXT.test(name) && !/\.(test|spec|stories)\./.test(name)) out.push(path)
  }
  return out
}

// Static imports and re-exports of a module, without type-only ones (TypeScript erases them).
function importsOf(src) {
  return [...src.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?from\s+)?['"]([^'"]+)['"]/gm)].filter((m) => !m[1]).map((m) => m[2])
}

// The file a local import points at, or null for a package or a file that is not there.
// './db.js' may name './db.ts' (TypeScript with ESM paths), so both are tried.
const TRY = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.cjs', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']
function resolveLocal(spec, fromFile) {
  const base = spec.startsWith('.') ? resolve(dirname(fromFile), spec) : /^[@~]\//.test(spec) ? resolve(root, spec.slice(2)) : null
  if (!base) return null
  const stems = [base, ...(/\.m?jsx?$/.test(base) ? [base.replace(/\.m?jsx?$/, '')] : [])]
  for (const stem of stems) for (const ext of TRY) {
    try { if (statSync(stem + ext).isFile()) return stem + ext } catch { /* try the next candidate */ }
  }
  return null
}

// Strip leading comments and blank lines, then read the first statement.
function firstStatement(src) {
  const s = src.replace(/^﻿/, '').replace(/^(\s+|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '')
  const m = s.match(/^(['"])(use client|use server)\1\s*;?/)
  return m ? m[2] : null
}

const files = walk(root)
const report = []
let problems = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const rel = relative(process.cwd(), file)
  const directive = firstStatement(src)
  const misplaced = !directive && /^\s*(['"])use (client|server)\1/m.test(src.split('\n').slice(0, 40).join('\n'))
  const imports = importsOf(src)
  const issues = []
  if (misplaced) issues.push('directive is not the first statement, so it is ignored')
  if (directive === 'use client') {
    for (const spec of imports) {
      if (SERVER_IMPORTS.some((re) => re.test(spec))) { issues.push(`client module imports server code: ${spec}`); continue }
      const local = resolveLocal(spec, file)
      if (!local) continue
      const localSrc = readFileSync(local, 'utf8')
      if (firstStatement(localSrc) === 'use server') continue      // a client gets references to Server Functions, not their code
      const inner = importsOf(localSrc).filter((s) => SERVER_IMPORTS.some((re) => re.test(s)))
      if (inner.length) issues.push(`client module imports ${spec}, which imports server code: ${inner.join(', ')}`)
    }
  }
  if (directive === 'use server') {
    // Allowed: `export async function f`, `export default async`, and `export const f = async (...) =>` or `= async function`.
    const allowed = /async\s+function|type\s|interface\s|default\s+async\b|const\s+\w+\s*(?::[^;=\n]*(?:=>[^;=\n]*)*)?=\s*async\b/.source
    for (const m of src.matchAll(new RegExp(`^export\\s+(?!${allowed})(const|let|var|function|class|default)\\s*(\\w*)`, 'gm'))) {
      issues.push(`'use server' file exports a non-async value: ${m[2] || m[1]} (only async functions may be exported)`)
    }
  }
  if (directive || issues.length) {
    report.push({ file: rel, directive: directive ?? 'none', lines: src.split('\n').length, imports: imports.length, issues })
    problems += issues.length
  }
}

if (json) {
  console.log(JSON.stringify({ root, scanned: files.length, modules: report, problems }, null, 2))
} else {
  const client = report.filter((r) => r.directive === 'use client')
  const server = report.filter((r) => r.directive === 'use server')
  console.log(`Scanned ${files.length} files under ${root}: ${client.length} client boundaries, ${server.length} server function modules.`)
  for (const r of report) {
    console.log(`${r.directive.padEnd(10)} ${r.file} (${r.lines} lines, ${r.imports} imports)`)
    for (const i of r.issues) console.log(`  ! ${i}`)
  }
  const big = client.filter((r) => r.lines > 300)
  if (big.length) console.log(`\nLarge client modules (over 300 lines), check whether the boundary can move lower:\n${big.map((r) => '  ' + r.file).join('\n')}`)
  console.log(problems ? `\n${problems} problem(s) found.` : '\nNo boundary problems found.')
}
process.exit(problems ? 1 : 0)
