---
name: react-data-tables
description: Builds data tables and grids in React with TanStack Table 9 - features and row-model slots, typed columns with createColumnHelper, sorting, filtering and global search, pagination on the client or the server with TanStack Query, row selection, column visibility, virtualized rows, accessible table markup, React Compiler boundaries, and migrating from v8's useReactTable. Use when building a sortable or filterable table, a data grid, server-side pagination, row checkboxes, when a table API is missing or undefined, a table re-renders on every keystroke, or when upgrading TanStack Table from v8 to v9.
metadata:
  tags:
  - react
  - tables
  - tanstack-table
  - data-grid
  - sorting
  - pagination
  - filtering
  - row-selection
---

# React data tables with TanStack Table

A data table turns rows into something people can sort, search, page and select. TanStack Table is headless: it computes rows, headers and state, and you render the `<table>` markup and styles yourself. This skill covers `@tanstack/react-table` 9.3 (v9 shipped in August 2026 with a new feature-registration API) on React 19.3. For a spreadsheet-like grid with cell editing, pivoting and Excel export out of the box, a full grid product (AG Grid, MUI X Data Grid) may cost less than building it.

## Step 0: read the installed TanStack Table

TanStack Table 9 changed how tables are built, and most examples online are v8. Check the major and read the skills the package ships:

```bash
node -p "require('@tanstack/react-table/package.json').version"     # 9.3.1 when this was written
ls node_modules/@tanstack/react-table/skills node_modules/@tanstack/table-core/skills
```

The bundled skills (MIT) follow the installed version; open `table-core/skills/table-features/references/<feature>.md` for a feature's exact options. On 8.x, the code here does not apply: v8 uses `useReactTable` with `getCoreRowModel()` and friends.

## Choose client tables, server tables or a grid product

Choosing a table setup depends on how many rows exist, how many the browser holds, and which features are needed out of the box:

| Situation | Use | Why the alternatives lose |
|---|---|---|
| A few rows, no sorting or selection | a plain `<table>` | a table library adds code and concepts for nothing |
| Up to a few thousand rows loaded at once, sorted and filtered in the browser | TanStack Table with client row models | a server round trip per sort or keystroke feels slow for data already on the client |
| More rows than you want to send, or filters the server must apply (permissions, full-text search) | TanStack Table with `manual*` flags and TanStack Query | sending every row costs memory, bandwidth and first paint |
| Thousands of rows shown in one scrolling body | client row models plus virtualized rows (`react-virtual-lists`) | rendering every row makes the DOM huge and scrolling stutters |
| Spreadsheet behaviour: cell editing, range selection, pivoting, grouping, Excel export | a grid product (AG Grid, MUI X Data Grid) | building those on a headless table takes months of work |

## Register features, then build the table

A v9 table only has the APIs whose features you register: sorting methods exist only when `rowSortingFeature` is in `tableFeatures`, and client-side processing needs its row-model slot. Define features and columns at module scope so they stay stable:

```tsx
// src/features/invoices/invoice-table.tsx
import {
  columnFilteringFeature, createColumnHelper, createFilteredRowModel, createPaginatedRowModel,
  createSortedRowModel, filterFn_includesString, globalFilteringFeature, rowPaginationFeature,
  rowSortingFeature, sortFn_alphanumeric, tableFeatures, useTable,
} from '@tanstack/react-table'

type Invoice = { id: string; number: string; customer: string; total: number; status: 'draft' | 'sent' | 'paid' }

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
})

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const col = createColumnHelper<typeof features, Invoice>()
const columns = col.columns([
  col.accessor('number', { header: 'Number' }),
  col.accessor('customer', { header: 'Customer' }),
  col.accessor('total', { header: 'Total', cell: (info) => money.format(info.getValue()) }),
  col.accessor('status', { header: 'Status', enableGlobalFilter: false }),
])
```

