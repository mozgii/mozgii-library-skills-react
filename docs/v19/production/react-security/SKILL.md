---
name: react-security
description: Secures client-side React apps - what JSX escaping protects and what it does not, dangerouslySetInnerHTML with DOMPurify, user-supplied URLs and React 19's blocking of javascript URLs, spreading untrusted props, secrets that leak through VITE_ variables and source maps, where to keep auth tokens, CSRF with cookies, open redirects after login, Content Security Policy and Trusted Types, postMessage and iframes, and supply-chain hygiene for npm dependencies. Use when rendering HTML or Markdown from users or a CMS, storing a JWT, adding a login redirect, writing a CSP, reviewing a React app for XSS, or when a security scanner flags the frontend or React's Server Components packages (patched releases and advisories included).
metadata:
  tags:
  - react
  - security
  - xss
  - csp
  - dompurify
  - auth
  - csrf
  - supply-chain
---

# React security

React escapes everything it renders as text, which removes the most common cross-site scripting (XSS) bug by default. The holes that remain are the places where code opts out of escaping or trusts data it should not: raw HTML, URLs, spread props, tokens readable by scripts, and dependencies. This skill covers those for a client-rendered React 19.3 app. The server and the API still decide what a user may do; nothing in the browser enforces it.

## Step 0: read the installed React and sanitizer versions

React's own protections (blocking `javascript:` URLs) and the sanitizer's fixes depend on the installed versions, so read them before reviewing code, from the project root:

```bash
node -p "['react','react-dom','dompurify','react-router','vite'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `react` 19.3.1, `dompurify` 3.4.17, `react-router` 8.5.1, `vite` 8.3.5. Then `npm audit --omit=dev` (or `pnpm audit --prod`) lists known advisories in what ships.

## Choose how to render untrusted content

Choosing how to render content you did not write is the main XSS decision in a React app. Take the narrowest row that still shows what the product needs:

| The content | Render it with | Why the alternatives lose |
|---|---|---|
| Plain text (names, comments, titles) | JSX text: `{value}` | anything else adds a way to run markup for no gain |
| Markdown from users | `react-markdown` without raw HTML | converting Markdown to an HTML string and injecting it needs a sanitizer and can still smuggle tags |
| HTML from a CMS, an email or a rich-text editor | DOMPurify, then `dangerouslySetInnerHTML` (with Trusted Types where supported) | a regular-expression sanitizer is defeated by parser quirks |
| A full untrusted document or a third-party widget that must run its own scripts | `<iframe sandbox="allow-scripts">` without `allow-same-origin` | a sanitizer removes the scripts the widget needs; same-origin frames reach your cookies and DOM |
| A URL for `href` or `src` | a protocol allowlist (`safeUrl`) | React blocks only `javascript:`; `data:` and odd schemes pass |
| Configuration that becomes props | a schema, mapped to typed props | spreading an object lets it set `dangerouslySetInnerHTML`, `href` or handlers |

## What React escapes and what it does not

React escapes strings in JSX children and attribute values, so `<p>{comment}</p>` shows `<script>` as text. It does not protect these, which are where React XSS bugs come from:

| Sink | Why it is dangerous | Safe default |
|---|---|---|
| `dangerouslySetInnerHTML` | inserts HTML as is | sanitize with DOMPurify, or render Markdown without raw HTML |
| `href`, `src`, `formAction` from data | `data:`, `vbscript:` and unexpected schemes; React 19 blocks only `javascript:` in links and form actions | allowlist protocols with `new URL` |
| `{...props}` from an API or URL | can set `dangerouslySetInnerHTML`, `href`, event handlers | pick known fields |
| `ref.current.innerHTML`, `insertAdjacentHTML`, `document.write` | DOM APIs bypass React | text APIs (`textContent`) or sanitize |
| `eval`, `new Function`, `setTimeout('code')` | run strings as code | never with data |
| Third-party scripts and widgets | run with your page's privileges | load few, from trusted origins, under CSP |

## Render HTML from users or a CMS with DOMPurify

HTML from users, a CMS or an email must be sanitized before `dangerouslySetInnerHTML`, because it can carry scripts, event handler attributes and malicious links. DOMPurify removes them and keeps formatting:

```bash
npm i dompurify
```

```tsx
import DOMPurify from 'dompurify'

