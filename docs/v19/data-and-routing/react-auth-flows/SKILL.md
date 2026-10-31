---
name: react-auth-flows
description: Builds authentication in React apps safely - choosing between a session cookie, the backend-for-frontend (BFF) pattern and a browser OAuth client per RFC 10017, the OAuth 2.0 authorization code flow with PKCE, state and nonce, OpenID Connect sign-in with oidc-client-ts, login forms and passkeys, protected routes that redirect and come back, token refresh with a single in-flight request, where tokens may live, cookie and CSRF settings, sign-out in every tab, and what the server must still enforce. Use when adding login, sign-in with Google, Microsoft or an OIDC provider, protecting routes, refreshing expired tokens, fixing redirect loops, deciding where to store tokens, or moving from localStorage tokens to a BFF.
metadata:
  tags:
  - react
  - authentication
  - oauth
  - oidc
  - pkce
  - bff
  - sessions
  - protected-routes
---

# React authentication flows

Authentication in a React app is a conversation between the browser, your backend and often an identity provider. The browser shows forms and follows redirects; it should hold as few secrets as possible. The current best practice for browser apps, published as RFC 10017 (BCP 212, August 2026), is the authorization code flow with PKCE, and its most secure architecture keeps tokens on a backend-for-frontend (BFF) and gives the browser only an `HttpOnly` session cookie. Client-side route guards are user experience; the server enforces access.

## Step 0: read the installed auth packages

Read what the project uses before adding a library:

```bash
node -p "['react','react-router','@tanstack/react-router','oidc-client-ts','react-oidc-context','openid-client','@simplewebauthn/browser'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
node <this-skill>/scripts/pkce.mjs --self-test        # checks the PKCE implementation against RFC 7636's test vector
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

Written against (October 2026): `oidc-client-ts` 3.5.0, `react-oidc-context` 3.3.1, `openid-client` 6.8.8 (server side), `react-router` 8.5.1. The implicit flow and the password grant are deprecated by the OAuth 2.0 Security BCP (RFC 9700): never use them in new code.

## Decision table: where authentication lives

| Architecture | Pick when | Tokens in the browser | Why the others lose |
|---|---|---|---|
| Session cookie from your own backend | your backend is the only API and does its own login | none, only an `HttpOnly` cookie | OAuth adds moving parts you do not need |
| Backend-for-frontend (BFF) with an identity provider | OIDC sign-in (Google, Microsoft, Okta, Keycloak) and an API that wants access tokens | none; the BFF stores tokens and proxies API calls | a browser client exposes tokens to any XSS |
| Browser OAuth client with PKCE (`oidc-client-ts`) | no backend you control (static hosting, third-party APIs that accept CORS tokens) | access token in memory, refresh token rotated | needs strict CSP and short token lifetimes; XSS can still use tokens while the page is open |
| Hosted auth SDK (a vendor's React components) | you accept the vendor's model and pricing | per vendor | ties login UI and data to the vendor |

RFC 10017 describes three architectures, from the BFF (tokens never reach the browser, the strongest protection) through a token-mediating backend to a pure browser client (exposed to any XSS). Pick the BFF when you can deploy a server next to the app.

## The authorization code flow with PKCE, state and nonce

Every OAuth sign-in follows the same steps, whether the browser or a BFF runs them:

1. Create a random `code_verifier` (43 to 128 characters), its `code_challenge = BASE64URL(SHA-256(verifier))`, a random `state`, and for OIDC a `nonce`. Store them for the callback (server session for a BFF, `sessionStorage` for a browser client).
2. Redirect to the provider's authorization endpoint with `response_type=code`, `client_id`, the exact registered `redirect_uri`, `scope`, `state`, `nonce`, `code_challenge` and `code_challenge_method=S256`.
3. On the callback, reject it unless `state` matches; exchange the `code` with the `code_verifier` at the token endpoint.
4. Validate the ID token (signature, issuer, audience, expiry, `nonce`), then create your session.

`state` stops login CSRF, PKCE stops a stolen code from being redeemed, and `nonce` binds the ID token to this sign-in. `node <this-skill>/scripts/pkce.mjs` prints a verifier, challenge, state and nonce, and builds an authorization URL for manual testing.

## Where tokens and sessions may live

| Storage | Readable by JS | Survives reload | Use for |
|---|---|---|---|
| `HttpOnly; Secure; SameSite` cookie | no | yes | the session id in cookie and BFF designs |
| Memory (a module variable) | yes, only this page | no | a browser client's access token |
| `sessionStorage` | yes | per tab | PKCE verifier and state during the redirect |
| `localStorage` | yes, by any script on the origin | yes | nothing secret: one XSS reads it forever |

Name session cookies with the `__Host-` prefix (forces `Secure`, `Path=/` and no `Domain`), keep `SameSite=Lax` (or `Strict`), and expire them on the server.

## Protected routes that redirect and come back

A route guard sends signed-out users to login and returns them afterwards. Pass the return path through the login, and accept it only when it resolves to your own origin, so it cannot become an open redirect. Prefix checks such as `startsWith('/') && !startsWith('//')` are not enough: the URL parser drops tabs and newlines and treats `\` as `/`, so `"/\t/evil.example"` passes the prefix check and the browser still lands on `evil.example`. Let the parser decide:

```ts
export function safeReturnTo(raw: string | null, origin: string = window.location.origin): string {
  if (!raw) return '/'
  let url: URL
  try { url = new URL(raw, origin) } catch { return '/' }
  // a different origin (evil.example, javascript:) or a path the browser would read as protocol-relative ("/.//evil.example")
  if (url.origin !== origin || url.pathname.startsWith('//')) return '/'
  return url.pathname + url.search + url.hash
}
```

The result is always a path on your origin (path, query and hash), never the raw input. On a server, pass the app's origin as the second argument.

- React Router 8: check the session in a parent route's middleware or loader and `throw redirect(`/login?returnTo=${encodeURIComponent(url.pathname + url.search)}`)`.
- TanStack Router: do the same in the parent route's `beforeLoad` and throw `redirect({ to: '/login', search: { returnTo } })`.
- Hide links the user cannot use, but never rely on hiding: every API call is authorized on the server.

## Token refresh with a single in-flight request

Access tokens expire after minutes. When several requests fail with 401 at once, refresh once and replay them, rather than starting one refresh per request (with rotating refresh tokens, parallel refreshes revoke each other):

```ts
let refreshing: Promise<void> | null = null
async function refreshSession(): Promise<void> {
  refreshing ??= fetch('/bff/refresh', { method: 'POST', credentials: 'include' })
    .then((r) => { if (!r.ok) throw new SessionExpiredError() })
    .finally(() => { refreshing = null })
  return refreshing
}

