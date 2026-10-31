---
name: react-testing
description: Tests React apps with Vitest 5, React Testing Library 16, user-event 14, jest-dom 7 and MSW 3 - setup in jsdom or Vitest Browser Mode with vitest-browser-react, queries by role, user interactions, async assertions, network mocking, testing hooks, forms, routes, TanStack Query and stores, and when to add Playwright end-to-end tests. Use when setting up tests in a React project, writing a component or hook test, fixing flaky or act warnings, mocking fetch, upgrading to Vitest 5 or MSW 3, or deciding what to test at which level.
metadata:
  tags:
  - react
  - testing
  - vitest
  - testing-library
  - user-event
  - msw
  - playwright
  - jsdom
---

# React testing with Vitest and Testing Library

Tests that resemble how people use the app give the most confidence: find elements by their role and name, interact the way a user does, and assert what the user sees. This skill covers Vitest 5.0, `@testing-library/react` 16.3, `@testing-library/user-event` 14.6, `@testing-library/jest-dom` 7.0, MSW 3.0 and Vitest Browser Mode with `vitest-browser-react` 2.3. All of these need Node 22 or newer.

## Step 0: read the installed test tools

Vitest 5, jest-dom 7 and MSW 3 each changed defaults or packaging in 2026. Read the versions before writing setup:

```bash
node -p "['vitest','@testing-library/react','@testing-library/dom','@testing-library/user-event','@testing-library/jest-dom','msw','jsdom','vitest-browser-react','@vitest/browser-playwright'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
node --version          # 22 or newer
```

## What to test at which level

Each level answers a different question. Most tests in a React app should be component and integration tests:

| Level | Tool | Tests | Why not another level |
|---|---|---|---|
| Unit | Vitest | pure functions: formatting, reducers, schema rules, selectors | rendering a component to test a date formatter is slower and fails for unrelated reasons |
| Component and integration | Vitest + Testing Library (+ MSW), jsdom | a component or a screen with its children, real hooks, mocked network | unit tests miss how parts fit; end-to-end tests are too slow to cover every state |
| Component in a real browser | Vitest Browser Mode | layout, focus, drag and drop, `ResizeObserver`, canvas | jsdom has no layout engine, so these pass or fail for the wrong reasons there |
| Hook | `renderHook` | a reusable hook with logic worth testing on its own | testing it through one component ties it to that component's markup |
| End to end | Playwright | critical journeys through the built app in real browsers | they are the slowest and flakiest level, so they cover journeys, not every state |

Test behaviour, not implementation: no assertions on state variables, internal method calls or class names. A refactor that keeps behaviour should keep tests green.

## Install and configure Vitest with jsdom

The jsdom setup runs tests in Node with a simulated DOM. It is fast and covers most component tests:

```bash
npm i -D vitest jsdom @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom msw @vitest/coverage-v8
```

```ts
// vitest.config.ts
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: { provider: 'v8', include: ['src/**/*.{ts,tsx}'], exclude: ['src/**/*.test.*', 'src/test/**'] },
  },
}))
```

```ts
// src/test/setup.ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server } from './server'

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => { cleanup(); server.resetHandlers() })
afterAll(() => server.close())
```

- `@testing-library/dom` is a required peer of both `@testing-library/react` 16 and jest-dom 7; install it explicitly.
- Without `globals: true`, Testing Library cannot register its automatic cleanup, so call `cleanup()` in `afterEach` as above.
- Vitest 5 no longer looks for a config file in parent folders; in a monorepo, each package needs its own config or a root config with `projects`.

## Mock the network with MSW 3

MSW intercepts requests at the network level, so components, loaders and query functions run unchanged. Define default handlers once and override them per test:

```ts
// src/test/server.ts
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('/api/invoices', () => HttpResponse.json([{ id: '1', number: '2026-001', total: 120, status: 'sent' }])),
  http.post('/api/invoices/:id/pay', ({ params }) => HttpResponse.json({ id: params.id, status: 'paid' })),
]
export const server = setupServer(...handlers)
```