export function RichText({ html }: { html: string }) {
  const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form'] })
  return <div className="prose" dangerouslySetInnerHTML={{ __html: clean }} />
}
```

- Sanitize right before rendering, in the browser, with the installed DOMPurify version; sanitizing once on save misses bugs fixed later.
- Add `rel="noopener noreferrer"` and `target` rules with a DOMPurify `afterSanitizeAttributes` hook when links open new tabs.
- For Markdown, `react-markdown` renders to React elements and ignores raw HTML by default, which is safer than converting to HTML and injecting it. If raw HTML is required, add `rehype-raw` followed by `rehype-sanitize`.
- Never sanitize with a regular expression; HTML parsing quirks defeat it.

## User-supplied URLs in links and images

A link or image URL that comes from data must be checked by its protocol. React 19 replaces `javascript:` URLs in `href` and form actions with a URL that throws, but `data:text/html` links, custom schemes and URLs to other sites pass through:

```ts
// src/shared/lib/safe-url.ts
const allowed = new Set(['http:', 'https:', 'mailto:'])

export function safeUrl(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined
  try {
    const url = new URL(raw, window.location.origin)
    return allowed.has(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
```

```tsx
const href = safeUrl(profile.website)
{href ? <a href={href} target="_blank" rel="noopener noreferrer">{profile.website}</a> : <span>{profile.website}</span>}
```

- Images: allow `https:` (and `data:image/` only if you generate it); a user avatar URL can track readers, so proxy it when privacy matters.
- `new URL(raw, origin)` also resolves relative paths, so check `url.origin` when only same-site links are allowed.

## Open redirects after login

An open redirect is a `?next=` or `?returnTo=` parameter that sends people to any site after login, which phishing pages use to borrow your domain. Accept only paths on your own origin:

```ts
export function safeNext(raw: string | null, origin: string = window.location.origin): string {
  if (!raw) return '/'
  let url: URL
  try { url = new URL(raw, origin) } catch { return '/' }
  if (url.origin !== origin || url.pathname.startsWith('//')) return '/'
  return url.pathname + url.search + url.hash
}
// after sign-in: navigate(safeNext(params.get('next')), { replace: true })
```

The URL parser decides, not a prefix check. `//evil.example` and `/\evil.example` are protocol-relative URLs that browsers treat as other hosts, and the parser drops tabs and newlines, so `/\t/evil.example` is one too: all three resolve to another origin and are refused. `/.//evil.example` stays on your origin but normalizes to the path `//evil.example`, which would be protocol-relative once you redirect to it, hence the `//` check on the resolved path.

## Never spread untrusted objects into JSX

Spreading an object into JSX passes every key as a prop, so an object from an API, a URL parser or `JSON.parse` can set `dangerouslySetInnerHTML`, `href`, `style` or `ref`:

```tsx
// Wrong: settings come from the server or the URL
<div {...widget.props} />

// Right: copy the fields the component supports
<Widget title={String(widget.props.title ?? '')} tone={widget.props.tone === 'warning' ? 'warning' : 'info'} />
```

Validate any data-driven configuration with a schema (Zod) at the boundary, and map it to typed props.

## Secrets in the client bundle

Everything in a client bundle is public: anyone can read it in DevTools. Vite inlines `import.meta.env.VITE_*` values into the JavaScript at build time, so a `VITE_` variable is a published value, never a secret:

- API keys that cost money or grant access (OpenAI, Stripe secret keys, database URLs) stay on a server; the browser calls your backend, which calls the service.
- Publishable keys meant for browsers (Stripe publishable keys, Firebase web config, map keys restricted by referrer) are fine in `VITE_` variables.
- Source maps publish your original source. Use `build.sourcemap: 'hidden'` and upload maps to your error tracker instead of serving them.
- Search the built output before release: `grep -rE "sk_live|BEGIN PRIVATE KEY|postgres://" dist/` should find nothing.

## Where to keep auth tokens

Auth tokens readable by JavaScript are readable by any injected script, so storage is a trade-off between XSS and CSRF exposure. In order of preference:

1. **httpOnly session cookie** set by your server (or a backend-for-frontend that holds the OAuth tokens): scripts cannot read it. Use `Secure`, `SameSite=Lax` or `Strict`, and protect writes against CSRF (next section).
2. **Access token in memory, refresh token in an httpOnly cookie**: a page reload calls a refresh endpoint; an XSS can still use the token while the page is open, but cannot steal a long-lived one.
3. **`localStorage`**: survives reloads and is the easiest, and every script on the page can read it. Avoid it for tokens that grant long access.

- With OAuth or OpenID Connect in a pure SPA, use the authorization code flow with PKCE through a maintained client library; the implicit flow is deprecated.
- On sign-out, clear the query cache (`queryClient.clear()`) and stores, so the next user on the device sees nothing of the previous one.
- Route guards and hidden buttons are user experience only; the API checks permissions on every request.
- Full sign-in flows (OIDC with PKCE through `oidc-client-ts`, refresh, multi-tab sign-out): `react-auth-flows`.

## CSRF protection with cookie sessions

Cross-site request forgery (CSRF) makes a signed-in user's browser send a request your site did not ask for; cookies ride along automatically. With cookie sessions:

- Set `SameSite` explicitly. `Lax` is the default only in some browsers, and a browser that applies it as a default still sends the cookie on a cross-site POST within two minutes of setting it. An explicit `SameSite=Lax` blocks cross-site POSTs from forms and `fetch`; `Strict` also blocks top-level cross-site navigations carrying the cookie.
- Add a CSRF token for state-changing requests, or require a custom header such as `X-Requested-With` together with a CORS policy that rejects other origins, so a plain cross-site form cannot send it.
- Never change state on `GET`; links and image tags can trigger `GET` from anywhere.
- Bearer tokens sent in an `Authorization` header are not sent automatically, so they are not exposed to CSRF (their risk is XSS).

## Content Security Policy for a Vite app

A Content Security Policy (CSP) tells the browser which scripts, styles and connections the page may use, so an injected `<script>` does not run even if markup slips through. Send it as an HTTP header from the host:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:;
  connect-src 'self' https://api.example.com; frame-ancestors 'none'; base-uri 'self'; object-src 'none';
  require-trusted-types-for 'script'
```

- A production Vite build has no inline scripts, so `script-src 'self'` works. An inline theme script in `index.html` needs its hash in `script-src` (`'sha256-…'`), or move it to a file.
- Client-rendered React sets the `style` prop through the CSSOM, which `style-src` allows; server-rendered `style` attributes would need `'unsafe-inline'`.
- Start with `Content-Security-Policy-Report-Only` and a reporting endpoint, fix what it reports, then enforce.
- `frame-ancestors 'none'` stops other sites from framing yours (clickjacking).

## Trusted Types with React 19.3

Trusted Types make the browser reject strings in HTML sinks (`innerHTML`, `dangerouslySetInnerHTML`) unless they come from a policy you wrote, which turns a forgotten sanitize call into an error instead of an XSS. React 19.3 integrates with Trusted Types, so with `require-trusted-types-for 'script'` in the CSP, pass a `TrustedHTML` value:

```tsx
import DOMPurify from 'dompurify'
const clean = DOMPurify.sanitize(html, { RETURN_TRUSTED_TYPE: true })     // TrustedHTML where supported
<div dangerouslySetInnerHTML={{ __html: clean }} />                     // @types/react accepts string | TrustedHTML
```

Roll it out in report-only mode first: libraries that write `innerHTML` directly will show up there. Browsers without Trusted Types ignore the directive.

## postMessage, iframes and embedded content

Messages from other windows and frames can come from any origin, so check where each one came from before acting on it:

```ts
window.addEventListener('message', (e) => {
  if (e.origin !== 'https://payments.example.com') return
  const msg = PaymentMessage.safeParse(e.data)            // validate the shape too
  if (msg.success) handlePayment(msg.data)
})
```

- Send with an explicit target origin: `frame.contentWindow?.postMessage(data, 'https://payments.example.com')`, never `'*'` with private data.
- Embed untrusted content in `<iframe sandbox="allow-scripts">` without `allow-same-origin`, so it cannot reach your cookies or DOM.

## Dependencies and the npm supply chain

Every npm package runs with your page's privileges, and install scripts run on developer machines and CI. Attacks through hijacked packages are routine, so:

- Commit the lockfile and install with `npm ci` (or `pnpm install --frozen-lockfile`) in CI.
- Block install scripts by default: pnpm 10 runs dependency lifecycle scripts only for packages you approve; with npm, `npm config set ignore-scripts true` and allow the few that need them.
- Run `npm audit` (or the platform's scanner) in CI and update React itself promptly. Client-only Vite apps do not ship React's server packages; any app on a Server Components framework must stay on the patched releases in the table below.
- Prefer few, well-maintained dependencies; check a new package's maintainers, downloads and install scripts before adding it.
- Load third-party scripts from your own build or with Subresource Integrity (`integrity="sha384-…"`).

## Patched React releases for Server Components

React's Server Components code lives in `react-server-dom-webpack`, `react-server-dom-parcel` and `react-server-dom-turbopack`, and frameworks such as Next.js bundle their own copy. A client-only Vite app contains none of it, so these advisories do not reach it. A Server Components app needs at least `19.3.1`, `19.2.9`, `19.1.10` or `19.0.9` on its release line (all from October 14, 2026): anything older on those lines has an open advisory.

| Published | Advisory | Severity | Impact | Fixed in |
|---|---|---|---|---|
| 2026-10-14 | GHSA-xqc2-xf4c-x3h3 | critical | remote code execution without a login, in rare responses that carry several typed arrays plus an attacker-controlled value | 19.3.1, 19.2.9, 19.1.10, 19.0.9 |
| 2026-10-14 | GHSA-h3gv-c5rc-p453 | high | denial of service through Server Function requests | 19.3.1, 19.2.9, 19.1.10, 19.0.9 |
| 2026-07-21 | CVE-2026-44907 | high | denial of service through Server Function requests | 19.2.8, 19.1.9, 19.0.8 |
| 2026-05-06 | CVE-2026-23870 | high | denial of service | 19.2.6, 19.1.7, 19.0.6 |
| 2026-04-08 | CVE-2026-23869 | high | denial of service, up to a minute of CPU per request | 19.2.5, 19.1.6, 19.0.5 |
| 2026-01-26 | CVE-2026-23864 | high | denial of service | 19.2.4, 19.1.5, 19.0.4 |
| 2025-12-12 | CVE-2025-67779 | high | denial of service; completes the fix for CVE-2025-55184 | 19.2.3, 19.1.4, 19.0.3 |
| 2025-12-11 | CVE-2025-55184 | high | denial of service | 19.2.2, 19.1.3, 19.0.2 |
| 2025-12-11 | CVE-2025-55183 | medium | source code of Server Functions exposed | 19.2.2, 19.1.3, 19.0.2 |
| 2025-12-03 | CVE-2025-55182 (React2Shell) | critical | remote code execution without a login, CVSS 10.0 | 19.2.1, 19.1.2, 19.0.1 |

This table ages, so read the live list before a release. On Next.js, `npm ls` shows no `react-server-dom-*` package because the framework carries its own build; follow the framework's advisories as well:

```bash
gh api repos/react/react/security-advisories --jq '.[] | [.published_at[:10], .severity, (.cve_id // .ghsa_id), .summary] | @tsv'
npm ls react-server-dom-webpack react-server-dom-parcel react-server-dom-turbopack next
```

`npm audit` misses the two React advisories of October 14, 2026 (GHSA-xqc2-xf4c-x3h3 and GHSA-h3gv-c5rc-p453): as of October 31, 2026 they are in the `react/react` repository but not in the GitHub Advisory Database the audit reads. A clean audit says nothing about them, so check the installed `react-server-dom-*` versions against the "Fixed in" column of the patched releases table or the `react/react` list.

`next` 16.4.1 (October 14, 2026) fixed two critical remote code execution flaws of its own, GHSA-673q-mjm6-r5xr (`use cache` functions that return typed arrays) and GHSA-2464-fhr4-w9xw (the Image Optimization API with SVG files), plus GHSA-p3m5-59mp-jv5r, a denial of service through Server Actions. The 16.3.x line has no fix for GHSA-673q-mjm6-r5xr, so a 16.x app moves to 16.4.1 or newer. On 15.x, `next` 15.5.28 fixes GHSA-2464-fhr4-w9xw and GHSA-p3m5-59mp-jv5r; GHSA-673q-mjm6-r5xr affects 16.0.0 and later only. Apps on 13 or 14 have no fix on their own line for GHSA-2464-fhr4-w9xw and GHSA-p3m5-59mp-jv5r: the advisories name only 15.5.28 and 16.4.1 as patched, so those apps must move to 15.5.28 or newer.

## Worked example: a comment list that renders user content safely

A worked example that applies the rules to one screen: comments from users carry sanitized HTML bodies and an optional website, and the list has loading, error and empty states. The body goes through DOMPurify, the link through `safeUrl`, and nothing from the API is spread into JSX:

```tsx
// src/features/comments/CommentList.tsx
import DOMPurify from 'dompurify'
import { safeUrl } from '@/shared/lib/safe-url'

type Comment = { id: string; author: string; website?: string; bodyHtml: string; createdAt: string }
export type CommentsState = { status: 'loading' } | { status: 'error'; onRetry: () => void } | { status: 'ready'; comments: readonly Comment[] }

const sanitize = (html: string) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'img'] })

