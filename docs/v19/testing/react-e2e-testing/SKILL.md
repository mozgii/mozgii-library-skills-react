---
name: react-e2e-testing
description: Writes end-to-end tests for React apps with Playwright 1.64 that catch real regressions and do not flake - user flows written with role-based locators and web-first assertions, a playwright.config for local and CI runs, custom fixtures and page objects, signing in once with a setup project and storageState, mocking the network with page.route, HAR files and routeWebSocket, controlling time with page.clock, visual regression with toHaveScreenshot and masks, aria snapshots, accessibility scans with axe, test locks for shared resources, sharding, traces, and a field guide to fixing flaky tests. Use when adding Playwright to a React app, writing a login, checkout or form flow test, tests pass locally and fail in CI, tests are slow or flaky, mocking an API in e2e tests, or adding screenshot tests.
metadata:
  tags:
  - react
  - e2e
  - playwright
  - testing
  - visual-regression
  - flaky-tests
  - ci
---

# React end-to-end testing with Playwright

End-to-end tests drive a real browser through the built app the way a user does: open a page, fill a form, see the result. They catch what unit tests cannot (routing, real CSS, real network handling, integration between features), at the cost of speed. Keep them for critical user journeys, write them against what users see, and make them deterministic so a red build always means a real problem. Component and unit tests are the `react-testing` skill.

## Step 0: read the installed Playwright version and scan the tests

Playwright adds APIs in most minor releases, so read the version, then look for known flakiness patterns:

```bash
node -p "['@playwright/test','@axe-core/playwright','react','vite'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
npx playwright --version
node <this-skill>/scripts/find-flaky-patterns.mjs e2e         # sleeps, non-retrying assertions, brittle selectors, missing awaits
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

Written against `@playwright/test` 1.64.1 and `@axe-core/playwright` 4.14.0. Recent additions used below: `lock` on tests and describes, `locator.visible()` and `frameLocator()` without a selector (1.63); an `AbortSignal` option on actions and assertions, and a stories-based component testing model (1.62); `page.localStorage` and `page.sessionStorage` and WebAuthn passkey support (1.61). The `_react` and `_vue` selector engines were removed in 1.58. Upgrade browsers with the package: `npx playwright install --with-deps`.

## Decision table: which test layer for which risk

| Risk | Test with | Why the others lose |
|---|---|---|
| Pure logic (totals, parsing, reducers) | unit tests (Vitest) | e2e is 100 times slower for the same assertion |
| One component's states and interactions | component tests (Vitest Browser Mode or Testing Library) | e2e needs routing and data setup to reach the state |
| A critical journey across pages (sign up, checkout, publish) | Playwright e2e against a production build | lower layers miss routing, CSS, focus and real requests |
| Visual layout and theming | Playwright `toHaveScreenshot` on stable pages, or Storybook visual tests | assertions on DOM cannot see overlap or clipping |
| Backend integration (real API, real database) | a small set of e2e tests against a staging stack | mocks cannot catch contract drift |

## Decision table: mock the network or hit a real backend

| Approach | Pick when | Loses when |
|---|---|---|
| `page.route` mocks per test | testing UI states (errors, empty, slow) deterministically | it hides API contract changes |
| `routeFromHAR` recordings | many endpoints with realistic data, recorded once | recordings go stale; re-record on API changes |
| A real backend seeded per test run | testing the integration end to end | slower, needs data isolation per worker |

Most suites mix them: mocked states for UI behaviour, and a few real-backend smoke tests.

## Playwright config for local and CI runs

A config that serves the production build (building it first on your machine, and using the `dist` artifact from an earlier job in CI), runs browsers in parallel, retries only in CI, and records traces when a test fails:

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'
const CI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,                                   // a stray test.only fails CI
  retries: CI ? 2 : 0,
  failOnFlakyTests: CI,                             // a test that passed only on retry fails the run
  workers: CI ? 4 : undefined,
  reporter: CI ? [['blob'], ['github']] : [['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry', screenshot: 'only-on-failure', locale: 'en-US', timezoneId: 'UTC' },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/user.json' }, dependencies: ['setup'] },
    { name: 'webkit', use: { ...devices['Desktop Safari'], storageState: 'e2e/.auth/user.json' }, dependencies: ['setup'] },
    { name: 'mobile', use: { ...devices['Pixel 7'], storageState: 'e2e/.auth/user.json' }, dependencies: ['setup'] },
  ],
  webServer: {
    command: `${CI ? '' : 'npm run build && '}npm run preview -- --port 4173 --strictPort`,   // CI serves the dist it downloaded
    url: 'http://localhost:4173', reuseExistingServer: !CI, timeout: 120_000,
  },
})
```