```ts
server.use(http.get('/api/invoices', () => HttpResponse.json({ message: 'boom' }, { status: 500 })))   // this test only
```

MSW 3 changes from v2: ESM only; Node 22 or newer; `onUnhandledRequest` renamed to `onUnhandledFrame`; `graphql` moved to `msw/graphql`; no more patching of `setTimeout`, so with fake timers you advance time for `delay()` responses; cookies in Node follow the environment instead of an MSW cookie store.

## Query elements by role and name

Testing Library queries find elements the way users and assistive technology do. Prefer them in this order:

1. `getByRole('button', { name: 'Save' })`, which also checks the element is accessible.
2. `getByLabelText('Email')` for form fields.
3. `getByPlaceholderText`, `getByText`, `getByDisplayValue` for content without a role.
4. `getByTestId` only when nothing user-visible identifies the element.

| Variant | Returns | Use for |
|---|---|---|
| `getBy…` | element or throws | element that must be there now |
| `queryBy…` | element or `null` | asserting absence: `expect(screen.queryByRole('alert')).not.toBeInTheDocument()` |
| `findBy…` | promise, retries until found or timeout | element that appears after async work |

Use `screen` rather than destructuring `render`'s return; it reads like the page and survives refactors.

## Interact with user-event

`user-event` simulates full interactions (pointer, focus, keyboard events in order), unlike `fireEvent`, which dispatches a single event. Create a user per test before rendering:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

test('adds a todo with the keyboard', async () => {
  const user = userEvent.setup()
  render(<TodoApp />)
  await user.type(screen.getByRole('textbox', { name: 'New todo' }), 'Buy milk{Enter}')
  expect(await screen.findByRole('listitem', { name: /buy milk/i })).toBeInTheDocument()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Clear completed' })).toHaveFocus()
})
```

Every `user.*` call returns a promise; await it. With fake timers, pass `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`.

## Async assertions without act warnings

Updates after a promise resolves happen outside the test's synchronous flow. Wait for what the user would wait for, and React's `act` warnings go away:

- `await screen.findBy…` for something that appears.
- `await waitFor(() => expect(save).toHaveBeenCalled())` for a non-DOM effect; keep one assertion inside and no side effects.
- `await waitForElementToBeRemoved(() => screen.queryByText('Loading…'))` for something that disappears.

Vitest 5 fails a test when an asynchronous assertion (`resolves`, `rejects`, `toMatchFileSnapshot`) is not awaited. `expect.poll` needs `await` too (a missing one has failed the test since Vitest 3), and in Vitest 5 it fails when its function does not resolve in time.

## Test a hook with renderHook

`renderHook` renders a hook inside a test component. Test hooks this way only when they hold logic worth testing apart from any component:

```tsx
import { act, renderHook } from '@testing-library/react'

test('useCounter increments', () => {
  const { result } = renderHook(() => useCounter(5))
  act(() => result.current.increment())
  expect(result.current.count).toBe(6)
})
```

Pass providers with the `wrapper` option (`renderHook(() => useInvoices(), { wrapper: QueryWrapper })`). The old `@testing-library/react-hooks` package is obsolete; `renderHook` lives in `@testing-library/react`.

## Render with providers

Components that need a query client, router or store get them from a custom render function in the test folder. Build fresh instances per test so tests share nothing:

```tsx
// src/test/render.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { render } from '@testing-library/react'

export function renderApp(path: string, routes: RouteObject[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return { router, client, ...render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>) }
}
```

Recipes for routes, forms, stores, timers, accessibility checks and snapshot alternatives: [test-recipes.md](references/test-recipes.md).

## Vitest Browser Mode for real-browser tests

Vitest Browser Mode runs component tests in a real browser through Playwright, so layout, focus, CSS and browser APIs are real. Use it for components that depend on them (drag and drop, virtual lists, canvas, `ResizeObserver`):

```bash
npm i -D @vitest/browser-playwright vitest-browser-react && npx playwright install chromium
```

```ts
// vitest.browser.config.ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'

