---
title: Bundle budgets and Lighthouse CI in practice
author: MOZGII, Inc.
lang: en
---

# Bundle budgets and Lighthouse CI in practice

How to choose budget numbers, keep a baseline from the main branch, tune Lighthouse CI so it is reliable enough to block merges, and protect the branch so gates cannot be skipped. Sources: the size-limit README and changelog (14.x), the Lighthouse CI documentation (getting started, configuration, assertions) for `@lhci/cli` 0.15, web.dev guidance on performance budgets, and the GitHub documentation on rulesets and required status checks.

## Choosing bundle budget numbers

A budget is a limit you can defend. Start from user impact and current reality:

1. Measure today's sizes (brotli) for the initial JavaScript, CSS and each lazy chunk over about 30 kB.
2. Set limits at the current size plus about 10 percent, so ordinary work passes and a new heavy dependency fails.
3. Set a target for the initial JavaScript from the devices you serve: on mid-range phones, every 100 kB of compressed JavaScript costs noticeable parse and execution time; many teams aim for 150 to 200 kB brotli for the initial route.
4. Lower a limit after each optimization lands, so gains are kept.

Raising a limit is allowed, but it should be a visible decision in the PR (a reviewer approves the change to the budget file), never a silent edit.

## The budget file for bundle-budget.mjs

The script reads a JSON array; each entry sums every file its glob matches, so content hashes in file names do not matter:

```json
[
  { "name": "Initial JS", "path": ["dist/assets/index-*.js", "dist/assets/react-*.js"], "limit": "180 kB", "compression": "brotli" },
  { "name": "Editor (lazy)", "path": "dist/assets/editor-*.js", "limit": "120 kB" },
  { "name": "All CSS", "path": "dist/**/*.css", "limit": "30 kB", "compression": "gzip" },
  { "name": "Admin (optional)", "path": "dist/assets/admin-*.js", "limit": "90 kB", "optional": true }
]
```

`compression` is `brotli` (default), `gzip` or `none`. An entry that matches no file fails, because a renamed chunk would otherwise disable its budget silently; mark entries that may legitimately vanish with `"optional": true`. Negated globs (`"!dist/assets/*.legacy.js"`) remove files from an entry.

## Keep a baseline from the main branch

To show "+12 kB" on a pull request without building the base branch again, save results on every main-branch run and compare on PRs:

```yaml
# on push to main
- run: node scripts/bundle-budget.mjs --config .bundle-budget.json --save bundle-baseline.json
- uses: actions/upload-artifact@v7
  with: { name: bundle-baseline, path: bundle-baseline.json, retention-days: 30 }

# on pull requests: download the latest baseline from main (for example with the GitHub CLI), then
- run: node scripts/bundle-budget.mjs --config .bundle-budget.json --compare bundle-baseline.json --markdown >> "$GITHUB_STEP_SUMMARY"
```

`andresz1/size-limit-action` does the comparison by building the base branch itself; it is simpler to set up and slower to run.

## size-limit configuration options worth knowing

| Option | Use |
|---|---|
| `path` | glob or array of globs, `!` to exclude |
| `limit` | `"180 kB"`, or a time such as `"1 s"` with the time plugin |
| `gzip: true` / `brotli: false` | switch from the brotli default to gzip, or to uncompressed |
| `import` | for libraries: `"{ Button }"` measures what a tree-shaken import costs |
| `ignore` | dependencies to exclude from the measurement |
| `message` | text shown when the limit is exceeded, for example a link to the budget policy |

`npx size-limit --why` opens a breakdown of the bundle for the entry. It refuses to run under `@size-limit/file` or `@size-limit/preset-app` alone: add a bundler plugin and its analyzer (`@size-limit/esbuild` and `@size-limit/esbuild-why`, or the `rolldown` or `webpack` pair). Version 14.3 also reads `.size-limit.jsonc`, so budgets can carry comments.

## Making Lighthouse CI reliable enough to block merges

Lighthouse scores vary between runs, especially on shared CI machines. Reduce variance before asserting:

- Run several times (`numberOfRuns: 3` or 5) and set `"aggregationMethod": "median-run"` in `assert`. The default is `optimistic`, which takes the best value of all runs and hides a page that is usually slow; `pessimistic` takes the worst, and a single assertion can override the method in its own options.
- Use the `desktop` preset for stable numbers on CI hardware, and a separate mobile run as warnings.
- Serve the production build locally (`vite preview`) to remove network variance; never test against a remote preview that other jobs also load.
- Assert hard limits on stable signals (accessibility score, CLS, presence of specific audits such as `image-alt`, `color-contrast`, `document-title`), and keep the performance score and LCP as warnings until you know their spread.
- Track trends with an LHCI server (`lhci server` with a database) when you need history; `temporary-public-storage` keeps reports for a few days on a public URL and suits only public projects.

## Lighthouse assertion presets and individual audits

`"preset": "lighthouse:recommended"` in `assert` turns every audit into an assertion; it is strict and noisy for existing apps. `lighthouse:no-pwa` drops the PWA audits. A practical start is no preset plus a short list of assertions on categories and the audits you care about, then grow the list. Each assertion takes a level (`off`, `warn`, `error`) and options such as `minScore`, `maxNumericValue` or `maxLength`.

## Test the right pages with Lighthouse CI

Audit the routes users land on: the home page, a product or pricing page, the sign-in page, and one authenticated screen. For authenticated pages, LHCI supports a Puppeteer script (`puppeteerScript` in `collect`) that signs in before the audits; keep a dedicated test account. Audit a fixed set of URLs so results compare across runs.

## Required checks and rulesets

Gates matter only if a red check blocks the merge. In the repository's branch protection or ruleset for the default branch:

- Require status checks to pass, listing the job names (`checks`, `e2e-gate`, `lighthouse`). A matrix job has no check of its bare name: its checks are `e2e (1/2)`, `e2e (2/2)`. So list a gate job with `needs: e2e` and `if: always()` that fails unless `needs.e2e.result` is `success`. Without `always()` the gate is skipped when a shard fails, and a skipped job reports success. Require branches to be up to date if the main branch moves fast and merge queues are not used.
- Require a pull request with at least one approval, and dismiss stale approvals on new commits.
- Block force pushes and deletion of the default branch.
- With a merge queue, add `merge_group` to the workflow triggers so the gates run on the queued merge commit.

## Keeping the pipeline fast

| Cost | Fix |
|---|---|
| installing dependencies in every job | `actions/setup-node` with `cache: npm` and `npm ci` |
| building in several jobs | build once, upload `dist` as an artifact, download it in the e2e and Lighthouse jobs; in CI the Playwright `webServer` only serves it |
| long e2e runs | shard across machines; run only critical journeys on PRs |
| reruns of superseded pushes | `concurrency` with `cancel-in-progress: true` |
| waiting for slow jobs to report fast failures | order steps so lint and types run first; split long jobs |
