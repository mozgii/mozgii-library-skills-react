#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Prints the installed versions of React and its common tooling, read from node_modules.
// Run with the project root as the working directory: node <skill>/scripts/installed-versions.mjs
// Usage: node installed-versions.mjs   (no arguments; prints the Node version, then one line per installed package)
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: node installed-versions.mjs   (run from the project root; prints the Node version, then one line per\n' +
    'installed package with its version; packages not installed are left out; warns when Node is older than 22.22)')
  process.exit(0)
}

const require = createRequire(join(process.cwd(), 'package.json'))

const packages = [
  'react', 'react-dom', '@types/react', 'typescript',
  'vite', '@vitejs/plugin-react', '@vitejs/plugin-react-swc', 'babel-plugin-react-compiler', '@rolldown/plugin-babel',
  'react-router', '@tanstack/react-router', '@tanstack/react-query', '@tanstack/react-virtual',
  'zustand', '@reduxjs/toolkit', 'react-redux', 'jotai',
  'react-hook-form', '@hookform/resolvers', '@tanstack/react-form', 'zod', 'valibot',
  'react-error-boundary', 'motion', 'tailwindcss',
  'vitest', '@vitest/browser-playwright', 'vitest-browser-react', '@testing-library/react',
  '@testing-library/user-event', '@testing-library/jest-dom', 'msw', '@playwright/test',
  'oxlint', 'eslint', 'eslint-plugin-react-hooks', 'typescript-eslint',
]

function versionOf(name) {
  const candidates = [join(process.cwd(), 'node_modules', name, 'package.json')]
  try { candidates.push(require.resolve(`${name}/package.json`)) } catch { /* exports may hide package.json */ }
  for (const file of candidates) {
    try { return JSON.parse(readFileSync(file, 'utf8')).version } catch { /* try the next one */ }
  }
  return null
}

const width = Math.max(...packages.map((p) => p.length))
console.log(`${'node'.padEnd(width)}  ${process.versions.node}`)
for (const name of packages) {
  const version = versionOf(name)
  if (version) console.log(`${name.padEnd(width)}  ${version}`)
}

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 22)) console.log('\nNode is older than 22.22: React Router 8.5.1 needs 22.22 or newer, Vitest 5 and MSW 3 need 22.12 or newer.')