CI must have a `dist` folder before Playwright starts, or `vite preview` has nothing to serve: build in an earlier job and download the artifact, as the workflow in the reference does. Test the production build (`vite preview`), not the dev server: dev mode is slower, renders twice in Strict Mode, and differs in chunking. Fix `locale` and `timezoneId` so dates and numbers render the same everywhere. Add `e2e/.auth/` to `.gitignore`.

## Locators and web-first assertions

Locate elements the way users find them, and assert with `expect(locator)` matchers, which retry until they pass or time out:

| Prefer | Over |
|---|---|
| `page.getByRole('button', { name: 'Save' })` | `page.locator('.btn-primary')` |
| `page.getByLabel('Email')` | `page.locator('#email')` |
| `page.getByText('Invoice sent')` | `page.locator('div > span:nth-child(2)')` |
| `page.getByTestId('chart')` for things without a role or text | XPath |
| `await expect(locator).toBeVisible()` | `expect(await locator.isVisible()).toBe(true)` (checks once, no retry) |
| `await expect(page).toHaveURL(/\/invoices\/\d+/)` | reading `page.url()` right after a click |

Chain and filter instead of indexing: `page.getByRole('row').filter({ hasText: 'INV-042' }).getByRole('button', { name: 'Send' })`. A locator that cannot find an element by role often reveals an accessibility bug.

## Sign in once with a setup project and storageState

Signing in through the UI in every test is slow and adds a failure point. A setup project signs in once, saves cookies and storage, and other projects start authenticated:

```ts
// e2e/auth.setup.ts
import { test as setup, expect } from '@playwright/test'
setup('sign in', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill(process.env.E2E_USER!)
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await page.context().storageState({ path: 'e2e/.auth/user.json', indexedDB: true })   // indexedDB for apps that keep auth there
})
```

Use one account per worker (`test.info().parallelIndex`) when tests change account data, so parallel workers do not interfere. Keep credentials in CI secrets, never in the repository.

## Mock the network with page.route

`page.route` intercepts requests matching a URL pattern and lets the test fulfil, modify or abort them, which makes error, empty and slow states testable:

```ts
await page.route('**/api/invoices?*', (route) => route.fulfill({ json: [] }))                                  // empty state
await page.route('**/api/invoices/42/send', (route) => route.fulfill({ status: 500, json: { error: 'boom' } }))  // server error
await page.route('**/api/search*', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue() })  // slow
```

Register routes before the action that triggers the request. For WebSockets, `page.routeWebSocket('/ws', (ws) => { … })` plays the server. `routeFromHAR('e2e/hars/invoices.har', { url: '**/api/**', update: !!process.env.UPDATE_HAR })` replays recorded traffic.

## Control time with page.clock

Timers, debounces, session expiry and "2 minutes ago" labels make tests slow or flaky. Install a fake clock before the page loads, then move it:

```ts
await page.clock.install({ time: new Date('2026-10-01T09:00:00Z') })
await page.goto('/inbox')
await page.clock.fastForward('05:00')          // five minutes later: polling and expiry fire now
await expect(page.getByText('Session expires in 1 minute')).toBeVisible()
```

`page.clock.setFixedTime()` freezes `Date.now()` for pages that only display dates.

## Visual regression with toHaveScreenshot