- Register a prerequisite feature before the slot that needs it (`columnFilteringFeature` before `globalFilteringFeature` and `filteredRowModel`).
- Import only the `sortFn_*` and `filterFn_*` built-ins you use; their keys become typed names (`'includesString'`).
- `stockFeatures` registers everything at once; it is a migration aid with the bundle cost of every feature.

## Render the table with sorting, search and pages

The component calls `useTable` and renders headers and rows from the table's models. Semantic `<table>` markup gives screen readers rows, columns and headers for free:

```tsx
export function InvoiceTable({ invoices }: { invoices: Invoice[] }) {
  const table = useTable({
    features,
    columns,
    data: invoices,
    getRowId: (row) => row.id,
    globalFilterFn: 'includesString',
    initialState: { sorting: [{ id: 'number', desc: true }], pagination: { pageIndex: 0, pageSize: 25 } },
  })

  return (
    <>
      <input type="search" aria-label="Search invoices" value={String(table.state.globalFilter ?? '')}
        onChange={(e) => table.setGlobalFilter(e.target.value)} />
      <table>
        <caption className="sr-only">Invoices</caption>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const dir = header.column.getIsSorted()
                return (
                  <th key={header.id} scope="col" aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}>
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button type="button" onClick={header.column.getToggleSortingHandler()}>
                        <table.FlexRender header={header} />{dir === 'asc' ? ' ↑' : dir === 'desc' ? ' ↓' : ''}
                      </button>
                    ) : <table.FlexRender header={header} />}
                  </th>
                )
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- FlexRender supplies the cell's content */}
              {row.getAllCells().map((cell) => <td key={cell.id}><table.FlexRender cell={cell} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <nav aria-label="Pages">
        <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</button>
        <span>Page {table.state.pagination.pageIndex + 1} of {table.getPageCount()}</span>
        <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</button>
      </nav>
    </>
  )
}
```

- `getRowId` gives rows stable ids from the data; without it, row ids are indexes and selection follows positions after a sort.
- Sort controls are `<button>`s inside `<th>`, with `aria-sort` on the `<th>`; a clickable `<th>` alone is not keyboard reachable.
- `row.getAllCells()` works with core features only; with `columnVisibilityFeature` registered, use `row.getVisibleCells()` and `table.getVisibleLeafColumns()`.

## Server-side pagination, sorting and filtering with TanStack Query

Server-side tables send the page, sort and filters to the API and render exactly the rows that come back. Own that state in React, put every piece of it in the query key, and tell the table not to process rows itself:

```tsx
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { rowPaginationFeature, rowSortingFeature, tableFeatures, useTable, type PaginationState, type SortingState } from '@tanstack/react-table'

const serverFeatures = tableFeatures({ rowPaginationFeature, rowSortingFeature })
const noRows: Invoice[] = []                                   // stable fallback: a new [] each render invalidates the row models

export function ServerInvoiceTable() {
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 50 })
  const [sorting, setSorting] = useState<SortingState>([])
  const page = useQuery({
    queryKey: ['invoices', 'table', pagination, sorting],
    queryFn: ({ signal }) => fetchInvoicePage({ pagination, sorting }, signal),    // returns { rows, total }
    placeholderData: keepPreviousData,                                              // keep the old page while the next loads
  })
  const table = useTable({
    features: serverFeatures,
    columns: serverColumns,
    data: page.data?.rows ?? noRows,
    rowCount: page.data?.total ?? 0,
    getRowId: (row) => row.id,
    manualPagination: true,
    manualSorting: true,
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: (updater) => {
      setSorting(updater)
      setPagination((p) => ({ ...p, pageIndex: 0 }))                // a new order starts at page 1
    },
  })
  // render as above; dim the body while page.isPlaceholderData is true
}
```

