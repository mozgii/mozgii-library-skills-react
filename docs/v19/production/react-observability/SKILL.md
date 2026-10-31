---
name: react-observability
description: Makes a React app's production behaviour visible - Sentry 11 for errors, traces, replays and logs with React 19 root error hooks and router instrumentation, the v11 dataCollection defaults and what to restrict, Core Web Vitals from real users with web-vitals 6 (LCP, INP, CLS, soft navigations, attribution) sent with sendBeacon, structured client logging with levels, context, sampling and redaction, hidden source maps uploaded with debug IDs, release and environment tagging, alerting on regressions per release, and privacy and consent. Use when adding error tracking, a stack trace in production is minified, INP or LCP is poor for real users but fine in the lab, adding logs from the browser, setting up release health, or when upgrading the Sentry SDK.
metadata:
  tags:
  - react
  - observability
  - sentry
  - web-vitals
  - logging
  - source-maps
  - monitoring
  - rum
---

# React observability

Observability answers "what happened to real users?" without asking them. A React app needs four signals: errors with readable stack traces and the release that caused them, performance measured in real browsers (Core Web Vitals), structured logs for the events that matter, and enough context (route, release, anonymized user) to connect them. Each signal must respect privacy and must not slow the app it measures.

## Step 0: read the installed monitoring packages

The Sentry SDK and web-vitals changed defaults in their latest majors, so read versions first:

```bash
node -p "['@sentry/react','@sentry/vite-plugin','web-vitals','react','react-router','@tanstack/react-router','vite'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
node <this-skill>/scripts/check-sourcemaps.mjs dist       # after a build: maps present, hidden, debug IDs, no local paths
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

Written against (October 2026): `@sentry/react` 11.10.0, `@sentry/vite-plugin` 11.10.0, `web-vitals` 6.2.3. Sentry 11 changes to know: `sendDefaultPii` is replaced by `dataCollection`, whose unset default now collects more (user info, cookies, headers, request bodies); the `enableLogs` option is removed (logs are captured when you call `Sentry.logger.*` or add a logging integration); spans stream by default, so `beforeSendTransaction` no longer runs; Web Vitals are reported per soft navigation in Chromium 151+; it needs React 17 or newer and Safari 15 or newer. web-vitals 6 added soft-navigation reporting (`reportSoftNavs: true`) and exports types as type-only.

## Decision table: which signal answers which question

| Question | Signal | Tool |
|---|---|---|
| What broke, for whom, since which release? | errors with stack traces, breadcrumbs and release | Sentry (or another error tracker) |
| Is the app fast for real users on real devices? | Core Web Vitals: LCP, INP, CLS, plus TTFB and FCP | `web-vitals` to your endpoint, or Sentry's web vitals |
| Why is one interaction slow? | traces with spans for fetches and renders; INP attribution | Sentry tracing; `web-vitals/attribution` |
| What did the user do before the error? | session replay (masked) and breadcrumbs | Sentry Replay, sampled |
| Did a business event happen (checkout failed, export queued)? | structured logs and counters | `Sentry.logger`, or your own log endpoint |
| Is a lab regression coming? | Lighthouse in CI | the `react-ci-quality-gates` skill |

## Initialize Sentry 11 for a React app

Initialize before rendering, tag the release and environment, sample traces and replays, and set data collection explicitly:

```ts
// src/observability.ts
import * as Sentry from '@sentry/react'

