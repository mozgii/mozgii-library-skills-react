---
name: react-build-and-deploy
description: Builds and ships a React single-page app to production with Vite 8 - code splitting by route and by heavy feature, vendor chunk groups with Rolldown's codeSplitting, bundle analysis with rollup-plugin-visualizer and a dist report, build-time VITE_ variables versus runtime configuration for one image in many environments, the SPA fallback on Netlify, Vercel, Cloudflare Pages, S3 with CloudFront, GitHub Pages and nginx, a Docker multi-stage image with nginx, cache headers that make hashed assets immutable and index.html always fresh, compression, base paths, hidden source maps, and rollbacks. Use when deploying a Vite React app, deep links return 404 on refresh, users get old JavaScript after a deploy, the bundle is too big, an env variable is undefined in production, building a Docker image for the frontend, or setting CDN caching.
metadata:
  tags:
  - react
  - vite
  - build
  - deploy
  - code-splitting
  - docker
  - nginx
  - cdn
  - caching
---

# React build and deploy

A Vite build turns the app into static files: one `index.html`, JavaScript and CSS with content hashes in their names, and copied public assets. Deploying is serving those files so that deep links reach `index.html`, hashed files are cached forever, `index.html` never is, and configuration differs per environment without rebuilding by accident. This skill covers client-rendered apps; server-rendered frameworks have their own adapters.

## Step 0: read the installed build tooling

Vite 8 replaced Rollup with Rolldown, which renamed some options, so read versions first:

```bash
node -p "['vite','@vitejs/plugin-react','rolldown','rollup-plugin-visualizer','react','react-router','@tanstack/react-router'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
node <this-skill>/scripts/analyze-dist.mjs dist          # after a build: sizes, initial JS, largest chunks, packages, leaked keys
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

Written against (October 2026): `vite` 8.3.5 (Rolldown 1.2), `rollup-plugin-visualizer` 7.1.1 (supports Rolldown; needs Node 22). In Vite 8, `build.rolldownOptions` replaces the deprecated `build.rollupOptions`, and Rolldown's `output.codeSplitting` replaces `manualChunks` and `advancedChunks` (both deprecated; `manualChunks` is ignored when `codeSplitting` is set). Vite 8 needs Node `^20.19.0 || >=22.12.0`.

## Decision table: where to host a React SPA

| Host | Pick when | SPA fallback | Loses when |
|---|---|---|---|
| Netlify, Vercel, Cloudflare Pages | most apps: CDN, previews per branch, headers in a file | `_redirects`, `vercel.json` rewrites, automatic on Pages without a `404.html` | you must run in your own cloud account or network |
| S3 (or R2, GCS) + CloudFront (or another CDN) | you already run on that cloud; full control | a viewer-request function rewriting extensionless paths to `/index.html` | more setup; error-page fallback hides real 404s |
| nginx in Docker (Kubernetes, VMs) | the app ships as a container beside its API | `try_files $uri $uri/ /index.html` | you rebuild the image to change content |
| GitHub Pages | public docs and demos | copy `index.html` to `404.html` (served with status 404) | no custom headers; 404 status on deep links |

## Code splitting by route and by heavy feature

Vite splits code at every dynamic `import()`. Split where users do not need code yet:

- **Routes**: lazy route modules (React Router `lazy`, TanStack Router's automatic splitting, or `React.lazy` for components).
- **Heavy features**: editors, charts, maps, PDF and 3D viewers load when opened: `const Chart = lazy(() => import('./revenue-chart'))` inside a `<Suspense>`.
- **Libraries used on one action**: `const { jsPDF } = await import('jspdf')` inside the click handler.

Group long-lived vendor code into a stable chunk so app deploys do not invalidate it, with Rolldown's `codeSplitting` groups:

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: 'hidden',                               // maps for error tracking, not referenced by the bundle
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 10, minSize: 20_000 },
          ],
        },
      },
    },
  },
})
```

Do not force everything into one vendor chunk: lazily loaded routes then download libraries they do not use. Measure before and after.

## Bundle analysis with rollup-plugin-visualizer

Find what makes the bundle big before optimizing. Add the visualizer for an analysis build only:

```ts
import { visualizer } from 'rollup-plugin-visualizer'
// in plugins, only when ANALYZE is set
process.env.ANALYZE && visualizer({ filename: 'stats.html', template: 'treemap', gzipSize: true, brotliSize: true })
```

`ANALYZE=1 npx vite build` writes `stats.html`. Then `analyze-dist.mjs` prints raw, gzip and brotli sizes per file, the JavaScript `index.html` loads up front, and the packages that take the most bytes (from source maps). Typical findings: a whole icon set, a date library with every locale, `lodash` instead of `lodash-es` functions, a polyfill nobody needs, two versions of one package.

## Build-time VITE_ variables and runtime configuration

Vite replaces `import.meta.env.VITE_*` with literal values at build time. Two consequences:

