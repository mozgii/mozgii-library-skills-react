---
title: OIDC with PKCE, the BFF pattern and oidc-client-ts
author: MOZGII, Inc.
lang: en
---

# OIDC with PKCE, the BFF pattern and oidc-client-ts

Server and client code for the two OAuth architectures a React app uses most: a backend-for-frontend that keeps tokens on the server, and a browser-only OpenID Connect client with `oidc-client-ts`. Sources: RFC 10017 (OAuth 2.0 for Browser-Based Applications, BCP 212), RFC 9700 (OAuth 2.0 Security Best Current Practice), RFC 7636 (PKCE), OpenID Connect Core 1.0, and the `openid-client` 6 and `oidc-client-ts` 3 type definitions.

## The backend-for-frontend (BFF) pattern

A BFF is a small server on the same site as the React app. It is a confidential OAuth client: it runs the authorization code flow with PKCE, stores the tokens in its session store, gives the browser only an `HttpOnly` session cookie, and proxies API calls, attaching the access token. The browser cannot leak a token it never had.

| BFF endpoint | Does |
|---|---|
| `GET /bff/login?returnTo=` | creates verifier, state and nonce in a short-lived server record, redirects to the provider |
| `GET /bff/callback` | checks state, exchanges the code with the verifier, validates the ID token, creates the session, sets the cookie, redirects to `returnTo` |
| `GET /bff/user` | returns the signed-in user's profile, or 401 |
| `POST /bff/refresh` | refreshes the access token with the stored refresh token (often done transparently by the proxy) |
| `POST /bff/logout` | deletes the session, revokes tokens, optionally returns the provider's end-session URL |
| `/api/*` | proxies to the resource server with `Authorization: Bearer <access token>` |

## BFF login and callback with openid-client 6

`openid-client` 6 discovers the provider's endpoints and implements PKCE, state and nonce checks. Framework-neutral handlers (adapt the request and response objects to your server):

```ts
import * as client from 'openid-client'

const config = await client.discovery(new URL(process.env.OIDC_ISSUER!), process.env.OIDC_CLIENT_ID!, process.env.OIDC_CLIENT_SECRET!)
const REDIRECT_URI = 'https://app.example.com/bff/callback'
const APP_ORIGIN = new URL(REDIRECT_URI).origin

// the return path after sign-in: only a path on our own origin, never the raw input
export function safeReturnTo(raw: string | null, origin = APP_ORIGIN): string {
  if (!raw) return '/'
  let url: URL
  try { url = new URL(raw, origin) } catch { return '/' }
  if (url.origin !== origin || url.pathname.startsWith('//')) return '/'   // evil.example, javascript:, "/.//evil.example"
  return url.pathname + url.search + url.hash
}

export async function login(returnTo: string) {
  const code_verifier = client.randomPKCECodeVerifier()
  const state = client.randomState()
  const nonce = client.randomNonce()
  await loginStore.put(state, { code_verifier, nonce, returnTo: safeReturnTo(returnTo) }, { ttlSeconds: 600 })
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: REDIRECT_URI, scope: 'openid profile email offline_access',
    code_challenge: await client.calculatePKCECodeChallenge(code_verifier), code_challenge_method: 'S256', state, nonce,
  })
  return redirect(url.href)
}

export async function callback(currentUrl: URL) {
  const state = currentUrl.searchParams.get('state') ?? ''
  const pending = await loginStore.take(state)                 // single use
  if (!pending) return redirect('/login?error=expired')
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: pending.code_verifier, expectedState: state, expectedNonce: pending.nonce,
  }).catch(() => null)                                         // a provider denial (?error=access_denied) or a bad code throws
  if (!tokens) return redirect('/login?error=failed')
  const claims = tokens.claims()!                              // validated ID token claims
  const sessionId = await sessions.create({ sub: claims.sub, tokens, expiresAt: Date.now() + 8 * 3600_000 })
  return redirect(pending.returnTo, {
    'Set-Cookie': `__Host-session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`,
  })
}
```

On every proxied request, refresh the access token with `client.refreshTokenGrant(config, refreshToken)` when it is about to expire, and store the rotated refresh token. Rotate the session id after login to prevent session fixation.

## Browser-only OIDC with oidc-client-ts and react-oidc-context

Without a backend, the SPA is a public client. `oidc-client-ts` runs the authorization code flow with PKCE by default; `react-oidc-context` wraps it in a provider and hooks:

```tsx
import { AuthProvider, useAuth, hasAuthParams } from 'react-oidc-context'
import { InMemoryWebStorage, WebStorageStateStore } from 'oidc-client-ts'

const oidcConfig = {
  authority: 'https://id.example.com',
  client_id: 'spa-client',
  redirect_uri: `${location.origin}/callback`,
  post_logout_redirect_uri: `${location.origin}/`,
  scope: 'openid profile email',
  automaticSilentRenew: true,
  userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),   // tokens in memory, never in web storage
  onSigninCallback: () => { history.replaceState({}, document.title, location.pathname) },  // remove ?code&state from the URL
}

createRoot(root).render(<AuthProvider {...oidcConfig}><App /></AuthProvider>)

function App() {
  const auth = useAuth()
  if (auth.isLoading) return <p role="status">Signing in…</p>
  if (auth.error) return <p role="alert">Sign-in failed: {auth.error.message}</p>
  if (!auth.isAuthenticated) return <button type="button" onClick={() => void auth.signinRedirect()}>Sign in</button>
  return <Dashboard token={auth.user?.access_token} onSignOut={() => void auth.signoutRedirect()} />
}
```

- The in-memory store empties on reload, so a reload re-authenticates: the person goes through the provider again, without a password prompt while the provider's session lasts.
- `hasAuthParams()` tells you the current URL is a callback; `useAutoSignin` starts a sign-in automatically when needed.
- Keep access token lifetimes short (5 to 15 minutes) and ask the provider for refresh token rotation.
- A strict Content Security Policy is required: any script injection can call the API with the user's tokens while the page is open.

## Choosing scopes and claims

Ask for the minimum: `openid` for an ID token, `profile` and `email` for the user's name and address, `offline_access` only when the client needs a refresh token. Read user identity from the ID token's `sub` claim (stable per provider), never from the email address, which can change or be reused.

## Silent renew and third-party cookies

Older SPAs renewed tokens in a hidden iframe (`prompt=none`), which depends on the provider's cookies inside a third-party iframe. Browsers increasingly block third-party cookies, so iframe renew fails silently. Use refresh tokens with rotation for browser clients, or move to a BFF, whose cookies are first-party.

## Session lifetime and idle timeout

Set two limits on the server: an idle timeout (for example 30 minutes without requests) and an absolute lifetime (for example 8 to 12 hours). Warn the user a minute before the idle timeout with an accessible dialog offering "Stay signed in"; after it, redirect to login with `returnTo` so work resumes where it was.

## Multi-factor and step-up authentication

For sensitive actions (changing the email, payouts), require a recent authentication: the server checks the `auth_time` or `amr` claim, and if it is too old the client starts a new authorization request with `max_age=0` or `prompt=login` (and `acr_values` for MFA, depending on the provider), returning to the action afterwards.
