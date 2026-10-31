---
title: Hosting recipes for a Vite React SPA
author: MOZGII, Inc.
lang: en
---

# Hosting recipes for a Vite React SPA

Configuration for the hosts a client-rendered React app is deployed to most: headers and fallbacks on Netlify, Vercel and Cloudflare Pages, an S3 and CloudFront setup with a viewer-request function, GitHub Pages, deploying under a sub-path, surviving deploys with open tabs, and rolling back. Sources: the Vite guides (static deploy, env variables and modes, build options), and each host's documentation for redirects, rewrites and headers.

## Netlify headers and SPA fallback

Netlify reads `_redirects` and `_headers` from the publish folder; put them in `public/` so Vite copies them into `dist/`:

```text
# public/_redirects  (first match wins)
/api/*  https://api.example.com/:splat  200
/*      /index.html                     200
```

```text
# public/_headers
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/index.html
  Cache-Control: no-cache
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

Netlify serves an existing file before applying a `200` rewrite, so assets are not rewritten to `index.html`.

## Vercel rewrites and headers for a SPA

```json
{
  "rewrites": [{ "source": "/((?!api/|assets/).*)", "destination": "/index.html" }],
  "headers": [
    { "source": "/assets/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/index.html", "headers": [{ "key": "Cache-Control", "value": "no-cache" }] }
  ]
}
```

Vercel detects Vite projects and sets the build command and output folder; the rewrite is what makes deep links work.

## Cloudflare Pages behaviour for single-page apps

Cloudflare Pages treats a project without a top-level `404.html` as a single-page app and serves `index.html` for unknown paths. Custom headers go in `public/_headers` with the same format as Netlify's, and `public/_redirects` handles proxies and redirects. A `200` proxy rule there takes relative paths on your own site only, never an external domain, so an API on another host needs a Pages Function or a Worker. If the build adds a `404.html` (some plugins do), the SPA fallback stops: remove that file.

## S3 and CloudFront with a viewer-request function

Using CloudFront's custom error responses (403 and 404 mapped to `/index.html` with status 200) works but also hides real missing assets and API errors behind HTML. A CloudFront Function on viewer request rewrites only paths that look like app routes:

```js
// CloudFront Function (cloudfront-js-2.0), associated with the default behaviour's viewer request
function handler(event) {
  var req = event.request
  var uri = req.uri
  if (uri.startsWith('/api/') || uri.startsWith('/assets/')) return req
  if (uri.lastIndexOf('.') > uri.lastIndexOf('/')) return req      // has a file extension: serve as is
  req.uri = '/index.html'
  return req
}
```

Upload in three passes so cache headers differ by file type, as in the caching table: hashed assets for a year, unhashed `public/` files (favicon, robots.txt, icons, sitemap) for an hour, and the entry files revalidated every time. The entry files go last, so new assets exist before the new `index.html` references them:

```bash
aws s3 sync dist/assets s3://my-bucket/assets --cache-control "public,max-age=31536000,immutable"   # no --delete: keep old chunks
aws s3 sync dist s3://my-bucket --exclude "assets/*" --exclude "index.html" --exclude "config.json" \
  --exclude "sw.js" --exclude "manifest.webmanifest" --cache-control "public,max-age=3600"        # public/ files: an hour
aws s3 sync dist s3://my-bucket --exclude "*" --include "index.html" --include "config.json" \
  --include "sw.js" --include "manifest.webmanifest" --cache-control "no-cache"                  # entry files last
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths /index.html /config.json /sw.js /manifest.webmanifest
```

Keep the bucket private and let CloudFront read it through Origin Access Control.

## GitHub Pages deployment for a Vite app

GitHub Pages has no rewrites and no custom headers. Two adjustments make a SPA usable:

- Set `base: '/<repo>/'` in `vite.config.ts` for a project site, and the same basename in the router.
- Copy `index.html` to `404.html` after the build (`cp dist/index.html dist/404.html`), so unknown paths load the app; the response status is still 404, which search engines see.

Prefer hash routing (`createHashRouter`) on GitHub Pages when a correct status code matters, or another host for production apps.

## Deploying under a sub-path

An app served at `https://example.com/app/` needs the path in three places: `base: '/app/'` in Vite (asset URLs), the router's `basename: '/app'`, and the server's fallback (`location /app/ { try_files $uri $uri/ /app/index.html; }` in nginx). Public files referenced from code use `import.meta.env.BASE_URL` as their prefix.

## Surviving deploys with open tabs

A user with the old version open requests old chunk names after a deploy. Two measures make this safe:

1. Never delete the previous release's hashed assets on deploy; remove them on a schedule (for example after seven days).
2. When a lazy import still fails, Vite fires `vite:preloadError` on `window`; reload once so the user gets the new version:

```ts
window.addEventListener('vite:preloadError', (event) => {
  const key = 'reloaded-after-preload-error'
  try {
    if (sessionStorage.getItem(key)) return             // already reloaded once: let the error boundary show
    sessionStorage.setItem(key, '1')
  } catch { /* storage unavailable: reload anyway */ }
  event.preventDefault()
  window.location.reload()
})
```

Clear the flag after a successful start, so the next deploy can reload again.

## Environment modes and env files in Vite

Vite loads `.env`, `.env.local`, `.env.[mode]` and `.env.[mode].local`, with later files overriding earlier ones; `vite build` uses the `production` mode unless `--mode staging` is passed. Only variables prefixed with `VITE_` reach `import.meta.env`. Commit `.env` and `.env.[mode]` with non-secret defaults, keep `*.local` files out of git, and type the variables in `src/vite-env.d.ts` (`interface ImportMetaEnv { readonly VITE_API_URL: string }`).

## Preview deployments and rollbacks

Deploy every pull request to its own URL (Netlify, Vercel and Cloudflare Pages do this per branch; with S3, use a prefix or bucket per PR), and run e2e smoke tests against it. Roll back by re-deploying the previous artifact, not by rebuilding an old commit: builds are not perfectly reproducible (dependency ranges, environment). Keep the last few build artifacts, tagged with the git SHA, for that purpose.
