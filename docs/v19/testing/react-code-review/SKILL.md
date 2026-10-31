---
name: react-code-review
description: Reviews React pull requests the way a senior engineer does - a prioritized checklist with the reason behind each item, covering correctness of effects, state and keys, race conditions and cleanup, data fetching and cache keys, every UI state, accessibility, security sinks, TypeScript discipline, performance claims backed by measurement, tests that prove behaviour, architecture boundaries and bundle impact; how to read a diff in the right order, how to write comments as blocker, should or nit with a suggested fix, and a script that scans the added lines for common findings. Use when reviewing or self-reviewing a React PR, setting review standards for a team, writing a review checklist, or when asked what a reviewer would flag in this component.
metadata:
  tags:
  - react
  - code-review
  - pull-requests
  - checklist
  - quality
  - best-practices
---

# React code review

A review protects users and the next developer. The reviewer's job is to find what will break (wrong behaviour, missing states, security holes, accessibility barriers), what will be hard to change (coupling, unclear state), and to say it in a way that gets it fixed. Style is the linter's job. This skill gives the order to read a pull request in, the checklist with reasons, and how to write the comments.

## Step 0: read the project's versions and scan the diff

Advice depends on the React version and the tools the project uses, so read them, then let the script point at lines worth a look:

```bash
node -p "['react','react-dom','typescript','@tanstack/react-query','react-router','eslint-plugin-react-hooks','babel-plugin-react-compiler','vitest','@playwright/test'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
git diff --stat origin/main...HEAD
node <this-skill>/scripts/pr-scan.mjs --base origin/main     # blockers, warnings and nits in the added lines
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

Written against `react` 19.3.1, `typescript` 7.0.2, `eslint-plugin-react-hooks` 7.1.1 (its `recommended` preset includes the React Compiler rules). When the React Compiler is on, manual `useMemo`, `useCallback` and `memo` are usually unnecessary: review them as noise, not as missing.

## Decision table: how to classify a review comment

| Label | Use for | Merge? |
|---|---|---|
| **Blocker** | a bug, data loss, a security or privacy hole, an accessibility barrier, a broken contract, a missing test for a fixed bug | not until fixed |
| **Should** | likely future bugs, missing states, unclear ownership of state, a test that tests implementation | fix now or file a ticket, by agreement |
| **Nit** | naming, small readability gains, optional simplifications | author's choice; never block |
| **Question** | you do not understand why; the answer may belong in a comment or the PR description | after an answer |
| **Praise** | something done well that others should copy | — |

Label every comment. Unlabelled comments read as blockers and slow every PR down.

## Read the pull request in this order

1. **The description and the linked issue**: what should change for users? Without that, you cannot judge correctness.
2. **Tests**: they say what the author believes the code does. Missing tests for the main behaviour are the first comment.
3. **Types, schemas and API contracts**: a changed type ripples further than any component.
4. **State and data flow**: where state lives, what triggers fetches and mutations, what invalidates the cache.
5. **Components and UI**: rendering, states, accessibility.
6. **Everything else**: styles, copy, configuration, dependencies.

Run the branch for anything with UI. Five minutes of clicking finds what an hour of reading misses.

## Correctness checklist with reasons

| Check | Why |
|---|---|
| Effects synchronize with something external; derived values are computed in render | an effect that sets state from props renders twice and drifts out of sync |
| Effect dependencies are complete; no `eslint-disable` of hook rules | missing dependencies are stale closures: the effect reads old values |
| Effects that subscribe, time or fetch clean up; fetches abort or ignore stale results | without cleanup, a slow response for the old id overwrites the new one |
| No component defined inside another component | the inner one remounts every render: inputs lose focus and state resets |
| List keys are stable ids, not indexes or random values | index keys attach state and focus to the wrong row after a reorder |
| State is not duplicated (no copy of a prop or of query data in `useState`) | two sources of truth disagree after the first update |
| Conditional rendering does not render `0` (`count && …`) | `0 && <x/>` renders "0" |
| Async handlers handle failure and double submission | the second click sends a second payment |
| Server and client agree: no `Date.now()`, random ids or locale formatting differing during hydration | hydration mismatches throw away server HTML |

## Data, states and user experience checklist

| Check | Why |
|---|---|
| Every async view renders loading, error with retry, empty and success | users meet the empty and error states first on a bad day |
| Query keys include every input of the query function | a missing key part shows one user's or filter's data for another |
| Mutations invalidate or update exactly the affected queries | stale lists after a save are the most reported bug |
| Optimistic updates roll back on error and say so | silent rollback looks like data loss |
| Shareable state (filters, tab, page) lives in the URL | Back, refresh and shared links must restore the view |
| Forms keep input on error, show field errors next to fields, disable submit while pending | retyping a long form after an error loses users |

## Accessibility checklist

| Check | Why |
|---|---|
| Buttons are `<button>`, links are `<a href>`; no clickable `div`s | `div`s are not focusable and ignore Enter and Space |
| Every control has an accessible name; icon buttons have `aria-label` | screen readers announce "button" with nothing else |
| Images have meaningful `alt`, or `alt=""` when decorative | missing alt makes screen readers read the file name |
| Dialogs and menus come from the design system or a headless library | focus trapping and return are easy to get wrong |
| Async results and errors are announced (live region, `role="alert"`) | silent updates are invisible without sight |
| Colour is not the only signal; focus is visible | colour-blind and keyboard users miss the state |

## Security checklist

| Check | Why |
|---|---|
| No `dangerouslySetInnerHTML` with data that is not sanitized (DOMPurify) | the most direct XSS path in React |
| URLs from data go through an allowlist of protocols before `href` or `src` | `javascript:` URLs run code (React 19.3 blocks them in `href`, not in every sink) |
| No secrets in client code or `VITE_` variables; no tokens in `localStorage` | everything in the bundle and web storage is readable |
| Redirect targets (`returnTo`) are resolved with `new URL(raw, origin)` and kept only when the origin is the app's | open redirects enable phishing |
| Authorization is enforced on the server, not only by hiding UI | hidden buttons do not stop API calls |
| New dependencies are needed, maintained, licensed and small | every dependency is code you ship and trust |

## TypeScript, tests and architecture checklist

| Check | Why |
|---|---|
| No `any`, no `as` casts that widen, no `!` on values that can be missing; `unknown` plus narrowing at boundaries | casts move type errors to runtime |
| External data (API, storage, URL) is validated with a schema | types are not checks |
| Tests assert user-visible behaviour (roles, text), not implementation (state, class names) | implementation tests break on refactors and miss real bugs |
| A bug fix comes with a test that failed before the fix | otherwise the bug returns |
| Imports respect feature boundaries; new shared code is domain-free | deep imports couple features |
| Performance changes come with a measurement (Profiler, Web Vitals, bundle size) | unmeasured memoization adds code and rarely helps |
| The bundle impact of new libraries and eager imports is known | a 200 kB dependency for one function costs every user |

## Write comments that get fixed

A good review comment names the problem, the consequence and a fix, in one or two sentences, and includes the code when it is short:

> **Blocker:** `useEffect` fetches `/api/users/${id}` without cancelling, so switching users quickly can show the previous user's profile. Move this to `useQuery({ queryKey: ['user', id], … })`, which cancels and caches, or add an `AbortController` and check it before `setUser`.

- Comment on the code, not the person ("this effect", not "you forgot").
- Ask questions when unsure ("Is `status` ever undefined here? If so…"); you may be missing context.
- Batch nits into one comment, or leave them out on urgent fixes.
- Approve with nits rather than blocking on them.
- Large PRs: ask for a split along a natural seam (refactor first, behaviour second) instead of reviewing 2,000 lines poorly.

## Worked example: reviewing a user search component

The diff under review, with the findings a senior reviewer would leave:

```tsx
// before: as submitted
export function UserSearch() {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<any[]>([])
  useEffect(() => {
    fetch(`/api/users?q=${query}`).then((r) => r.json()).then(setUsers)
  }, [query])
  return (
    <div>
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" />
      {users.map((u, i) => <div key={i} onClick={() => location.assign(`/users/${u.id}`)} dangerouslySetInnerHTML={{ __html: u.highlightedName }} />)}
    </div>
  )
}
```

1. **Blocker (security):** `highlightedName` is rendered as HTML from the API; a user named `<img onerror=…>` runs script. Render text and highlight in React.
2. **Blocker (correctness):** responses can arrive out of order, so results for "ab" can replace results for "abc". Use the query cache with the query in the key.
3. **Blocker (accessibility):** clickable `div`s are not reachable by keyboard; the input has no label. Use links and a `<label>`. Oxlint's `jsx-a11y/click-events-have-key-events` and `jsx-a11y/no-static-element-interactions` report these `div`s; both errors are correct on this submitted code, so fix the code and never silence them.
4. **Should:** no loading, error or empty state; `query` is not URL-encoded; every keystroke hits the server.
5. **Should:** `any[]`: validate the response with a schema at the boundary.
6. **Should:** add a test that types a query and asserts the result links by role.

The version that would pass review:

```tsx
import { useEffect, useEffectEvent, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { z } from 'zod'

const User = z.object({ id: z.string(), name: z.string() })
async function searchUsers(q: string, signal: AbortSignal) {
  const r = await fetch(`/api/users?q=${encodeURIComponent(q)}`, { signal })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return User.array().parse(await r.json())
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

function Highlight({ text, term }: { text: string; term: string }) {
  const i = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>
}

export function UserSearch() {
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState(() => params.get('q') ?? '')
  const term = useDebounced(query.trim(), 250)
  const syncUrl = useEffectEvent((next: string) => {
    if (next !== (params.get('q') ?? '')) setParams(next ? { q: next } : {}, { replace: true })
  })
  useEffect(() => { syncUrl(term) }, [term])
  const inputId = useId()
  const q = useQuery({
    queryKey: ['users', 'search', term],
    queryFn: ({ signal }) => searchUsers(term, signal),
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  return (
    <search>
      <label htmlFor={inputId}>Search people</label>
      <input id={inputId} type="search" value={query} autoComplete="off"
        onChange={(e) => setQuery(e.target.value)} />
      <div aria-live="polite" aria-busy={q.isFetching}>
        {term.length < 2 ? <p>Type at least 2 characters.</p>
          : q.isPending ? <p>Searching…</p>
          : q.isError ? <p role="alert">Search failed. <button type="button" onClick={() => q.refetch()}>Retry</button></p>
          : q.data.length === 0 ? <p>No people match “{term}”.</p>
          : <ul>{q.data.map((u) => <li key={u.id}><Link to={`/users/${encodeURIComponent(u.id)}`}><Highlight text={u.name} term={term} /></Link></li>)}</ul>}
      </div>
    </search>
  )
}
```

The query cache removes the race and caches results, the debounce sends one request after typing stops (`useDeferredValue` would not: it delays a render, and every keystroke still reaches the server), the URL keeps the search on refresh and Back, the typed text stays in `useState` because React Router updates the URL in a Transition and a controlled input must not wait for one, the schema replaces `any`, and the highlight is plain React text. A longer list of review smells with examples: [review-smells.md](references/review-smells.md).

## Verify a review

- `pr-scan.mjs` findings at blocker level are resolved or explained in the thread. Its effect rules read the whole effect, across lines: `fetch-in-effect` flags `useEffect(() => { fetch(url) })`, an inner `async function load()` that fetches, `useEffect(() => { void load() })` when `load` (a function or a `useCallback`) in the same diff calls `fetch`, and `useEffect(async () => …)`, which `async-effect` also flags as a blocker. On the worked example's diff above it reports `unsafe-html` (blocker) and `fetch-in-effect`, `any-type`, `index-key` and `clickable-div` (warnings). A fetch inside `queryFn` or an event handler is not flagged, nor one in an effect that creates an `AbortController`, passes its `signal` and calls `abort()` in the cleanup it returns.
- CI passed: types, lint with hook rules, unit tests, e2e for touched flows.
- You ran the branch for UI changes and checked keyboard use and one error path.
- Every blocker has a follow-up commit; every "should" is fixed or has a ticket.

## Gotchas and anti-patterns in code review

Each gotcha names the symptom, its cause and the fix.

1. **Reviews take days and PRs pile up.** Cause: large PRs and unlabelled comments. Fix: small PRs, a review within one working day, labelled comments.
2. **Bugs pass review that clicking would have found.** Cause: reading the diff only. Fix: run the branch for UI changes.
3. **Arguments about formatting.** Cause: no formatter or lint rules. Fix: automate style; reviewers ignore it.
4. **The same comment appears in every PR.** Cause: a missing rule or shared component. Fix: add a lint rule, a script check or a design-system part.
5. **Approving tests that test nothing.** Cause: checking that tests exist, not what they assert. Fix: read assertions; ask "would this fail if the feature broke?"
6. **Memoization requested everywhere.** Cause: performance by habit. Fix: ask for a measurement; with the React Compiler, remove manual memoization.
7. **A reviewer rewrites the PR in comments.** Cause: preference presented as requirement. Fix: label preferences as nits or leave them out.

## Pre-merge checklist for the reviewer

1. The change does what the description says; the main behaviour has tests.
2. Effects, keys, state ownership and async races are correct.
3. Loading, error, empty and success states exist; inputs survive errors.
4. Keyboard, names, alt text and announcements are correct.
5. No unsanitized HTML, unsafe URLs, client secrets or client-only authorization.
6. No `any`, unchecked casts or unvalidated external data.
7. Boundaries respected; bundle impact of new code and dependencies known.
8. `pr-scan.mjs` blockers resolved; CI green.

See also: react-hooks-and-effects, react-accessibility, react-security, react-testing, react-architecture, react-ci-quality-gates.
