---
title: React observability recipes
author: MOZGII, Inc.
lang: en
---

# React observability recipes

Recipes for monitoring React apps in production: router-aware tracing, debugging slow interactions with INP attribution, a self-hosted real-user monitoring endpoint, sampling and noise control, a log event schema, connecting frontend and backend traces, and alerts that catch regressions. Sources: the Sentry JavaScript SDK 11 migration guide and type definitions, the web-vitals 6 README and types, and web.dev guidance on Core Web Vitals.

## Router-aware tracing with React Router and TanStack Router

Spans named by URL (`/projects/8c1f…`) cannot be grouped; spans named by route pattern (`/projects/:id`) can. Sentry instruments routers in two ways:

```tsx
import * as Sentry from '@sentry/react'
import { createBrowserRouter, createRoutesFromChildren, matchRoutes, useLocation, useNavigationType } from 'react-router'
import { useEffect } from 'react'

Sentry.init({
  dsn,
  integrations: [Sentry.reactRouterBrowserTracingIntegration({ useEffect, useLocation, useNavigationType, createRoutesFromChildren, matchRoutes })],
  tracesSampleRate: 0.1,
})
const sentryCreateBrowserRouter = Sentry.wrapCreateBrowserRouter(createBrowserRouter)
export const router = sentryCreateBrowserRouter(routes)
```

The version-neutral names (`reactRouterBrowserTracingIntegration`, `wrapCreateBrowserRouter`) work with React Router 6 and newer; the versioned ones (`reactRouterV7BrowserTracingIntegration`) remain for older code. For TanStack Router, pass the router instance: `Sentry.tanstackRouterBrowserTracingIntegration(router)`. React Router framework mode has its own Sentry package and needs React Router 7.15 or newer with Sentry 11.

## Debug slow interactions with INP attribution

INP reports the slowest interaction of a visit. The attribution build splits it into three parts, each with a different fix:

| Part | Field | Large when | Fix |
|---|---|---|---|
| Input delay | `inputDelay` | the main thread was busy when the user acted (a long task from a timer, a script loading) | split long tasks, defer non-urgent work, load third parties later |
| Processing | `processingDuration` | event handlers run long (heavy state updates, synchronous work) | move work out of the handler, use transitions for non-urgent updates, virtualize large lists |
| Presentation delay | `presentationDelay` | rendering and painting the result takes long (huge DOM, layout thrash) | smaller DOM, `content-visibility`, avoid forced layouts |

`interactionTarget` names the element (a CSS selector), and `longAnimationFrameEntries` with `longestScript` point at the script that blocked. Send these fields with the metric so the slowest interactions can be grouped by target and script.

## A self-hosted real-user monitoring endpoint

When vitals go to your own backend, aggregate them so dashboards show distributions, not averages:

1. Accept `POST /rum` with a JSON array; validate with a schema; drop payloads over a size limit; rate-limit per IP.
2. Store rows with `name`, `value`, `rating`, `route`, `release`, `navigationType`, device class (from the user agent's mobile hint) and a timestamp; never store full URLs or user ids.
3. Report the 75th percentile per metric, route, release and device class, the threshold Google uses for Core Web Vitals.
4. Keep at least a week of data per release to compare releases.

`sendBeacon` sends with `Content-Type: text/plain` for a string body, which avoids a CORS preflight; parse the body as JSON on the server regardless of the declared type.

## Sampling and noise control in Sentry

Sample by importance, not uniformly, and drop noise before it reaches quota:

```ts
Sentry.init({
  dsn,
  tracesSampler: ({ name, inheritOrSampleWith }) => {
    if (/\/(checkout|payment)/.test(name)) return 1          // every checkout trace
    if (/healthz|ping/.test(name)) return 0
    return inheritOrSampleWith(0.05)                          // keep upstream decisions, else 5 percent
  },
  ignoreErrors: ['ResizeObserver loop completed with undelivered notifications', /^AbortError/],
  allowUrls: [/https:\/\/app\.example\.com\/assets\//],       // only errors from your own bundles
  integrations: [Sentry.thirdPartyErrorFilterIntegration({ filterKeys: ['your-app-key'], behaviour: 'drop-error-if-exclusively-contains-third-party-frames' })],
})
```

Browser extensions and injected scripts cause many reports; `allowUrls` and the third-party filter (which needs the application key set in the bundler plugin) remove them. Treat `AbortError` from cancelled fetches as expected, not as an error.

## A log event schema for the browser

Structured logs are queryable only when every event has the same shape. A schema that works for most apps:

| Field | Example | Note |
|---|---|---|
| `event` | `checkout.payment.failed` | stable dotted name; dashboards depend on it |
| `level` | `error` | debug, info, warn, error |
| `release` | `2026.10.28-3f2a9c1` | the same string as error tracking |
| `route` | `/checkout/:step` | pattern, not URL |
| `session` | random id per tab session | no user identity |
| `trace_id` | from the active span | links logs to traces |
| fields | `{ step: 'card', code: 'card_declined' }` | primitive values only; no personal data |

Redact by key name before sending (`token`, `password`, `authorization`, `cookie`, `email`, `phone`), cap the size of each event, and batch sends with `sendBeacon` on page hide.

## Connect frontend and backend traces

Sentry's browser tracing adds `sentry-trace` and `baggage` headers to requests whose URLs match `tracePropagationTargets`. A backend instrumented with Sentry or OpenTelemetry continues the same trace, so one view shows the click, the fetch, the API handler and the database query. Allow those two headers in the API's CORS configuration (`Access-Control-Allow-Headers`). In Sentry 11 spans stream in batches by default, so long sessions are not cut off at a span limit; `beforeSendTransaction` and `ignoreTransactions` no longer run, and filtering moves to `beforeSendSpan` and `ignoreSpans`.

## Alerts that catch regressions

Alert on change and on what users feel:

- A new issue in the latest release affecting more than a handful of users.
- Error rate of the latest release above the previous release's by a set margin, in the first hours after deploy.
- INP or LCP 75th percentile above the "good" threshold on a key route for a day.
- A spike in a business failure event (`checkout.payment.failed`) relative to attempts.

Route alerts to the team that owns the feature (use the route or the code owner), and include the release, the route and a link to the trace.

## User feedback with context

Sentry's feedback integration (or your own form posting to `Sentry.captureFeedback`) lets users report problems with the current trace and replay attached. Ask for feedback after an error fallback ("Tell us what you were doing"), and never pre-fill personal data the user did not type.