export default defineConfig({
  plugins: [react()],
  test: { include: ['src/**/*.browser.test.tsx'], browser: { enabled: true, provider: playwright(), instances: [{ browser: 'chromium' }] } },
})
```

```tsx
import { render } from 'vitest-browser-react'
import { expect, test } from 'vitest'

test('increments', async () => {
  const screen = await render(<Counter initial={1} />)
  await screen.getByRole('button', { name: 'Increment' }).click()
  await expect.element(screen.getByText('Count is 2')).toBeVisible()
})
```

Locators retry automatically, so no `findBy` or `waitFor` is needed. Vitest 5 enables `locators.exact` by default (names match exactly) and makes `toHaveTextContent` strict; use `toMatchTextContent` for partial text.

## End-to-end tests with Playwright

Playwright tests run the built app in Chromium, Firefox and WebKit. Keep them few and focused on journeys that must never break (sign in, checkout, the main create-edit-delete flow):

```bash
npm init playwright@latest
npx playwright test --ui
```

Use the same role-based locators (`page.getByRole('button', { name: 'Pay' })`) and run against `vite preview`, not the dev server. Journeys, fixtures, sharding and visual checks: `react-e2e-testing`.

## Worked example: a flaky test made deterministic

A worked example of the rules: the first test passes on a fast laptop and fails in CI. It shares a query client, hits an unmocked endpoint, sleeps instead of waiting, and asserts before the mutation finishes:

```tsx
// Flaky
const client = new QueryClient()                                              // shared by every test: cache and retries leak
test('pays an invoice', async () => {
  render(<QueryClientProvider client={client}><InvoiceList /></QueryClientProvider>)
  await new Promise((r) => setTimeout(r, 500))                                // sleep and hope
  fireEvent.click(screen.getByText('Pay'))                                    // one synthetic click, first "Pay" on the page
  expect(screen.getByText('Paid')).toBeInTheDocument()                        // the request has not returned yet
})
```

```tsx
// Deterministic: own network, own client, waits for what the user waits for
test('pays an invoice and shows it as paid', async () => {
  const user = userEvent.setup()
  let paid = false
  server.use(
    http.get('/api/invoices', () => HttpResponse.json([{ id: '1', number: '2026-001', total: 120, status: paid ? 'paid' : 'sent' }])),
    http.post('/api/invoices/:id/pay', () => { paid = true; return HttpResponse.json({ id: '1', status: 'paid' }) }),
  )
  renderWithQuery(<InvoiceList />)                                            // a fresh QueryClient with retry: false
  const row = await screen.findByRole('row', { name: /2026-001/ })
  await user.click(within(row).getByRole('button', { name: /pay/i }))
  expect(await within(row).findByText('Paid')).toBeInTheDocument()
})

