---
title: Playwright in CI, fixtures and debugging
author: MOZGII, Inc.
lang: en
---

# Playwright in CI, fixtures and debugging

How to run a Playwright suite fast and reliably in CI, seed data through fixtures, and debug failures. Sources: the Playwright 1.64 documentation (test configuration, fixtures, sharding, CI, trace viewer, test parallelism and locks) and its release notes.

## GitHub Actions with sharding and a merged report

Split the suite across machines with `--shard`, build once and hand `dist` to every shard, upload each shard's blob report, and merge them into one HTML report:

```yaml
# .github/workflows/e2e.yml
name: e2e
on: [pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v7
        with: { name: dist, path: dist, retention-days: 3 }
  e2e:
    needs: build
    runs-on: ubuntu-latest
    container: mcr.microsoft.com/playwright:v1.64.1-noble     # browsers and fonts preinstalled; matches @playwright/test
    strategy: { fail-fast: false, matrix: { shard: [1/4, 2/4, 3/4, 4/4] } }
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - uses: actions/download-artifact@v8
        with: { name: dist, path: dist }
      - run: npx playwright test --shard=${{ matrix.shard }}
        env: { E2E_USER: '${{ secrets.E2E_USER }}', E2E_PASSWORD: '${{ secrets.E2E_PASSWORD }}', HOME: /root }
      - uses: actions/upload-artifact@v7
        if: ${{ !cancelled() }}
        with: { name: 'blob-${{ strategy.job-index }}', path: blob-report, retention-days: 7 }
  report:
    if: ${{ !cancelled() }}
    needs: e2e
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22 }
      - run: npm ci
      - uses: actions/download-artifact@v8
        with: { path: all-blobs, pattern: blob-*, merge-multiple: true }
      - run: npx playwright merge-reports --reporter html ./all-blobs
      - uses: actions/upload-artifact@v7
        with: { name: playwright-report, path: playwright-report, retention-days: 14 }
```

Keep the Docker image tag equal to the installed `@playwright/test` version; a mismatch fails with a "browser executable not found" error. Screenshot baselines generated in the same image match in CI.

## Run only what changed on pull requests

`npx playwright test --only-changed=origin/main` runs test files changed since the base branch and tests that import changed files. Use it for a fast first job on pull requests, and run the full suite on the main branch and before releases.

## Worker-scoped fixtures for test data

A worker-scoped fixture runs once per worker process, which suits expensive setup such as creating a test account through the API. Test-scoped fixtures build on it per test:

```ts
import { test as base, request, type APIRequestContext } from '@playwright/test'

type Account = { email: string; password: string; id: string }
export const test = base.extend<{ api: APIRequestContext }, { account: Account }>({
  account: [async ({}, use, workerInfo) => {
    const ctx = await request.newContext({ baseURL: process.env.API_URL })
    const email = `e2e+w${workerInfo.workerIndex}-${Date.now()}@example.com`
    const res = await ctx.post('/test-support/accounts', { data: { email } })
    const account = (await res.json()) as Account
    await use(account)
    await ctx.delete(`/test-support/accounts/${account.id}`)     // clean up after the worker finishes
    await ctx.dispose()
  }, { scope: 'worker' }],
  api: async ({ account }, use) => {
    const ctx = await request.newContext({ baseURL: process.env.API_URL, extraHTTPHeaders: { 'X-Test-Account': account.id } })
    await use(ctx)
    await ctx.dispose()
  },
})
```

Seed data through the API (`api.post(...)`) rather than through the UI: it is faster and keeps each test about one behaviour. Expose test-support endpoints only in test environments.

## Test locks for shared resources

Some resources cannot be isolated per test: a global feature flag, a single third-party sandbox account. Since Playwright 1.63, tests that declare the same lock never run at the same time, across files, workers and projects, while the rest of the suite stays parallel:

```ts
test('changes the global announcement banner', { lock: 'announcement-banner' }, async ({ page }) => { /* … */ })
test.describe('billing provider sandbox', { lock: 'billing-sandbox' }, () => { /* … */ })
```

Prefer real isolation; use locks for the few cases where isolation is impossible, instead of making whole files serial.

## Steps, annotations and readable reports

`test.step('Send the invoice', async () => { … })` groups actions in the report and the trace, so a failure says which step broke. Annotate known issues with `test.fixme()` or `test.fail()` and a ticket link instead of skipping silently; `test.fail()` turns red when the bug is fixed, which reminds you to remove it.

## Debugging a failing test

| Tool | Use |
|---|---|
| `npx playwright test --ui` | UI mode: watch, time-travel through actions, pick locators |
| `npx playwright test --debug` | Playwright Inspector: step through actions with the browser visible |
| `npx playwright show-trace trace.zip` | the trace from CI: DOM snapshots, network, console, per action |
| `npx playwright codegen http://localhost:4173` | record actions and get role-based locators to start a test |
| `PWDEBUG=console` | `playwright.$()` helpers in the browser console |

In a trace, look first at the action before the failure: was the page in the state the test assumed? Most flaky failures are a test that acted before the app finished a previous step.

## Global setup versus a setup project

Prefer a setup project (a project with `testMatch: /.*\.setup\.ts/` that others list in `dependencies`) over `globalSetup`: it appears in reports and traces, can use fixtures, and retries like a test. Use `globalSetup` only for work outside the browser, such as starting a database container.

## Component tests in Playwright

Playwright 1.62 moved component testing to a stories-and-galleries model: you serve a gallery page that renders stories (a component with fixed props and mocks), and the `mount('components/Name/Story')` fixture navigates to it and returns a locator for the story's root. For React teams that already use Storybook or Vitest Browser Mode, keep component tests there and use Playwright for journeys across pages.

## Keeping the suite fast

- Run browsers in parallel (`fullyParallel: true`) and shard in CI; aim for a full run under ten minutes.
- Reuse authentication through `storageState`; seed data through the API.
- Block third-party requests that tests do not need (analytics, chat widgets) with `page.route('**/*', …)` filters or a context-level route.
- Keep e2e tests for journeys; move state permutations (every validation message) to component tests.