export function initObservability(cfg: { dsn?: string | undefined; environment: string; release: string }) {
  if (!cfg.dsn) return                                   // local development: nothing is sent
  Sentry.init({
    dsn: cfg.dsn,
    environment: cfg.environment,
    release: cfg.release,                                 // the same string the source-map upload uses
    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
    ],
    tracesSampleRate: cfg.environment === 'production' ? 0.1 : 1,
    tracePropagationTargets: [/^\/api\//, /^https:\/\/api\.example\.com/],   // trace headers only to your APIs
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.5,
    dataCollection: {                                    // v11: unset means "collect broadly"; choose deliberately
      userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false, httpBodies: [], databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
    },
    beforeSend(event) { return scrubEvent(event) },       // remove tokens, emails and ids you must not send
  })
}
```

- With a data router, wrap the router factory: `const router = Sentry.wrapCreateBrowserRouter(createBrowserRouter)(routes)`, and use `Sentry.reactRouterBrowserTracingIntegration({ useEffect, useLocation, useNavigationType, createRoutesFromChildren, matchRoutes })` instead of the plain tracing integration, so spans are named by route pattern (`/projects/:id`) rather than URL. TanStack Router has `tanstackRouterBrowserTracingIntegration(router)`.
- `tracePropagationTargets` must not include third-party origins: trace headers there leak and can fail CORS preflights.
- From `@sentry/react` 11.10, `tunnel: true` sends events through your own server when ad blockers stop them; add `serveTunnelIntegration()` to the server SDK. Astro, Nuxt, Nitro, React Router, Remix 3, SolidStart, SvelteKit and TanStack Start then answer tunnel requests on their own. A standalone server such as Express must also call `handleTunnelRequestIfMatched`, for example `app.use((req, res, next) => Sentry.handleTunnelRequestIfMatched(req, res) ?? next());`; without it nothing answers the tunnel path and every event is lost.
- Set the user with an opaque id only (`Sentry.setUser({ id: user.id })`), never email or name unless your privacy policy allows it.

## React 19 root error hooks and error boundaries

React 19 reports errors through options on `createRoot`. Send them to Sentry with `reactErrorHandler`, and keep error boundaries for the UI fallback:

```tsx
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'

createRoot(document.getElementById('root')!, {
  onUncaughtError: Sentry.reactErrorHandler(),                         // errors no boundary caught
  onCaughtError: Sentry.reactErrorHandler(),                           // errors a boundary caught and displayed
  onRecoverableError: Sentry.reactErrorHandler(),                      // hydration and recoverable errors
}).render(<App />)
```

`Sentry.ErrorBoundary` (or `react-error-boundary` with `Sentry.captureException` in `onError`) shows the fallback per area. Do not report the same error twice: with the root hooks in place, boundaries need not call `captureException`.

## Core Web Vitals from real users with web-vitals 6

Lab tools measure one device on one network; real users have thousands. Measure the three Core Web Vitals in the field and send them on page hide:

| Metric | Measures | Good (75th percentile) |
|---|---|---|
| LCP, Largest Contentful Paint | when the main content appears | 2.5 s or less |
| INP, Interaction to Next Paint | how fast the page responds to input, across the visit | 200 ms or less |
| CLS, Cumulative Layout Shift | how much content jumps | 0.1 or less |

```ts
// src/observability/vitals.ts
import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'web-vitals/attribution'
import type { MetricWithAttribution } from 'web-vitals/attribution'

