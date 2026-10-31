---
name: react-ci-quality-gates
description: Builds one GitHub Actions pipeline that keeps a React app shippable - install with a lockfile and cache, lint with Oxlint or ESLint and the React hooks rules, type-check, unit tests with coverage thresholds, a production build, bundle-size budgets with size-limit and a PR comment, Playwright end-to-end tests, Lighthouse CI with performance and accessibility assertions, dependency audit, required status checks, concurrency and least-privilege permissions, and how to make gates fast, trusted and hard to bypass. Use when setting up CI for a React project, adding bundle or performance budgets, a pull request should fail on regressions, CI is slow or flaky, Lighthouse scores drift, or when deciding which checks block a merge.
metadata:
  tags:
  - react
  - ci
  - github-actions
  - quality-gates
  - size-limit
  - lighthouse-ci
  - bundle-budget
  - testing
---

# React CI quality gates

A quality gate is a check that blocks a merge when the change makes the product worse: it no longer type-checks, a test fails, the bundle grew past its budget, the main page got slower or less accessible. Gates work when they are fast, reliable and impossible to skip quietly; a flaky gate trains people to rerun until green. This skill builds one GitHub Actions pipeline with ordered gates and budgets that fail with a clear message.

## Step 0: read the installed tools and scripts

The pipeline calls the project's own scripts, so read what exists first:

```bash
node -p "Object.entries(require('./package.json').scripts ?? {}).map(([k,v])=>k+': '+v).join('\n')"
node -p "['typescript','oxlint','eslint','vitest','@vitest/coverage-v8','@playwright/test','size-limit','@size-limit/file','@size-limit/preset-app','@lhci/cli','vite'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
node <this-skill>/scripts/bundle-budget.mjs --init > .bundle-budget.json     # a starting budget from the current build
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

Written against (October 2026): `typescript` 7.0.2, `oxlint` 1.90.0, `eslint` 10.14.0, `vitest` and `@vitest/coverage-v8` 5.0.5 (Node `^22.12.0 || ^24 || >=26`), `@playwright/test` 1.64.1, `size-limit` 14.3.0 (14.3 accepts `.jsonc` configs; `@size-limit/file` measures brotli by default), `@lhci/cli` 0.15.1 (bundles Lighthouse 12.6.1). GitHub Actions used: `actions/checkout@v7`, `actions/setup-node@v7`, `actions/upload-artifact@v7`, `andresz1/size-limit-action@v1`.

## Decision table: which gates block a merge

| Gate | Blocks | Runs on | Why |
|---|---|---|---|
| Lint (Oxlint or ESLint with `react-hooks`) | yes | every PR | hook rule violations are real bugs; fast |
| Type check | yes | every PR | catches broken contracts across files |
| Unit and component tests with coverage thresholds | yes | every PR | behaviour; thresholds stop silent drops |
| Production build | yes | every PR | the deployable artifact must build |
| Bundle budget | yes, with a PR comment | every PR | size grows one dependency at a time |
| E2E on critical journeys | yes | every PR (sharded), full suite on main | catches integration breaks |
| Lighthouse CI assertions | yes for accessibility and CLS; warn for scores that vary | every PR on key pages | lab regressions before users see them |
| Dependency audit (high and critical) | yes on main and release; warn on PRs | schedule and PRs | known vulnerabilities in the supply chain |
| Visual screenshots | warn until baselines are stable | PRs touching UI | pixel diffs are noisy at first |

## Decision table: size-limit or the bundled budget script

| Tool | Pick when | Loses when |
|---|---|---|
| `size-limit` with `@size-limit/file` and `andresz1/size-limit-action` | you want a PR comment with the size change against the base branch | it adds dev dependencies and builds the base branch again |
| `size-limit` with `@size-limit/preset-app` | you also want estimated load and run time | the time numbers vary by CI machine |
| `bundle-budget.mjs` from this skill | no extra dependencies; budgets on globs with gzip or brotli, a Markdown table, a saved baseline | no automatic base-branch comparison unless you save a baseline artifact |

## Lint and type gates that catch React bugs

Lint with the React hooks rules (they include the React Compiler checks in `eslint-plugin-react-hooks` 7's `recommended` preset) and type-check the whole project, not only changed files:

```json
{
  "scripts": {
    "lint": "oxlint --deny-warnings && eslint --max-warnings=0 .",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run --coverage",
    "build": "vite build",
    "size": "size-limit",
    "e2e": "playwright test"
  }
}
```

`--deny-warnings` and `--max-warnings=0` make warnings fail CI; otherwise warnings pile up until nobody reads them. Run Oxlint first for speed and ESLint for the rules Oxlint does not cover yet, or use one of them if it covers everything you need.

## Coverage thresholds that stop silent drops

Coverage numbers are a floor, not a goal. Set thresholds slightly below today's numbers so a PR that deletes tests fails, and raise them as coverage grows:

```ts
// vitest.config.ts (or the test block of vite.config.ts)
export default defineConfig({
  test: {
    coverage: { provider: 'v8', reporter: ['text-summary', 'lcov'], include: ['src/**'], exclude: ['src/**/*.stories.tsx', 'src/main.tsx'],
      thresholds: { lines: 80, branches: 70, functions: 80, statements: 80 } },
  },
})
```

## Bundle-size budgets with size-limit

Budgets turn "the app got slower" into a failing check with a number. Budget what users download first, and each heavy lazy chunk, in `.size-limit.json`:

```json
[
  { "name": "Initial JS", "path": "dist/assets/index-*.js", "limit": "180 kB" },
  { "name": "React vendor", "path": "dist/assets/react-*.js", "limit": "60 kB" },
  { "name": "Editor (lazy)", "path": "dist/assets/editor-*.js", "limit": "120 kB" },
  { "name": "CSS", "path": "dist/assets/*.css", "limit": "30 kB" }
]
```

Limits are brotli-compressed sizes by default (`"gzip": true` switches to gzip). Start at the current size plus 10 percent and lower the limit after each optimization. `npx size-limit --why` explains what is inside a bundle, but it stops with an error under `@size-limit/file` or `@size-limit/preset-app` alone: it needs a bundler plugin and its analyzer, `@size-limit/esbuild` with `@size-limit/esbuild-why`, or the `rolldown` or `webpack` pair. The dependency-free alternative with the same idea: `node <this-skill>/scripts/bundle-budget.mjs` with `.bundle-budget.json`.

## Lighthouse CI assertions

Lighthouse CI runs Lighthouse several times against the built app and asserts on scores and metrics. Assert on what is stable (accessibility, CLS, specific audits) as errors, and on noisy scores as warnings, in `lighthouserc.json`:

```json
{
  "ci": {
    "collect": {
      "startServerCommand": "npm run preview -- --port 4173 --strictPort",
      "startServerReadyPattern": "Local",
      "url": ["http://localhost:4173/", "http://localhost:4173/pricing"],
      "numberOfRuns": 3,
      "settings": { "preset": "desktop" }
    },
    "assert": {
      "aggregationMethod": "median-run",
      "assertions": {
        "categories:accessibility": ["error", { "minScore": 0.95 }],
        "categories:performance": ["warn", { "minScore": 0.9 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }],
        "largest-contentful-paint": ["warn", { "maxNumericValue": 2500 }],
        "total-blocking-time": ["warn", { "maxNumericValue": 200 }],
        "unused-javascript": ["warn", { "maxLength": 2 }]
      }
    },
    "upload": { "target": "filesystem", "outputDir": ".lighthouseci" }
  }
}
```

- `aggregationMethod` defaults to `optimistic`, which keeps the best of the runs, so a page that fails two runs of three still passes. `median-run` judges the representative run.
- Serve the built app with `vite preview` (`startServerCommand`) so client-routed URLs work; `staticDistDir` serves files without the SPA fallback.
- Lighthouse in navigation mode cannot measure INP; Total Blocking Time is its lab stand-in. Real INP comes from field data (`react-observability`).
- `temporary-public-storage` uploads reports to a public URL; keep reports as CI artifacts (`filesystem`) for private apps.

## Worked example: one GitHub Actions pipeline with every gate

A pipeline that cancels superseded runs, uses least privilege and runs fast gates first. The `checks` job builds once, and e2e and Lighthouse download that `dist`, so they test the artifact that passed; the size job is the one exception, because `size-limit-action` builds both the head and the base branch to compare them:

```yaml
# .github/workflows/ci.yml
name: ci
on:
  pull_request:
  push: { branches: [main] }