export function CommentList({ state }: { state: CommentsState }) {
  if (state.status === 'loading') return <p role="status">Loading comments…</p>
  if (state.status === 'error') return <div role="alert"><p>Comments could not be loaded.</p><button type="button" onClick={state.onRetry}>Try again</button></div>
  if (state.comments.length === 0) return <p>No comments yet. Be the first to reply.</p>
  return (
    <ol aria-label="Comments">
      {state.comments.map((c) => {
        const href = safeUrl(c.website)
        return (
          <li key={c.id}>
            <p>
              {href ? <a href={href} target="_blank" rel="noopener noreferrer ugc">{c.author}</a> : <span>{c.author}</span>}{' '}
              <time dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleDateString()}</time>
            </p>
            <div className="prose" dangerouslySetInnerHTML={{ __html: sanitize(c.bodyHtml) }} />
          </li>
        )
      })}
    </ol>
  )
}
```

- `img` is forbidden in comment bodies here, so a comment cannot load a tracking pixel; allow it only through a proxy when the product needs images.
- `rel="ugc"` marks user links for search engines; `noopener noreferrer` keeps the opened page away from `window.opener`.

## Verify React security

Security is proven against the built output and with hostile input, not by reading the source. Run:

```bash
npm run build && sh <this-skill>/scripts/scan-bundle.sh dist   # secrets, referenced source maps, inline scripts; exit 0 when clean
grep -rn "dangerouslySetInnerHTML" src | grep -v sanitize       # every hit must receive sanitized or TrustedHTML input
npm audit --omit=dev --audit-level=high                         # known vulnerable runtime dependencies
npm ls react-server-dom-webpack react-server-dom-parcel react-server-dom-turbopack next   # Server Components apps: at or above the patched releases
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