`await expect(page).toHaveScreenshot()` compares against a stored baseline and fails on pixel differences. Make screenshots stable:

- Generate and compare baselines in one environment (the official Playwright Docker image in CI); fonts and antialiasing differ across operating systems, and baselines are stored per platform.
- Mask dynamic regions (`mask: [page.getByTestId('clock'), page.locator('img.avatar')]`) and use the fake clock for dates.
- Screenshots disable CSS animations by default; wait for fonts and images (`await page.evaluate(() => document.fonts.ready)`).
- Allow a small tolerance (`maxDiffPixelRatio: 0.01`) only after checking that real changes still fail.
- Update baselines deliberately: `npx playwright test --update-snapshots`, and review the changed images in the PR.

For structure rather than pixels, `await expect(page.getByRole('main')).toMatchAriaSnapshot()` compares the accessibility tree, which is stable across fonts and platforms.

## Worked example: an invoice flow with fixtures, mocks and accessibility checks

A fixture that provides a page object and mocks, and tests that cover success, server error, empty state, keyboard use and an axe scan:

```ts
// e2e/fixtures.ts
import { test as base, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

type Invoice = { id: string; number: string; customer: string; total: number; status: 'draft' | 'sent' }

class InvoicesPage {
  constructor(readonly page: Page) {}
  goto() { return this.page.goto('/invoices') }
  row(number: string) { return this.page.getByRole('row').filter({ hasText: number }) }
  async send(number: string) {
    await this.row(number).getByRole('button', { name: 'Send' }).click()
    await this.page.getByRole('alertdialog', { name: /send invoice/i }).getByRole('button', { name: 'Send invoice' }).click()
  }
  async mockList(invoices: Invoice[]) { await this.page.route('**/api/invoices*', (r) => r.request().method() === 'GET' ? r.fulfill({ json: invoices }) : r.fallback()) }
}

export const test = base.extend<{ invoices: InvoicesPage; axe: () => Promise<void> }>({
  invoices: async ({ page }, use) => { await use(new InvoicesPage(page)) },
  axe: async ({ page }, use) => {
    await use(async () => {
      const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze()
      expect(violations.map((v) => `${v.id}: ${v.nodes.length} node(s)`)).toEqual([])
    })
  },
})
export { expect }
```

```ts
// e2e/invoices.spec.ts
import { test, expect } from './fixtures'

const draft = { id: '42', number: 'INV-042', customer: 'Acme', total: 1200, status: 'draft' as const }

test.describe('sending an invoice', () => {
  test('sends a draft and shows it as sent', async ({ page, invoices }) => {
    await invoices.mockList([draft])
    await page.route('**/api/invoices/42/send', (r) => r.fulfill({ json: { ...draft, status: 'sent' } }))
    await invoices.goto()
    await invoices.send('INV-042')
    await expect(page.getByRole('status')).toContainText('Invoice INV-042 sent')
    await expect(invoices.row('INV-042')).toContainText('Sent')
  })

  test('keeps the invoice and explains a server error', async ({ page, invoices }) => {
    await invoices.mockList([draft])
    await page.route('**/api/invoices/42/send', (r) => r.fulfill({ status: 500, json: { error: 'unavailable' } }))
    await invoices.goto()
    await invoices.send('INV-042')
    await expect(page.getByRole('alert')).toContainText('could not be sent')
    await expect(invoices.row('INV-042')).toContainText('Draft')
  })

  test('shows the empty state', async ({ invoices, page }) => {
    await invoices.mockList([])
    await invoices.goto()
    await expect(page.getByText('No invoices yet')).toBeVisible()
  })

  test('works with the keyboard and passes axe', async ({ page, invoices, axe }) => {
    await invoices.mockList([draft])
    await invoices.goto()
    await invoices.row('INV-042').getByRole('button', { name: 'Send' }).focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('alertdialog', { name: /send invoice/i })
    await expect(dialog).toBeVisible()
    await axe()                                                       // scan with the dialog open
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(invoices.row('INV-042').getByRole('button', { name: 'Send' })).toBeFocused()
  })
})
```