1. Every `VITE_` value is public: it is in the JavaScript anyone downloads. Never put a secret there.
2. One build serves one configuration. Changing the API URL means rebuilding.

| Need | Use |
|---|---|
| Values fixed per build (feature flags for a release, the app version) | `VITE_*` in `.env.production`, or `define` |
| One artifact promoted through staging and production | runtime config: `/config.json` fetched before the app renders, or a `window.__APP_CONFIG__` script generated when the container starts |
| Secrets | none in the frontend; the backend holds them |

```ts
// src/config.ts: runtime configuration, validated once
import { z } from 'zod'
const Config = z.object({
  apiUrl: z.url({ protocol: /^https?$/ }),          // z.url() alone also accepts javascript: and file: URLs
  sentryDsn: z.string().optional(),
  environment: z.enum(['staging', 'production']),
})
export type AppConfig = z.infer<typeof Config>
export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch('/config.json', { cache: 'no-store' })
  if (!res.ok) throw new Error(`config.json: HTTP ${res.status}`)
  return Config.parse(await res.json())
}
```

Serve `config.json` with `Cache-Control: no-cache`. Zod 4 writes formats at the top level (`z.url()`, `z.email()`); `z.string().url()` still works but is deprecated. Vite only exposes variables with the `VITE_` prefix (configurable with `envPrefix`); `loadEnv` in `vite.config.ts` reads others for the build itself.

## The SPA fallback on static hosts

A client-routed app has one HTML file; the server must answer every app URL with it, or a refresh on `/projects/42` returns 404. Rewrite only paths that are not files and not API routes:

| Host | Fallback |
|---|---|
| Netlify | `public/_redirects`: `/api/*  https://api.example.com/:splat  200` then `/*  /index.html  200` |
| Vercel | `vercel.json`: `{ "rewrites": [{ "source": "/((?!api/\|assets/).*)", "destination": "/index.html" }] }` |
| Cloudflare Pages | automatic when the build has no top-level `404.html` |
| nginx | `location / { try_files $uri $uri/ /index.html; }` |
| S3 + CloudFront | a CloudFront Function on viewer request that rewrites paths without a file extension to `/index.html` |

Keep a real 404 page inside the app for unknown routes; the fallback answers 200, so the router decides what is not found. Full host configurations, a two-pass S3 upload and the preload error handler: [hosting-recipes.md](references/hosting-recipes.md).

## Cache headers: immutable assets, fresh HTML

Hashed file names make caching safe. Set:

| Files | `Cache-Control` |
|---|---|
| `/assets/*` (hashed JS, CSS, fonts, images) | `public, max-age=31536000, immutable` |
| `index.html`, `config.json`, `sw.js`, `manifest.webmanifest` | `no-cache` (revalidate every time) |
| Unhashed files in `public/` (`favicon.ico`, `robots.txt`, icons, `sitemap.xml`) | `public, max-age=3600` (an hour: a new icon appears within the hour, without a request for it on every page) |

After a deploy, users with the old `index.html` still request old chunk names. Keep the previous release's `assets/` on the server for a few days (upload new files first, never delete old ones on deploy), and handle a failed lazy import by reloading once (`vite:preloadError` event).

## Worked example: Docker image with nginx for a Vite SPA

A multi-stage Dockerfile that builds once and serves with nginx as a non-root user, with runtime configuration written at container start, the SPA fallback, caching, compression and a health check:

```dockerfile
# Dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.31-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/config.json.template /usr/share/nginx/config.json.template
COPY --chmod=755 deploy/40-app-config.sh /docker-entrypoint.d/40-app-config.sh
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
```

```sh
#!/bin/sh
# deploy/40-app-config.sh: writes config.json from environment variables when the container starts
set -eu
: "${API_URL:?API_URL is required}" "${APP_ENV:?APP_ENV is required}"
envsubst '${API_URL} ${APP_ENV} ${SENTRY_DSN}' < /usr/share/nginx/config.json.template > /tmp/config.json   # /tmp: writable by the non-root user
```

```json
{ "apiUrl": "${API_URL}", "environment": "${APP_ENV}", "sentryDsn": "${SENTRY_DSN}" }
```

```nginx
# deploy/nginx.conf (included inside nginx's http block, so map is allowed here)
# Cache-Control is chosen by path here, so no location needs its own add_header: an add_header inside a location
# drops every add_header above it, and try_files' /index.html fallback is matched again as a new location.
map $uri $cache_control {
  ~^/assets/                                       "public, max-age=31536000, immutable";
  ~\.(?:ico|png|jpe?g|gif|svg|webp|avif|txt|xml)$  "public, max-age=3600";   # unhashed files from public/
  default                                          "no-cache";                # index.html, the fallback, config.json, sw.js, the manifest
}

server {
  listen 8080;
  root /usr/share/nginx/html;
  server_tokens off;
  gzip on; gzip_types text/css application/javascript application/json image/svg+xml; gzip_min_length 1024;

  add_header Cache-Control $cache_control;      # 2xx and 3xx only, so a missing chunk's 404 is never cached for a year
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  location = /healthz { access_log off; return 200 "ok\n"; }
  location /assets/ { try_files $uri =404; }
  location = /config.json { alias /tmp/config.json; }
  location ~ \.map$ { return 404; }                # hidden maps stay in dist/ for upload, never served
  location ~* ^/(sw\.js|manifest\.webmanifest)$ { try_files $uri =404; }
  location / { try_files $uri $uri/ /index.html; }
}
```