A clean `npm audit` does not cover the React advisories of October 14, 2026 (GHSA-xqc2-xf4c-x3h3 and GHSA-h3gv-c5rc-p453), which were missing from the GitHub Advisory Database it reads as of October 31, 2026. Compare the `npm ls` versions with the table in "Patched React releases for Server Components", or read the `react/react` advisories.

```tsx
// a hostile-input test for the worked example
test('strips scripts and dangerous links from comments', () => {
  const evil = { id: '1', author: 'x', website: 'javascript:alert(1)', bodyHtml: '<img src=x onerror=alert(1)><b>hi</b>', createdAt: '2026-10-01T00:00:00Z' }
  const { container } = render(<CommentList state={{ status: 'ready', comments: [evil] }} />)
  expect(container.querySelector('img, [onerror]')).toBeNull()
  expect(screen.getByText('hi').tagName).toBe('B')
  expect(screen.queryByRole('link')).toBeNull()                 // the javascript: website rendered as text
})
```

- Deploy with `Content-Security-Policy-Report-Only` first and read the reports; then enforce. Check the header with `curl -sI https://<host>/ | grep -i content-security-policy`.
- Sign in as one user, sign out, sign in as another on the same tab: no data from the first account appears.
- Try `?next=//evil.example` and `?next=/\evil.example` on the login page: both land on `/`. Then check the function itself with node: `//evil.example`, `/\t/evil.example`, `/\n/evil.example`, `https://evil.example`, `javascript:alert(1)` and `/.//evil.example` must all return `/`, and `/projects/42?tab=files` must come back unchanged (paste `safeNext` without its types and call it with `'https://app.example.com'` as the origin).