export async function api(input: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const res = await fetch(input, { ...init, credentials: 'include', headers: { 'X-Requested-With': 'fetch', ...init.headers } })
  if (res.status !== 401 || retried) return res
  await refreshSession()                      // throws SessionExpiredError when the refresh token is gone
  return api(input, init, true)
}
```

Many BFFs refresh transparently on each proxied request, so the browser never sees a 401 for an expired access token; keep the single-flight wrapper anyway for the session-expired case.

## CSRF protection for cookie sessions

A cookie session is sent automatically, so state-changing requests need CSRF protection: `SameSite=Lax` or `Strict` cookies block most cross-site sends; add a custom request header (`X-Requested-With`) or a CSRF token that the server checks on every non-GET request, and verify the `Origin` header. Never change state on GET.

## Login forms and passkeys

A password form uses `autocomplete="username"` and `autocomplete="current-password"`, `type="email"` or `text` for the identifier, shows one generic error ("Email or password is incorrect"), and never says which part was wrong. The server rate-limits by account and by IP. Passkeys (WebAuthn) remove passwords: the browser calls `navigator.credentials.create()` and `get()` with options from your server; libraries such as SimpleWebAuthn handle encoding. Add `autocomplete="username webauthn"` to the identifier field for passkey autofill.

## Sign-out everywhere

Sign-out clears the server session, then the client state:

1. `POST /bff/logout`: the server deletes the session, revokes the refresh token, and returns the provider's end-session URL if single sign-out is wanted.
2. Clear the query cache (`queryClient.clear()`) so the next user on the device cannot see cached data.
3. Tell other tabs: `new BroadcastChannel('auth').postMessage('logout')`; each tab clears its cache and navigates to login.

## Worked example: a BFF session with protected routes

A session hook backed by the BFF, a guard component with loading and error states, a login page that returns to the requested route, and sign-out across tabs:

```tsx
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

type User = { id: string; name: string; email: string }

async function getSession(signal: AbortSignal): Promise<User | null> {
  const res = await fetch('/bff/user', { credentials: 'include', signal })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`Session check failed: HTTP ${res.status}`)
  return res.json() as Promise<User>
}

export function useSession() {
  return useQuery({ queryKey: ['session'], queryFn: ({ signal }) => getSession(signal), staleTime: 5 * 60_000, retry: 1 })
}

export function RequireAuth() {
  const session = useSession()
  const location = useLocation()
  if (session.isPending) return <p role="status">Checking your session…</p>
  if (session.isError) return <div role="alert">We could not check your session. <button type="button" onClick={() => session.refetch()}>Retry</button></div>
  if (!session.data) return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <Outlet />
}

export function LoginPage() {
  const [params] = useSearchParams()
  const returnTo = safeReturnTo(params.get('returnTo'))
  const error = params.get('error')                      // set by the BFF callback on failure
  return (
    <main aria-labelledby="login-title">
      <h1 id="login-title">Sign in</h1>
      {error && <p role="alert">Sign-in did not complete. Please try again.</p>}
      {/* a full-page navigation: the BFF creates state, nonce and PKCE, then redirects to the provider */}
      <a className="btn" href={`/bff/login?returnTo=${encodeURIComponent(returnTo)}`}>Continue with your company account</a>
    </main>
  )
}

