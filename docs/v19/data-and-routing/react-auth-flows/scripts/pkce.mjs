#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Generates OAuth 2.0 PKCE values (RFC 7636) plus state and nonce, computes the S256 challenge for a given
// verifier, and optionally builds an authorization URL for manual testing. Uses only Node's built-in crypto.
// Usage:
//   node pkce.mjs                                   print a new verifier, challenge, state and nonce as JSON
//   node pkce.mjs --verifier <v>                    print the S256 challenge for an existing verifier
//   node pkce.mjs --authorize <url> --client-id <id> --redirect-uri <uri> [--scope "openid profile email"]
//                                                   also print an authorization URL with the new values
//   node pkce.mjs --self-test                       check against the RFC 7636 Appendix B test vector
// Exit code: 0 on success, 1 when the self-test fails, 2 on a usage error.
import { createHash, randomBytes } from 'node:crypto'

const args = process.argv.slice(2)
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node pkce.mjs [--verifier V] [--authorize URL --client-id ID --redirect-uri URI [--scope S]] [--self-test]')
  process.exit(0)
}

const base64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const challengeFor = (verifier) => base64url(createHash('sha256').update(verifier, 'ascii').digest())
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/        // RFC 7636 section 4.1: unreserved characters, 43 to 128 long

if (args.includes('--self-test')) {
  // RFC 7636 Appendix B
  const v = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
  const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  const got = challengeFor(v)
  const fresh = base64url(randomBytes(32))
  const ok = got === expected && VERIFIER_RE.test(fresh) && fresh.length === 43
  console.log(ok ? 'PKCE self-test passed (RFC 7636 Appendix B).' : `PKCE self-test FAILED: expected ${expected}, got ${got}`)
  process.exit(ok ? 0 : 1)
}

const given = opt('--verifier')
if (given !== undefined) {
  if (!VERIFIER_RE.test(given)) { console.error('The verifier must be 43 to 128 characters of A-Z a-z 0-9 - . _ ~'); process.exit(2) }
  console.log(JSON.stringify({ code_verifier: given, code_challenge: challengeFor(given), code_challenge_method: 'S256' }, null, 2))
  process.exit(0)
}

const verifier = base64url(randomBytes(32))             // 32 random bytes -> 43 characters, 256 bits of entropy
const values = {
  code_verifier: verifier,
  code_challenge: challengeFor(verifier),
  code_challenge_method: 'S256',
  state: base64url(randomBytes(16)),
  nonce: base64url(randomBytes(16)),
}

const authorize = opt('--authorize')
if (authorize) {
  const clientId = opt('--client-id'), redirectUri = opt('--redirect-uri')
  if (!clientId || !redirectUri) { console.error('--authorize needs --client-id and --redirect-uri'); process.exit(2) }
  let url
  try { url = new URL(authorize) } catch { console.error(`Not a URL: ${authorize}`); process.exit(2) }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') console.error('Warning: the authorization endpoint is not HTTPS.')
  url.search = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: opt('--scope') ?? 'openid profile email',
    state: values.state, nonce: values.nonce, code_challenge: values.code_challenge, code_challenge_method: 'S256',
  }).toString()
  values.authorization_url = url.toString()
}
console.log(JSON.stringify(values, null, 2))