- The unprivileged image listens on 8080 and runs as a non-root user; the entrypoint scripts in `/docker-entrypoint.d/` run before nginx starts, and `config.json` is written to `/tmp` because the web root is not writable for that user.
- `try_files … =404` under `/assets/` makes a missing chunk a real 404 instead of HTML, which the app's `vite:preloadError` handler can catch.
- Every response carries `nosniff` and `Referrer-Policy`, the SPA fallback included: the headers sit at the server level and no location adds its own, because nginx inherits `add_header` only into a location that has none.
- A missing `API_URL` stops the container at start instead of shipping a broken config.
- Add a `.dockerignore` with `node_modules`, `dist`, `.git` and `.env*` so local files and secrets never enter the image.

## Verify the build and the deployment

```bash
npm run build && node <this-skill>/scripts/analyze-dist.mjs dist --budget-initial 200   # exit 1 when initial JS > 200 kB gzip
docker build -t web . && docker run -d --name web-check -p 8080:8080 -e API_URL=https://api.example.com -e APP_ENV=staging web && sleep 2
curl -sI http://localhost:8080/projects/42 | head -1                       # 200: the SPA fallback works
curl -sI http://localhost:8080/assets/$(ls dist/assets | grep -m1 '\.js$') | grep -i cache-control   # immutable
curl -sI http://localhost:8080/ | grep -i cache-control                    # no-cache
curl -sI http://localhost:8080/favicon.ico | grep -i cache-control         # max-age=3600: unhashed public/ file
curl -s http://localhost:8080/config.json                                  # runtime values, no secrets
curl -sI http://localhost:8080/projects/42 | grep -ci -e nosniff -e referrer-policy   # 2: the fallback keeps the security headers
curl -sI http://localhost:8080/assets/$(ls dist/assets | grep -m1 '\.map$') | head -1   # 404: source maps are not served
docker rm -f web-check
```

Then load a deep link in a browser, deploy a second version, and check that an open tab survives navigation to a lazy route (old chunks still served, or a clean reload).

## Gotchas and anti-patterns in build and deploy

Each gotcha names the symptom, its cause and the fix.

1. **Refreshing a deep link shows 404.** Cause: no SPA fallback. Fix: the host's rewrite to `/index.html` for non-file paths.
2. **Users see the old app after a deploy.** Cause: `index.html` cached by the browser or CDN. Fix: `no-cache` on `index.html`; invalidate the CDN path on deploy.
3. **"Failed to fetch dynamically imported module" after a deploy.** Cause: the old chunks were deleted while tabs still referenced them. Fix: keep previous assets for days; reload once on `vite:preloadError`.
4. **`import.meta.env.API_URL` is undefined.** Cause: no `VITE_` prefix, or the variable was set at runtime instead of build time. Fix: `VITE_API_URL` at build time, or runtime `config.json`.
5. **A secret is visible in the bundle.** Cause: a key in a `VITE_` variable. Fix: move the call to a backend; rotate the key; `analyze-dist.mjs` flags common key patterns.
6. **Assets 404 when hosted under `/app/`.** Cause: Vite builds for `/` by default. Fix: `base: '/app/'` and the router's basename.
7. **API calls return the HTML page.** Cause: the SPA fallback also matches `/api/*`. Fix: exclude API paths from the rewrite or proxy them first.
8. **Every deploy re-downloads all JavaScript.** Cause: one giant chunk that changes on any edit. Fix: route splitting and a stable vendor group.

## Pre-merge checklist for build and deploy

1. Routes and heavy features are lazy; vendor groups are stable; the initial JS budget holds.
2. The bundle was analyzed; no duplicate packages or whole-library imports remain.
3. No secrets in `VITE_` variables; runtime configuration is validated at startup.
4. The SPA fallback works for deep links and excludes API and asset paths.
5. Hashed assets are immutable for a year; `index.html`, `config.json` and `sw.js` are `no-cache`.
6. Old assets survive a deploy; a failed chunk load reloads once.
7. The container runs as non-root, fails fast without config, and has a health check.
8. Source maps are hidden and uploaded to error tracking, not served publicly.

See also: react-ci-quality-gates, react-observability, react-pwa-and-offline, react-performance, react-security.