export function useSignOut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async () => { const r = await fetch('/bff/logout', { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'fetch' } }); if (!r.ok) throw new Error('Sign-out failed') },
    onSettled: () => { qc.clear(); new BroadcastChannel('auth').postMessage('logout'); location.assign('/login') },
  })
}

export function useCrossTabSignOut() {
  const qc = useQueryClient()
  useEffect(() => {
    const bus = new BroadcastChannel('auth')
    bus.onmessage = (e) => { if (e.data === 'logout') { qc.clear(); location.assign('/login') } }
    return () => bus.close()
  }, [qc])
}

function safeReturnTo(raw: string | null, origin: string = window.location.origin): string {
  if (!raw) return '/'
  let url: URL
  try { url = new URL(raw, origin) } catch { return '/' }
  if (url.origin !== origin || url.pathname.startsWith('//')) return '/'
  return url.pathname + url.search + url.hash
}
```

The browser never sees a token: `/bff/login` starts the PKCE flow on the server, `/bff/callback` exchanges the code and sets a `__Host-` session cookie, and API calls go through the BFF, which attaches the access token. The BFF endpoints and a browser-only `oidc-client-ts` setup: [oidc-pkce-and-bff.md](references/oidc-pkce-and-bff.md).

## Verify authentication flows

- `node <this-skill>/scripts/pkce.mjs --self-test` passes; a manual sign-in with a tampered `state` in the callback URL is rejected.
- Sign in from a deep link (`/projects/42?tab=settings`): you land back there.
- Every one of these return values must come back as `/`: `//evil.example`, `/\t/evil.example`, `/\n/evil.example`, `https://evil.example`, `javascript:alert(1)`, and also `/\\evil.example` and `/.//evil.example`. Run them through the function with node (paste `safeReturnTo` without its types into `check-return-to.mjs`):

```js
const origin = 'https://app.example.com'
const attacks = ['//evil.example', '/\t/evil.example', '/\n/evil.example', 'https://evil.example', 'javascript:alert(1)', '/\\evil.example', '/.//evil.example']
for (const a of attacks) if (safeReturnTo(a, origin) !== '/') throw new Error(`open redirect: ${JSON.stringify(a)}`)
if (safeReturnTo('/projects/42?tab=settings#files', origin) !== '/projects/42?tab=settings#files') throw new Error('deep link lost')
console.log('returnTo: all attack cases refused')
```
- Expire the access token (or shorten its lifetime): several parallel requests trigger exactly one refresh in the network panel.
- In DevTools Application: no tokens in `localStorage`, `sessionStorage` (after the callback) or readable cookies; the session cookie is `HttpOnly`, `Secure`, `SameSite`.
- Sign out in one tab: other tabs go to the login page and show no cached data.
- Call a protected API without a session from `curl`: it returns 401, whatever the UI shows.

## Gotchas and anti-patterns in auth flows

Each gotcha names the symptom, its cause and the fix.

1. **An attacker reads tokens through an XSS bug.** Cause: tokens in `localStorage`. Fix: a BFF with `HttpOnly` cookies, or in-memory tokens with a strict CSP.
2. **Login redirects to an attacker's site.** Cause: `returnTo` used without checks. Fix: resolve it with `new URL(raw, origin)`, accept it only when the origin is yours, and redirect to path + search + hash.
3. **Infinite redirect loop between the app and login.** Cause: the login route is itself protected, or the session check fails with an error treated as "signed out". Fix: keep login outside the guard; show errors separately from the signed-out state.
4. **Users are logged out at random under load.** Cause: parallel refreshes with rotating refresh tokens. Fix: one in-flight refresh shared by all requests.
5. **The callback fails with "state mismatch" in some tabs.** Cause: `state` stored in `localStorage` and overwritten by another tab's sign-in. Fix: per-tab `sessionStorage` or server-side storage keyed by `state`.
6. **"Invalid redirect_uri".** Cause: the URI differs from the registered one in scheme, port or trailing slash. Fix: register and send the exact same string.
7. **The previous user's data shows after sign-out.** Cause: the query cache was not cleared. Fix: `queryClient.clear()` on sign-out and on cross-tab logout.
8. **Hidden admin links, open admin API.** Cause: authorization only in the client. Fix: check roles on every server request.

## Pre-merge checklist for authentication

1. The architecture is chosen on purpose (cookie, BFF or browser client) and documented.
2. OAuth uses authorization code with PKCE (S256), `state` and `nonce`; no implicit or password grant.
3. No token in `localStorage`; cookies are `HttpOnly`, `Secure`, `SameSite`, `__Host-` prefixed.
4. `returnTo` is resolved against the app's origin and refused when it leaves it (the attack cases in Verify); login and callback routes are outside the guard.
5. Refresh is single-flight; session expiry leads to a clean sign-in, not a loop.
6. Non-GET requests carry CSRF protection; the server checks `Origin`.
7. Sign-out revokes server-side, clears caches and reaches other tabs.
8. Every protected API enforces authentication and authorization on the server.

See also: react-security, react-router-data-mode, tanstack-router, react-forms, react-realtime.