const queue = new Map<string, Record<string, unknown>>()
function enqueue(m: MetricWithAttribution) {
  queue.set(m.id, {
    name: m.name, value: Math.round(m.name === 'CLS' ? m.value * 1000 : m.value), rating: m.rating, id: m.id,
    navigationType: m.navigationType,                    // 'soft-navigation' for in-app route changes when supported
    route: currentRoutePattern(), release: import.meta.env.VITE_RELEASE,
    target: 'interactionTarget' in m.attribution ? m.attribution.interactionTarget : 'target' in m.attribution ? m.attribution.target : undefined,
  })
}
function flush() {
  if (queue.size === 0) return
  const body = JSON.stringify([...queue.values()])
  queue.clear()
  if (!navigator.sendBeacon?.('/rum', body)) void fetch('/rum', { method: 'POST', body, keepalive: true })
}
export function startVitals() {
  const opts = { reportSoftNavs: true }
  onCLS(enqueue, opts); onINP(enqueue, opts); onLCP(enqueue, opts); onFCP(enqueue); onTTFB(enqueue)
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
}
```

- Report the route pattern, not the full URL, so you can group by page without collecting ids.
- Attribution says which element was the LCP and which interaction was slow; it turns a number into a fix.
- If Sentry's browser tracing is on, it already reports web vitals; do not send the same metrics to two places without a reason.

## Structured client logging

Browser logs are useful only when structured, sampled and safe. Log events, not strings, with a level and context, and never log secrets or personal data:

- One small logger module: `log.info('export.queued', { exportId, format })`, `log.error('checkout.failed', { step, code })`.
- Event names are stable identifiers (`area.action.result`); dashboards and alerts depend on them.
- Add context once (release, route, session id) and redact keys like `token`, `password`, `email`, `authorization` before sending.
- Sample debug and info logs in production; always keep warnings and errors.
- With Sentry 11, `Sentry.logger.info('export.queued', { exportId })` sends structured logs linked to the trace; `consoleLoggingIntegration()` forwards `console` calls.

## Source maps uploaded with debug IDs, never served

Minified stack traces are useless. Build source maps, upload them to the error tracker with the release, and do not deploy them:

```ts
// vite.config.ts
import { sentryVitePlugin } from '@sentry/vite-plugin'
export default defineConfig({
  build: { sourcemap: 'hidden' },                                       // maps written, no sourceMappingURL comment
  plugins: [
    react(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG, project: process.env.SENTRY_PROJECT, authToken: process.env.SENTRY_AUTH_TOKEN,
      release: { name: process.env.RELEASE },                           // e.g. the git SHA, also passed to Sentry.init
      sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },     // maps never reach the server
      disable: process.env.SENTRY_UPLOAD === 'off',                     // keeps the maps for the check in Verify
    }),
  ],
})
```

The plugin injects a debug ID into each JavaScript file and its map, so Sentry matches them even when file names repeat across releases. Keep the auth token in CI secrets. `check-sourcemaps.mjs` confirms maps exist before upload (or are gone after), carry debug IDs, and contain no local file paths.

## Release tracking and alerting per release

Tag every event with a release (the git SHA or a version) and an environment, and record deploys, so you can compare error rates and vitals before and after a release. Alert on changes, not totals: a new issue in the latest release, an error rate above the previous release's, INP p75 above 200 ms for a key route. Inject the release at build time (`define: { 'import.meta.env.VITE_RELEASE': JSON.stringify(process.env.RELEASE) }`) so the app, the source maps and the vitals agree.

## Privacy and consent for monitoring

Monitoring data is personal data when it can identify someone. Mask all text and inputs in replays by default and unmask only safe elements; never send form values, tokens or full URLs with ids in query strings; use opaque user ids; honour consent where the law requires it by initializing only after consent; document what you collect. With Sentry 11, set `dataCollection` explicitly, because leaving it unset collects more than version 10 did.

## Worked example: an observability module with every guard

One module initializes monitoring once, tags releases, scrubs events, and exposes a safe logger; the app root wires the React 19 error hooks:

```ts
// src/observability/index.ts
import * as Sentry from '@sentry/react'
import type { ErrorEvent } from '@sentry/react'
import { startVitals } from './vitals'

const SENSITIVE = /token|secret|password|authorization|cookie|email|phone/i
function scrub<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    (value as Record<string, unknown>)[k] = SENSITIVE.test(k) ? '[redacted]' : scrub(v, depth + 1)
  }
  return value
}
function scrubEvent(event: ErrorEvent): ErrorEvent | null {
  if (event.request?.url) event.request.url = event.request.url.replace(/([?&](?:token|code|email)=)[^&]+/gi, '$1[redacted]')
  scrub(event.extra); scrub(event.contexts)
  event.breadcrumbs?.forEach((b) => { scrub(b.data) })
  return event
}

type Fields = Record<string, string | number | boolean | null | undefined>
let started = false
export function startObservability(cfg: { dsn?: string | undefined; environment: 'development' | 'staging' | 'production'; release: string; consent: boolean }) {
  if (started) return
  started = true
  if (cfg.dsn && cfg.consent) {
    Sentry.init({
      dsn: cfg.dsn, environment: cfg.environment, release: cfg.release,
      integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true })],
      tracesSampleRate: cfg.environment === 'production' ? 0.1 : 1,
      tracePropagationTargets: [/^\/api\//],
      replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0.5,
      dataCollection: { userInfo: false, cookies: false, httpHeaders: false, urlQueryParams: false, httpBodies: [], databaseQueryData: false, genAI: { inputs: false, outputs: false } },
      beforeSend: scrubEvent,
    })
  }
  if (cfg.consent) startVitals()
}

