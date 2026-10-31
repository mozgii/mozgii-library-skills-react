---
title: React test recipes
author: MOZGII, Inc.
lang: en
---

# React test recipes

Test patterns for common React situations with Vitest 5, Testing Library 16, user-event 14, jest-dom 7 and MSW 3. Each recipe assumes the setup file from the `react-testing` skill (jest-dom loaded, `cleanup` after each test, MSW server started).

## Contents

This page, React test recipes, has these sections.

1. A data screen with loading, error and success
2. A mutation and its cache update
3. A form with validation
4. A route with a loader
5. A component that reads a store
6. Timers and debounced input
7. Accessibility checks with axe
8. Snapshots and what to use instead
9. Coverage that means something

## A data screen with loading, error and success

A data screen test covers each state a user can see: loading, error and success. Override the handler for the error case:

```tsx
import { http, HttpResponse, delay } from 'msw'

test('shows invoices after loading', async () => {
  renderWithQuery(<InvoiceList />)
  expect(screen.getByText(/loading/i)).toBeInTheDocument()
  expect(await screen.findByRole('row', { name: /2026-001/ })).toBeInTheDocument()
})

test('shows an error with retry', async () => {
  server.use(http.get('/api/invoices', () => HttpResponse.json({}, { status: 500 })))
  renderWithQuery(<InvoiceList />)
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i)
  server.resetHandlers()
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('row', { name: /2026-001/ })).toBeInTheDocument()
})

test('shows the empty state', async () => {
  server.use(http.get('/api/invoices', async () => { await delay(10); return HttpResponse.json([]) }))
  renderWithQuery(<InvoiceList />)
  expect(await screen.findByText('No invoices yet')).toBeInTheDocument()
})
```

## A mutation and its cache update

Assert the request the server received and the UI after it, not the cache internals:

```tsx
test('paying an invoice updates its status', async () => {
  let body: unknown
  server.use(http.post('/api/invoices/:id/pay', async ({ request, params }) => {
    body = await request.json().catch(() => null)
    return HttpResponse.json({ id: params.id, number: '2026-001', total: 120, status: 'paid' })
  }))
  const user = userEvent.setup()
  renderWithQuery(<InvoiceDetail id="1" />)
  await user.click(await screen.findByRole('button', { name: 'Pay' }))
  expect(await screen.findByText('Paid')).toBeInTheDocument()
  expect(body).toBeNull()
})
```

## A form with validation

Fill the form through labels, submit, and check messages and the submitted values. The `react-forms` reference has a full React Hook Form example; the native Action version looks the same from the test's side:

```tsx
test('rejects an invalid email', async () => {
  const user = userEvent.setup()
  render(<SignupForm />)
  await user.type(screen.getByLabelText('Email'), 'not-an-email')
  await user.click(screen.getByRole('button', { name: 'Sign up' }))
  expect(await screen.findByText('Enter a valid email')).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
})
```

## A route with a loader

Render the real route table in a memory router so loaders, actions and error boundaries run as in the app (`react-router-data-mode` has more):

```tsx
test('a missing project shows the not-found message', async () => {
  server.use(http.get('/api/projects/:id', () => HttpResponse.json({}, { status: 404 })))
  const router = createMemoryRouter(routes, { initialEntries: ['/projects/nope'] })
  render(<RouterProvider router={router} />)
  expect(await screen.findByText('Project not found')).toBeInTheDocument()
})
```

## A component that reads a store

Reset module-level stores before each test, or wrap the component in a provider with a fresh store:

```tsx
const initial = useEditor.getState()
beforeEach(() => useEditor.setState(initial, true))

test('choosing the pen tool marks it pressed', async () => {
  const user = userEvent.setup()
  render(<Toolbar />)
  await user.click(screen.getByRole('button', { name: 'Pen' }))
  expect(screen.getByRole('button', { name: 'Pen' })).toHaveAttribute('aria-pressed', 'true')
})
```

## Timers and debounced input

Fake timers make debounce and polling tests instant. Tell user-event how to advance them:

```tsx
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => vi.useRealTimers())

test('searches after the user stops typing', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<SearchBox onSearch={onSearch} />)
  await user.type(screen.getByRole('searchbox'), 'acme')
  expect(onSearch).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(300)
  expect(onSearch).toHaveBeenCalledWith('acme')
})
```

Vitest 5's fake timers also mock `Temporal` when the runtime has it.

## Accessibility checks with axe

`axe-core` finds missing names, bad ARIA and contrast problems that role queries alone do not. Run it on rendered components in jsdom for structure, and in a real browser (Playwright with `@axe-core/playwright`) for contrast and layout:

```tsx
import axe from 'axe-core'

test('the settings form has no axe violations', async () => {
  const { container } = render(<SettingsForm />)
  const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })   // jsdom has no layout
  expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})
```

More in the `react-accessibility` skill.

## Snapshots and what to use instead

Large DOM snapshots break on every markup change and get approved without reading. Prefer explicit assertions on what matters. Use small inline snapshots for stable serialized output (a formatted string, a reducer result):

```ts
expect(formatInvoiceNumber(2026, 42)).toMatchInlineSnapshot(`"2026-042"`)
```

For visual regressions, use screenshot assertions in Vitest Browser Mode (`expect.element(locator).toMatchScreenshot()`) or Playwright (`toHaveScreenshot()`), reviewed as images.

## Coverage that means something

Coverage shows which lines tests never run; it does not show whether they check anything. Run `vitest run --coverage`, read the uncovered branches of important modules (validation, money, permissions) and add behaviour tests for them. Set thresholds per directory for the code that matters rather than one global number:

```ts
coverage: { provider: 'v8', thresholds: { 'src/features/billing/**': { lines: 90, branches: 85 } } }
```

Vitest 5 writes reports under `.vitest/` by default (HTML, JSON, JUnit, blob); add it to `.gitignore` and update CI artifact paths.