- `manualPagination` and `manualSorting` only stop the table from slicing and sorting; the server must return the right page in the right order, and `rowCount` (or `pageCount`) tells the table how many pages exist.
- Pass both `state.<slice>` and its `on<Slice>Change`; a callback without the state lets the table drift from what you fetched.
- Reset `pageIndex` to 0 when filters or sorting change, or the user lands on an empty page 9 of a 2-page result.
- Keep this state in the URL when people share or reload filtered views (`react-router-data-mode`, `tanstack-router`).

## Row selection with checkboxes

Row selection keeps a map of selected row ids. Register `rowSelectionFeature`, add a display column for the checkboxes, and act on ids rather than row objects, because ids survive paging and refetching:

```tsx
import { rowSelectionFeature, Subscribe } from '@tanstack/react-table'

const selectableFeatures = tableFeatures({ rowSelectionFeature, rowPaginationFeature, paginatedRowModel: createPaginatedRowModel() })
const sel = createColumnHelper<typeof selectableFeatures, Invoice>()

const selectColumn = sel.display({
  id: 'select',
  header: ({ table }) => (
    <input type="checkbox" aria-label="Select all on this page"
      checked={table.getIsAllPageRowsSelected()} onChange={table.getToggleAllPageRowsSelectedHandler()} />
  ),
  cell: ({ row }) => (
    <Subscribe source={row.table.atoms.rowSelection} selector={(s) => s[row.id]}>
      {(selected) => (
        <input type="checkbox" aria-label={`Select invoice ${row.original.number}`}
          checked={!!selected} onChange={row.getToggleSelectedHandler()} />
      )}
    </Subscribe>
  ),
})
// later: const ids = table.getSelectedRowIds()
```

- The row handler supports Shift-click ranges by default (`enableRowRangeSelection: false` turns it off).
- `getSelectedRowModel()` holds only loaded rows; with server pages, send `getSelectedRowIds()` to the API.
- The `Subscribe` around the cell matters with the React Compiler (next section).

## Re-renders and the React Compiler

`useTable` subscribes the component to all registered table state by default, so the whole table re-renders on each change. That is fine for a few hundred rows. Narrow it when a profile shows a problem:

- Pass a selector as the second argument: `useTable(options, (s) => ({ pagination: s.pagination }))`; only those slices re-render the owner and appear on `table.state`.
- Wrap small fast-changing parts in `<table.Subscribe selector={(s) => s.rowSelection}>` (or standalone `Subscribe` inside cell renderers).
- With the React Compiler, a memoized child that receives a stable `row`, `cell` or `column` object and calls a method such as `row.getIsSelected()` will not update. Read the state through `Subscribe` inside that child, or pass the value as a prop.
- `table.atoms.<slice>.get()` and `table.store.state` are snapshots, not subscriptions; reading them in render shows stale values.

## Large tables with virtualized rows

Virtualization renders only the rows in view, so a table with 50,000 client rows scrolls like one with 50. TanStack Virtual reads the table's final row model; it is not a table feature:

```tsx
const rows = table.getRowModel().rows
// oxlint-disable-next-line react/incompatible-library -- isolated in this leaf on purpose
const v = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 36, overscan: 8, getItemKey: (i) => rows[i]!.id })
```

Render `v.getVirtualItems()` as absolutely positioned rows inside a scroll container, with `display: grid` on rows and fixed column widths (`columnSizingFeature`, `cell.column.getSize()`) so header and body columns line up. Keep `aria-rowcount` on the table and `aria-rowindex` on each row so screen readers announce real positions. Full list virtualization code: `react-virtual-lists` (and the overview in `react-performance`).

## Accessible table markup

A data table is accessible when it is a real `<table>`: screen readers then announce the column header for each cell and let users move by row and column. Keep these:

- `<caption>` (visible or visually hidden) names the table; `scope="col"` on header cells.
- Sort buttons inside headers, `aria-sort` on the sorted `<th>` only.
- Row actions as buttons with names that include the row ("Edit invoice 2026-014"), not a bare "Edit".
- A table with interactive cells navigated by arrow keys is a grid: use `role="grid"` with the APG grid keyboard model, or a grid library, not ad-hoc key handlers.
- Announce result counts after filtering through a polite live region ("42 invoices"), debounced.