export const log = {
  info: (event: string, fields: Fields = {}) => { if (Math.random() < 0.2) Sentry.logger.info(event, scrub({ ...fields })) },
  warn: (event: string, fields: Fields = {}) => Sentry.logger.warn(event, scrub({ ...fields })),
  error: (event: string, fields: Fields = {}) => Sentry.logger.error(event, scrub({ ...fields })),
}
export const reactErrorHandler = Sentry.reactErrorHandler
```

```tsx
// src/main.tsx
import { createRoot } from 'react-dom/client'
import { startObservability, reactErrorHandler } from './observability'
import { loadConfig } from './config'

const config = await loadConfig()
startObservability({ dsn: config.sentryDsn, environment: config.environment, release: import.meta.env.VITE_RELEASE ?? 'dev', consent: hasMonitoringConsent() })
createRoot(document.getElementById('root')!, {
  onUncaughtError: reactErrorHandler(), onCaughtError: reactErrorHandler(), onRecoverableError: reactErrorHandler(),
}).render(<App config={config} />)
```

Without a DSN or without consent nothing is sent and the app works the same. Logs never carry fields named like secrets, and info logs are sampled. Router instrumentation, backend tracing and a self-hosted vitals endpoint: [observability-recipes.md](references/observability-recipes.md).

## Verify observability

```bash
SENTRY_UPLOAD=off npm run build && node <this-skill>/scripts/check-sourcemaps.mjs dist --expect-hidden   # plugin off: maps exist, no public URLs
npm run build && node <this-skill>/scripts/check-sourcemaps.mjs dist --expect-deleted                     # normal build: uploaded, no .map files left
```

These need two builds, because `filesToDeleteAfterUpload` removes the maps during `npm run build`. With the plugin's `disable: true` the first build has no debug IDs, and the script prints that as a note, not an error.

- Throw a test error from a hidden route in staging: the Sentry issue shows original file names and lines, the release, the route and no personal data.
- Open the browser's network panel: trace headers go only to your API; replays and events are sent only after consent.
- Click through key flows on a throttled phone profile, then check the `/rum` payloads: LCP, INP and CLS arrive with the route pattern and attribution.
- Deploy a new release: the release appears with its commits and its own error rate.

## Gotchas and anti-patterns in observability

Each gotcha names the symptom, its cause and the fix.

1. **Stack traces show `index-3f2a.js:1:48213`.** Cause: source maps not uploaded, or uploaded for another release. Fix: the Vite plugin with the same release string as `Sentry.init`, and debug IDs.
2. **Source code is downloadable from production.** Cause: `.map` files deployed with `sourceMappingURL` comments. Fix: `sourcemap: 'hidden'` and `filesToDeleteAfterUpload`.
3. **Emails and cookies appear in error events after upgrading to Sentry 11.** Cause: `dataCollection` left unset, which now collects them. Fix: set `dataCollection` explicitly and scrub in `beforeSend`.
4. **`enableLogs` causes a type error.** Cause: the option was removed in Sentry 11. Fix: delete it; call `Sentry.logger.*`.
5. **API requests fail CORS after adding tracing.** Cause: `sentry-trace` and `baggage` headers sent to a third-party origin. Fix: limit `tracePropagationTargets` to your APIs.
6. **Page-load CLS and INP dropped after the upgrade, nothing changed.** Cause: vitals are now split per soft navigation. Fix: compare like with like, or set `browserTracingIntegration({ webVitals: { softNavigations: false } })`.
7. **Vitals are missing for many visits.** Cause: sending on `unload` or with `fetch` without `keepalive`. Fix: flush on `visibilitychange` to hidden with `sendBeacon`.
8. **The same error is reported twice.** Cause: root error hooks and boundaries both capture. Fix: capture in one place.

## Pre-merge checklist for observability

1. Monitoring initializes once, before render, only with a DSN and consent; the release and environment are set.
2. React 19 root error hooks report errors; boundaries render fallbacks without double reporting.
3. `dataCollection` is explicit; `beforeSend` scrubs secrets and personal data; replays mask by default.
4. Trace propagation is limited to your own APIs; sample rates are set per environment.
5. LCP, INP and CLS are collected from real users with the route pattern and attribution.
6. Source maps are hidden, uploaded with the release and debug IDs, and not deployed.
7. Alerts fire on regressions per release, not on totals.

See also: react-error-handling, react-performance, react-build-and-deploy, react-ci-quality-gates, react-security.
