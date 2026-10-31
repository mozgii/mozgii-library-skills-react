#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Scans one or more pages with axe-core in a real Chromium and prints WCAG 2.2 A/AA violations.
// Needs, in the project: npm i -D @playwright/test @axe-core/playwright && npx playwright install chromium
// Usage: node <skill>/scripts/axe-check.mjs http://localhost:4173/ http://localhost:4173/settings
// Exit code: 0 when no violations, 1 when there are violations, 2 on a usage or load error.
import { createRequire } from 'node:module'
import { join } from 'node:path'

const USAGE = 'Usage: node axe-check.mjs <url> [more urls]   (serve a production build first: npm run build && npm run preview)'
if (process.argv.includes('--help') || process.argv.includes('-h')) { console.log(USAGE); process.exit(0) }

const require = createRequire(join(process.cwd(), 'package.json'))
let chromium, AxeBuilder
try {
  ;({ chromium } = require('@playwright/test'))
  AxeBuilder = require('@axe-core/playwright').default ?? require('@axe-core/playwright').AxeBuilder
} catch {
  console.error('Install the tools first: npm i -D @playwright/test @axe-core/playwright && npx playwright install chromium')
  process.exit(2)
}

const urls = process.argv.slice(2)
if (urls.length === 0) {
  console.error(USAGE)
  process.exit(2)
}

let browser
try {
  browser = await chromium.launch()
} catch (error) {                                         // usually the browser is not downloaded yet
  console.error(`Could not start Chromium: ${String(error?.message ?? error).split('\n')[0]}\nRun: npx playwright install chromium`)
  process.exit(2)
}
const page = await (await browser.newContext()).newPage()   // AxeBuilder refuses a page made by browser.newPage()
let total = 0
try {
  for (const url of urls) {
    await page.goto(url, { waitUntil: 'networkidle' })
    const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    total += violations.length
    console.log(`\n${url}: ${violations.length} violation(s)`)
    for (const v of violations) {
      console.log(`  [${v.impact ?? 'n/a'}] ${v.id}: ${v.help}`)
      for (const node of v.nodes.slice(0, 5)) console.log(`      ${node.target.join(' ')}`)
      if (v.nodes.length > 5) console.log(`      … and ${v.nodes.length - 5} more`)
      console.log(`      ${v.helpUrl}`)
    }
  }
} catch (error) {
  console.error(`Could not scan: ${error instanceof Error ? error.message : String(error)}`)
  await browser.close()
  process.exit(2)
}
await browser.close()
process.exit(total === 0 ? 0 : 1)