## Worked example: a server table body with loading, empty and error states

A worked example that finishes the server table above: the body renders a loading row, an error row with retry, an empty row and the data rows, and the table tells screen readers the real row count and each row's position across pages:

```tsx
// inside ServerInvoiceTable, after useTable(...)
const cols = serverColumns.length
const { pageIndex, pageSize } = pagination
return (
  <>
    <p role="status" className="sr-only">{page.data ? `${page.data.total} invoices` : ''}</p>
    <table aria-busy={page.isFetching} aria-rowcount={page.data ? page.data.total + 1 : undefined}>
      <caption className="sr-only">Invoices</caption>
      <thead>{/* header groups with sort buttons and aria-sort, as in InvoiceTable */}</thead>
      <tbody style={{ opacity: page.isPlaceholderData ? 0.6 : 1 }}>
        {page.isPending ? (
          <tr><td colSpan={cols}>Loading invoices…</td></tr>
        ) : page.isError ? (
          <tr><td colSpan={cols}>
            <div role="alert">Invoices could not be loaded. <button type="button" onClick={() => void page.refetch()}>Try again</button></div>
          </td></tr>
        ) : table.getRowModel().rows.length === 0 ? (
          <tr><td colSpan={cols}>No invoices yet.</td></tr>
        ) : (
          table.getRowModel().rows.map((row, i) => (
            <tr key={row.id} aria-rowindex={pageIndex * pageSize + i + 2}>
              {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- FlexRender supplies the cell's content */}
              {row.getAllCells().map((cell) => <td key={cell.id}><table.FlexRender cell={cell} /></td>)}
            </tr>
          ))
        )}
      </tbody>
    </table>
    <nav aria-label="Pages">
      <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</button>
      <span>Page {pageIndex + 1} of {Math.max(table.getPageCount(), 1)}</span>
      <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage() || page.isPlaceholderData}>Next</button>
    </nav>
  </>
)
```

- `aria-rowindex` starts at 2 because the header row is row 1; with paging, it continues across pages so "row 51 of 1,204" is announced correctly.
- Next is disabled while the placeholder page shows, so fast clicks cannot skip pages whose data never arrived.

## Migrate from TanStack Table v8 to v9

Migrating TanStack Table v8 code to v9 is more than renaming the hook. The main changes:

| v8 | v9 |
|---|---|
| `useReactTable({ getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() })` | `useTable({ features: tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel() }) })` |
| every API always present | APIs exist only for registered features |
| `table.getState().sorting` in render | `table.state.sorting`, or `Subscribe` / `useSelector` |
| `onStateChange` for all state | one `state.<slice>` plus `on<Slice>Change` pair per slice |
| `flexRender(cell.column.columnDef.cell, cell.getContext())` | `<table.FlexRender cell={cell} />` (`flexRender` still works) |
| `createColumnHelper<Person>()` | `createColumnHelper<typeof features, Person>()` |

`useLegacyTable` from `@tanstack/react-table/legacy` runs v8-style options during a gradual move; remove it when done. The package's `migrate-v8-to-v9` skill has the full checklist.

## Verify a React data table

A table is proven when sorting, paging and selection behave through the user's controls, the server receives every state slice, and the table stays fast while typing. Check:

```bash
npx tsc -b && npx oxlint --deny-warnings
npx vitest run src/features/invoices      # tests below, with MSW for the server table
```