concurrency: { group: 'ci-${{ github.ref }}', cancel-in-progress: true }
permissions: { contents: read }

jobs:
  checks:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build
      - run: node scripts/bundle-budget.mjs --config .bundle-budget.json --markdown >> "$GITHUB_STEP_SUMMARY"
      - uses: actions/upload-artifact@v7
        with: { name: dist, path: dist, retention-days: 3 }
      - run: npm audit --audit-level=high --omit=dev
        continue-on-error: ${{ github.event_name == 'pull_request' }}     # warn on PRs, block on main

  size:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }                # only this job may comment
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: npm }
      - uses: andresz1/size-limit-action@v1
        with: { github_token: '${{ secrets.GITHUB_TOKEN }}', build_script: build }

  e2e:
    needs: checks
    runs-on: ubuntu-latest
    container: mcr.microsoft.com/playwright:v1.64.1-noble
    strategy: { fail-fast: false, matrix: { shard: [1/2, 2/2] } }
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - uses: actions/download-artifact@v8
        with: { name: dist, path: dist }
      - run: npx playwright test --shard=${{ matrix.shard }}          # webServer serves dist; it builds nothing in CI
        env: { E2E_USER: '${{ secrets.E2E_USER }}', E2E_PASSWORD: '${{ secrets.E2E_PASSWORD }}', HOME: /root, CI: 'true' }
      - uses: actions/upload-artifact@v7
        if: ${{ failure() }}
        with: { name: 'playwright-${{ strategy.job-index }}', path: test-results, retention-days: 7 }

  e2e-gate:                                                              # the one e2e check branch protection names
    needs: e2e
    if: ${{ always() }}
    runs-on: ubuntu-latest
    steps:
      - run: test "$E2E_RESULT" = success
        env: { E2E_RESULT: '${{ needs.e2e.result }}' }

  lighthouse:
    needs: checks
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - uses: actions/download-artifact@v8
        with: { name: dist, path: dist }
      - run: npx @lhci/cli@0.15.1 autorun
      - uses: actions/upload-artifact@v7
        if: ${{ always() }}
        with: { name: lighthouse, path: .lighthouseci, retention-days: 7 }
