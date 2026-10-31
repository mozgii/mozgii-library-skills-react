---
title: Invoice screen worked example with TanStack Query
author: MOZGII, Inc.
lang: en
---

# Invoice screen worked example with TanStack Query

A complete feature built with TanStack Query 5.105 and React 19.3: a typed API module with Zod-checked responses, a paged list screen with pending, error, empty and success states, a pay mutation that shows its own error, and MSW tests for every state. It uses the `http` helper and `HttpError` class from the query patterns page of the `react-data-fetching` skill.

## Contents

This page, Invoice screen worked example with TanStack Query, has these sections.

1. Invoice API module with queryOptions and a schema
2. Invoice list screen with every state
3. Pay button mutation with an inline error
4. Tests for each invoice screen state

## Invoice API module with queryOptions and a schema

The invoice API module keeps keys, request functions and the response schema together, so a key can never miss an input and a changed API fails in one place:

```ts
// src/features/invoices/api.ts
import { mutationOptions, queryOptions } from '@tanstack/react-query'
import { z } from 'zod'
import { http } from '@/shared/lib/http'

export const Invoice = z.object({
  id: z.string(),
  number: z.string(),
  customer: z.string(),
  total: z.number(),
  status: z.enum(['open', 'paid']),
})
export type Invoice = z.infer<typeof Invoice>
export type InvoiceFilters = { status: Invoice['status']; page: number }

export const invoiceQueries = {
  all: () => ['invoices'] as const,
  list: (filters: InvoiceFilters) =>
    queryOptions({
      queryKey: [...invoiceQueries.all(), 'list', filters],
      queryFn: async ({ signal }) => {
        const params = new URLSearchParams({ status: filters.status, page: String(filters.page) })
        return z.array(Invoice).parse(await http<unknown>(`/api/invoices?${params}`, { signal }))
      },
      staleTime: 30_000,
    }),
}

export const payInvoice = (id: string) =>
  mutationOptions({
    mutationKey: ['invoices', 'pay', id],
    mutationFn: async () => Invoice.parse(await http<unknown>(`/api/invoices/${encodeURIComponent(id)}/pay`, { method: 'POST' })),
  })
```

`URLSearchParams` and `encodeURIComponent` keep user-controlled values from breaking the URL.

## Invoice list screen with every state

The invoice list screen keeps the previous page visible while the next one loads (`keepPreviousData`), marks the region busy during any fetch, and gives each state its own role:

```tsx
// src/features/invoices/InvoicesScreen.tsx
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { invoiceQueries, type InvoiceFilters } from './api'
import { PayButton } from './PayButton'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function InvoicesScreen({ status, page }: InvoiceFilters) {
  const invoices = useQuery({ ...invoiceQueries.list({ status, page }), placeholderData: keepPreviousData })

  if (invoices.isPending) return <div role="status" aria-label="Loading invoices"><TableSkeleton rows={8} /></div>
  if (invoices.isError) {
    return (
      <div role="alert">
        <p>Invoices could not be loaded. {invoices.error.message}</p>
        <button type="button" onClick={() => void invoices.refetch()}>Try again</button>
      </div>
    )
  }
  if (invoices.data.length === 0) return <EmptyState title={status === 'open' ? 'No open invoices' : 'No paid invoices yet'} />
  return (
    <section aria-label="Invoices" aria-busy={invoices.isFetching}>
      {invoices.isPlaceholderData && <p role="status">Loading page {page}…</p>}
      <table style={{ opacity: invoices.isPlaceholderData ? 0.6 : 1 }}>
        <caption className="sr-only">Invoices, page {page}</caption>
        <thead><tr><th scope="col">Number</th><th scope="col">Customer</th><th scope="col">Total</th><th scope="col">Action</th></tr></thead>
        <tbody>
          {invoices.data.map((invoice) => (
            <tr key={invoice.id}>
              <td>{invoice.number}</td>
              <td>{invoice.customer}</td>
              <td>{money.format(invoice.total)}</td>
              <td>{invoice.status === 'open' ? <PayButton invoice={invoice} /> : 'Paid'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- `TableSkeleton` and `EmptyState` are the app's shared components; the skeleton matches the table's shape so nothing jumps when rows arrive.
- `isPlaceholderData` is true while the old page shows during the next page's fetch; the dimmed table and the status line say so.

## Pay button mutation with an inline error

The pay button mutation updates the cache from the server's answer and invalidates the lists, and it shows its failure next to the control rather than in a boundary:

```tsx
// src/features/invoices/PayButton.tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invoiceQueries, payInvoice, type Invoice } from './api'

export function PayButton({ invoice }: { invoice: Invoice }) {
  const queryClient = useQueryClient()
  const pay = useMutation({
    ...payInvoice(invoice.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: invoiceQueries.all() }),
  })
  return (
    <>
      <button type="button" disabled={pay.isPending} aria-describedby={pay.isError ? `pay-error-${invoice.id}` : undefined}
        onClick={() => pay.mutate()}>
        {pay.isPending ? 'Paying…' : `Pay invoice ${invoice.number}`}
      </button>
      {pay.isError && <p id={`pay-error-${invoice.id}`} role="alert">Payment failed. Try again.</p>}
    </>
  )
}
```

Returning the invalidation promise keeps the button pending until the refreshed list has arrived, so the row never shows "Pay" again for a paid invoice.

## Tests for each invoice screen state

The invoice screen tests drive every state through MSW handlers and a fresh query client per test (`renderWithQuery` from the query patterns page):

```tsx
// src/features/invoices/InvoicesScreen.test.tsx
import { http, HttpResponse } from 'msw'
import { server } from '@/test/server'

const row = { id: 'i1', number: '2026-001', customer: 'Acme', total: 120, status: 'open' }

test('shows rows after loading', async () => {
  server.use(http.get('/api/invoices', () => HttpResponse.json([row])))
  renderWithQuery(<InvoicesScreen status="open" page={1} />)
  expect(screen.getByRole('status', { name: 'Loading invoices' })).toBeInTheDocument()
  expect(await screen.findByRole('row', { name: /2026-001/ })).toBeInTheDocument()
})

test('shows an error and recovers on retry', async () => {
  server.use(http.get('/api/invoices', () => HttpResponse.json({}, { status: 500 }), { once: true }),
             http.get('/api/invoices', () => HttpResponse.json([row])))
  renderWithQuery(<InvoicesScreen status="open" page={1} />)
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('row', { name: /2026-001/ })).toBeInTheDocument()
})

test('shows the empty state', async () => {
  server.use(http.get('/api/invoices', () => HttpResponse.json([])))
  renderWithQuery(<InvoicesScreen status="open" page={1} />)
  expect(await screen.findByText('No open invoices')).toBeInTheDocument()
})

test('a rejected response shape is an error, not data', async () => {
  server.use(http.get('/api/invoices', () => HttpResponse.json([{ id: 1 }])))
  renderWithQuery(<InvoicesScreen status="open" page={1} />)
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded')
})
```

The last test proves the Zod schema guards the boundary: a malformed response becomes an error state instead of a crash deeper in the table.