```tsx
// pageOf(n) builds a fake { rows, total } response, numbered 2026-0, 2026-1, …; fetchInvoicePage sends page=pageIndex+1 and sort=<id>.<dir>
test('sorts by number and sends paging to the server', async () => {
  const user = userEvent.setup()
  const seen: URLSearchParams[] = []
  server.use(http.get('/api/invoices', ({ request }) => { seen.push(new URL(request.url).searchParams); return HttpResponse.json(pageOf(50)) }))
  renderWithQuery(<ServerInvoiceTable />)
  await screen.findByRole('cell', { name: '2026-0' })                    // an empty table sorts descending on the first click
  await user.click(screen.getByRole('button', { name: /Number/ }))
  expect(screen.getByRole('columnheader', { name: /Number/ })).toHaveAttribute('aria-sort', 'ascending')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())   // disabled while the sorted page loads
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await waitFor(() => expect(seen.at(-1)?.get('page')).toBe('2'))
})
```

- React DevTools Profiler: type in the search box of a 5,000-row client table; each keystroke commits in well under 16 ms, or the table needs `Subscribe`, narrower selectors or virtualization.
- Keyboard: Tab reaches each sort button and checkbox; Shift-click selects a range; the selection count is announced.

## Pre-merge checklist for a React data table

Check each point before merging a table.

1. Features, columns and fallback data defined at module scope or memoized; `getRowId` set.
2. Only the features the table uses are registered, each with its row-model slot for client processing.
3. Server tables: `manual*` flags, `rowCount`, every state slice in the query key, page reset on filter change.
4. Controlled slices pass both state and change callback.
5. Semantic `<table>` with caption, header scope, sort buttons and `aria-sort`.
6. Selection acts on ids; bulk actions confirm destructive work.
7. More than a few hundred rendered rows are virtualized or paged.
8. Loading, empty ("No invoices match 'acme'") and error states designed for the table body.

## Gotchas and anti-patterns in React data tables

Each entry gives the symptom you see, its cause and the fix.

1. **`table.getToggleAllPageRowsSelectedHandler is not a function` or a missing sort API.** Cause: the feature is not registered in v9. Fix: add it to `tableFeatures` (and its row-model slot).
2. **The table re-computes on every render and typing lags.** Cause: `data: result.data ?? []` creates a new array each render. Fix: a module-level `const noRows = []` fallback; keep `columns` and `features` stable.
3. **Clicking a header changes the arrow but the rows do not reorder.** Cause: `manualSorting: true` without server sorting, or no `sortedRowModel` slot. Fix: sort on the server, or register `createSortedRowModel()`.
4. **Two pages show the same rows.** Cause: pagination missing from the query key. Fix: `queryKey: ['invoices', 'table', pagination, sorting, filters]`.
5. **Next is enabled on the last server page.** Cause: no `rowCount` or `pageCount`. Fix: pass the server's total.
6. **Checkboxes do not tick with the React Compiler on.** Cause: a memoized cell reads `row.getIsSelected()` through a stable object. Fix: `Subscribe` to `row.table.atoms.rowSelection` inside the cell.
7. **Selection jumps to other rows after sorting or refetching.** Cause: index-based row ids. Fix: `getRowId: (row) => row.id`.
8. **v8 code fails with `useReactTable` is not exported.** Cause: v9 renamed it. Fix: `useTable` with features, or `useLegacyTable` from `@tanstack/react-table/legacy` while migrating.
9. **Anti-pattern: client sorting on a server page.** Symptom: sorting reorders only the 50 visible rows, and page 2 starts with values that belong on page 1. Cause: a client `sortedRowModel` on paged server data. Fix: `manualSorting` and send the sort to the server.
10. **Anti-pattern: clickable rows as the only way to open an item.** Symptom: keyboard and screen reader users cannot open rows. Cause: `onClick` on `<tr>`. Fix: a link or button in the first cell; the row click can stay as a shortcut.

Facts here were checked against the TanStack Table 9.3 type definitions and the skills shipped in its npm packages (MIT); the text and examples are original.

## See also

- `react-virtual-lists`: virtualized rows and columns, variable heights and scroll restoration in depth.
- `react-data-fetching` (server pages through TanStack Query), `react-accessibility` (grid keyboard models).