```

Then make `checks`, `e2e-gate` and `lighthouse` required status checks in the branch protection rules (or a ruleset), so a red gate blocks the merge button. Never require the matrix job itself: its checks are named per shard (`e2e (1/2)`), so the bare name `e2e` matches nothing and a change to the shard list orphans the rule. `if: always()` keeps the gate running when a shard fails; without it the gate would be skipped, and GitHub reports a skipped job as success. `E2E_USER` and `E2E_PASSWORD` are repository secrets: the test account the Playwright setup project signs in with. The bundle table lands in the run summary; the size job comments the change on the PR. Budget file format, baselines and tuning Lighthouse noise: [budgets-and-lighthouse.md](references/budgets-and-lighthouse.md).

## Verify the quality gates

- Open a PR that adds a 100 kB dependency to the entry: the size job comments the increase and the budget step fails.
- Parse the workflow before pushing (`npx --yes yaml valid < .github/workflows/ci.yml`): an unquoted `${{ }}` inside `{ }` is a YAML error, and GitHub then refuses the whole file.
- Add a `test.only` and a failing assertion: `forbidOnly` and the test gate fail.
- Introduce a missing label on a button: the Lighthouse accessibility assertion fails.
- Push twice quickly: the first run is cancelled by `concurrency`.
- Check that a fork PR cannot comment or read secrets (`permissions` and `pull_request`, not `pull_request_target`).
- Time the pipeline: the first failing gate reports within five minutes.

## Gotchas and anti-patterns in CI gates

Each gotcha names the symptom, its cause and the fix.

1. **People rerun CI until it passes.** Cause: a flaky gate (often e2e or Lighthouse scores). Fix: fix or quarantine the flaky test; assert noisy Lighthouse scores as warnings with `numberOfRuns: 3`.
2. **The bundle doubled over a year with green CI.** Cause: no budget, or limits raised in every PR. Fix: budgets per entry and lazy chunk; raising a limit needs a reviewer's approval in the PR.
3. **Lighthouse reports 404 for every route but `/`.** Cause: `staticDistDir` without the SPA fallback. Fix: `startServerCommand` with `vite preview`.
4. **`npm ci` fails with a lockfile mismatch only in CI.** Cause: `package.json` changed without updating the lockfile. Fix: commit the lockfile; never use `npm install` in CI.
5. **Secrets leak through a fork PR.** Cause: `pull_request_target` running untrusted code with secrets. Fix: `pull_request` for builds and tests; keep write permissions to the one job that comments.
6. **A required check sits on "Waiting for status to be reported" forever.** Cause: the rule names the matrix job `e2e`, whose real checks are `e2e (1/2)` and `e2e (2/2)`. Fix: require the `e2e-gate` job, which has one stable name.
7. **`npx size-limit --why` stops with "Argument --why works only with @size-limit/webpack plugin and @size-limit/webpack-why plugin."** Cause: only `@size-limit/file` is installed. Fix: add `@size-limit/esbuild` and `@size-limit/esbuild-why`, or use the `rolldown` or `webpack` pair.
8. **Lighthouse passes a page that is usually slow.** Cause: the default `optimistic` aggregation keeps the best run. Fix: `"aggregationMethod": "median-run"` in `assert`.
9. **Type errors slip through.** Cause: `vite build` strips types without checking. Fix: a separate `tsc -b --noEmit` gate.
10. **Warnings never get fixed.** Cause: lint warnings do not fail. Fix: `--max-warnings=0` and `--deny-warnings`.
11. **CI takes 40 minutes.** Cause: building in every job, unsharded e2e, no cache. Fix: build once and pass `dist` to e2e and Lighthouse as an artifact, shard e2e, cache npm, run fast gates first.

## Pre-merge checklist for CI gates

1. Lint, type check, tests with thresholds and the build run on every PR and fail on warnings.
2. Bundle budgets cover the initial JS, CSS and heavy lazy chunks; changes appear on the PR.
3. E2E covers the critical journeys, sharded, against the `dist` that `checks` built, with traces kept on failure; branch protection requires `e2e-gate`, never the matrix job.
4. Lighthouse asserts accessibility and CLS as errors on key pages served with the SPA fallback.
5. Permissions are least privilege; secrets never reach fork code; runs cancel when superseded.
6. Required status checks are set in branch protection; nobody can merge on red.
7. The pipeline reports the first failure within minutes.

See also: react-build-and-deploy, react-e2e-testing, react-testing, react-observability, react-code-review.