## Pre-merge checklist for React security

Check each point before merging code that renders, links or stores anything untrusted.

1. Every `dangerouslySetInnerHTML` receives DOMPurify output (or a Trusted Types policy); Markdown renders without raw HTML.
2. URLs from data pass a protocol allowlist; `?next=` accepts same-origin paths only.
3. No untrusted object is spread into JSX.
4. No secret in `VITE_` variables, the bundle or served source maps.
5. Tokens in httpOnly cookies or memory; sign-out clears caches; the API authorizes every request.
6. Cookie sessions use `SameSite` and a CSRF token or custom header for writes.
7. A CSP header is enforced (after a report-only phase), with `frame-ancestors`.
8. `postMessage` handlers check `origin` and validate data.
9. Lockfile, `npm ci`, blocked install scripts and audits in CI.
10. A Server Components app runs a patched React release and, on Next.js, a patched `next`; the live advisory list was read for this release.

## Gotchas and anti-patterns in React security

Each entry gives the symptom you see, its cause and the fix.

1. **`React has blocked a javascript: URL as a security precaution.`** Cause: React 19 refuses `javascript:` in `href`. Fix: use a `<button onClick>` for actions; validate URLs from data with an allowlist.
2. **A comment with `<img src=x onerror=alert(1)>` runs script.** Cause: user HTML rendered with `dangerouslySetInnerHTML` unsanitized. Fix: `DOMPurify.sanitize`.
3. **An API key appears in the built JavaScript.** Cause: it was in a `VITE_` variable. Fix: move the call behind your backend and rotate the key.
4. **Login redirects to another site.** Cause: an unchecked `?next=` URL, including `//host` forms. Fix: resolve it with `new URL(raw, origin)`, accept it only when the origin is yours and the path does not start with `//`.
5. **The CSP breaks the app on deploy.** Cause: an inline script (theme bootstrap, analytics snippet) or a missing `connect-src` origin. Fix: hash or externalize the script, list API origins, test in report-only first.
6. **After sign-out the next user briefly sees the old account's data.** Cause: the query cache and stores outlive the session. Fix: `queryClient.clear()` and reset stores on sign-out.
7. **`dangerouslySetInnerHTML` throws a TypeError after enabling Trusted Types.** Cause: a plain string reached an HTML sink. Fix: return `TrustedHTML` from DOMPurify (`RETURN_TRUSTED_TYPE: true`) or a named policy.
8. **Anti-pattern: hiding admin buttons as the access control.** Symptom: a user calls the admin API from DevTools and it works. Cause: the check exists only in the UI. Fix: the API authorizes every request; the UI only mirrors it.
9. **Anti-pattern: a long-lived token in `localStorage`.** Symptom: one XSS anywhere leaks sessions that stay valid for weeks. Cause: every script on the page can read storage. Fix: an httpOnly cookie, or a short-lived token in memory with refresh through an httpOnly cookie.
10. **The scanner flags React's server packages again a few weeks after you patched.** Cause: critical fixes attract follow-up research, and 19.2.3, 19.1.4 and 19.0.3 turned out to be incomplete fixes. Fix: treat a patch as a recurring job, read the live advisory list and move to the newest release on your line.

Facts here were checked against the React 19.3 release notes, the DOMPurify documentation (Apache-2.0 or MPL-2.0) and the OWASP Cheat Sheet Series (linked, not copied: https://cheatsheetseries.owasp.org); the text and examples are original.

## See also

- `react-auth-flows`: sign-in, OAuth and OIDC with PKCE, session refresh, sign-out and route protection.
- `react-build-and-deploy` (security headers on the host), `react-error-handling` (no personal data in reports).