Each test sets up its own data through mocks, so tests run in any order and in parallel. More on fixtures, sharding, CI and debugging: [playwright-ci-and-debugging.md](references/playwright-ci-and-debugging.md).

## Fixing flaky tests

A flaky test passes and fails without code changes. Find the cause instead of adding retries:

| Symptom | Likely cause | Fix |
|---|---|---|
| Fails on CI only, passes locally | slower machine; a fixed sleep or a non-retrying check | web-first assertions; remove `waitForTimeout` |
| "strict mode violation: resolved to 2 elements" | the locator matches more than one element | narrow by role, name or `filter`; `locator.visible()` for hidden duplicates |
| Clicks land on the wrong element or nothing | the element moved (animation, late layout) | assert the final state first (`toBeVisible`, `toBeEnabled`); disable animations in test builds |
| Fails when run with others, passes alone | shared data or account between parallel tests | per-test data, per-worker accounts, or `lock: 'name'` for a truly shared resource |
| Fails around midnight or month end | real time | `page.clock` and a fixed `timezoneId` |
| Screenshot diffs of a few pixels | fonts or rendering differ | one Docker image for baselines; mask dynamic parts |
| Timeouts on the first test only | the web server or the setup project is slow | a `webServer.timeout`; warm-up in the setup project |

Open the trace of a failed run (`npx playwright show-trace trace.zip`): it shows each action, the DOM before and after, network calls and console errors. `npx playwright test --repeat-each=20 --workers=4 path/to.spec.ts` reproduces a flake locally.

## Verify the e2e suite

```bash
npx playwright test                                   # all projects
npx playwright test --repeat-each=10 --fail-on-flaky-tests e2e/invoices.spec.ts   # stability of new tests
node <this-skill>/scripts/find-flaky-patterns.mjs e2e # exit 1 on patterns that cause flakes
npx playwright show-report
```

A new test is done when it fails for the right reason (break the feature on purpose once), passes ten times in a row in parallel, and runs in under about ten seconds.

## Gotchas and anti-patterns in Playwright tests

Each gotcha names the symptom, its cause and the fix.

1. **The test passes but the feature is broken.** Cause: `expect(await locator.isVisible())` or a missing `await` on a web-first assertion. Fix: `await expect(locator).toBeVisible()`; turn on the `@typescript-eslint/no-floating-promises` rule for e2e files.
2. **Random timeouts.** Cause: `page.waitForTimeout(2000)` or `waitForLoadState('networkidle')` with polling or WebSockets. Fix: wait for a visible result.
3. **Every test signs in and the suite takes 20 minutes.** Cause: UI login per test. Fix: a setup project with `storageState`.
4. **Tests break on every CSS refactor.** Cause: class and structure selectors. Fix: role, label and text locators; test ids for the rest.
5. **Tests pass alone, fail together.** Cause: shared server data. Fix: unique data per test (`crypto.randomUUID()` in names), per-worker accounts, or `lock`.
6. **Screenshots fail on every machine but CI.** Cause: per-platform rendering. Fix: generate baselines in the Playwright Docker image.
7. **A stray `test.only` silently skipped the suite.** Cause: no `forbidOnly`. Fix: `forbidOnly: !!process.env.CI`.
8. **The mock never applies.** Cause: the route was registered after `goto`, or the pattern misses query strings. Fix: route before navigating; use `**/api/items*`.

## Pre-merge checklist for e2e tests

1. The test covers a user journey that matters and fails when that journey breaks.
2. Locators use roles, labels and text; assertions are web-first and awaited.
3. No sleeps, no `networkidle`, no `force: true` without a comment.
4. Each test creates or mocks its own data; parallel runs do not interfere.
5. Authentication comes from a setup project; secrets come from the environment.
6. Time, locale and time zone are fixed; screenshots mask dynamic content.
7. The test passed `--repeat-each=10`; `find-flaky-patterns.mjs` is clean.

See also: react-testing, react-accessibility, react-ci-quality-gates, react-auth-flows.