test('shows the error when paying fails', async () => {
  server.use(http.post('/api/invoices/:id/pay', () => HttpResponse.json({}, { status: 500 })))
  renderWithQuery(<InvoiceList />)
  const row = await screen.findByRole('row', { name: /2026-001/ })
  await userEvent.setup().click(within(row).getByRole('button', { name: /pay/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/payment failed/i)
})
```

- `onUnhandledFrame: 'error'` in the setup file turns the forgotten endpoint into a failure that names the URL, instead of a timeout.
- `within(row)` scopes queries to one row, so a second invoice with a Pay button cannot make the test click the wrong one.

## Verify React tests

Tests are proven trustworthy when they pass in a random order, repeatedly, and fail when the behaviour they guard is broken. Run:

```bash
npx vitest run --coverage                         # all tests, coverage thresholds per directory
npx vitest run --sequence.shuffle                 # random order: shared state between tests shows up as failures
for i in 1 2 3 4 5; do npx vitest run src/features/invoices || break; done   # repeat a suspect file before calling it stable
```

- Break the code on purpose (flip a condition in the component) and watch the test fail with a readable message; a test that stays green guards nothing.
- The output has no `act(...)` warnings and no "unhandled request" lines.
- CI runs the same command as a developer, on Node 22 or newer, with the lockfile (`npm ci`).

## Pre-merge checklist for React tests

Check each point before merging tests.

1. Vitest config with `environment: 'jsdom'` (or Browser Mode) and a setup file that loads jest-dom, cleans up and starts MSW.
2. MSW handlers for every endpoint the tests touch; unhandled requests fail tests.
3. Queries by role and label; `getByTestId` rare.
4. Interactions through `userEvent.setup()`, all awaited.
5. Async UI asserted with `findBy`, `waitFor` or Browser Mode locators; no `act` warnings in output.
6. Fresh query client, router and stores per test.
7. Tests describe behaviour; refactors do not break them.
8. A few Playwright journeys run in CI against a production build.

## Gotchas and anti-patterns in React tests

Each entry gives the symptom you see, its cause and the fix.

1. **`toBeInTheDocument is not a function`.** Cause: jest-dom not loaded. Fix: `import '@testing-library/jest-dom/vitest'` in the setup file.
2. **Elements from the previous test are still in the DOM.** Cause: no automatic cleanup without `globals: true`. Fix: `afterEach(cleanup)`.
3. **"An update was not wrapped in act(...)".** Cause: the test ended before async work finished. Fix: await the UI change with `findBy` or `waitFor`.
4. **Mock calls recorded in `beforeAll` or at import time are gone after upgrading to Vitest 5.** Cause: Vitest 5 clears mock call history before each test by default (`clearMocks`). Fix: trigger and assert the calls inside the same test; set `clearMocks: false` only as a temporary bridge.
5. **`server.listen({ onUnhandledRequest })` type error after upgrading MSW.** Cause: MSW 3 renamed it. Fix: `onUnhandledFrame`.
6. **A delayed MSW response never resolves with fake timers.** Cause: MSW 3 no longer patches `setTimeout`. Fix: advance the fake timers (`vi.advanceTimersByTimeAsync`).
7. **Tests in a sub-package ignore the root config.** Cause: Vitest 5 stopped searching ancestor folders. Fix: a config per package, or run from the root with `projects`.
8. **Queries retry three times and time out.** Cause: TanStack Query's default retry in tests. Fix: `retry: false` in the test client.
9. **`toThrow('')` passes for any error.** Cause: Vitest 5 reverted it to match any message. Fix: `toThrow(/^$/)` to require an empty message.
10. **`fetch('/api/…')` throws "Failed to parse URL" in a jsdom test.** Cause: Node's `fetch` needs absolute URLs, and depending on the MSW and jsdom versions a relative path may not be resolved for you. Fix: build request URLs from a base (`new URL(path, import.meta.env.VITE_API_URL ?? location.origin)`) in the HTTP helper, and use the same base in MSW handlers.
11. **Anti-pattern: sleeping in tests (`await new Promise((r) => setTimeout(r, 500))`).** Symptom: tests pass locally and fail in CI, or take seconds each. Cause: guessing how long async work takes. Fix: `findBy`, `waitFor` on the outcome, or fake timers you advance.
12. **Anti-pattern: asserting implementation details.** Symptom: a refactor that keeps behaviour breaks dozens of tests. Cause: tests read state, class names or call counts of internal functions. Fix: assert what the user sees and what the server received.

## See also

- `react-e2e-testing`: Playwright journeys, fixtures, visual and accessibility checks in real browsers, CI sharding.
- `react-accessibility` (axe), `react-data-fetching` (query test setup), `react-router-data-mode` (memory-router tests).
