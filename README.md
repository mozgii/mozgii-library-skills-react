# React skills

A library of 42 Claude skills for building React apps with React 19.3 and its current ecosystem. Each skill is a folder with a `SKILL.md` that says what it does and when to use it, plus reference files and scripts where they help. Every skill stands alone: take one folder and it works without the others (they mention each other only as "see also"). The skills cover React apps built with Vite, plus React Server Components (Next.js App Router and React Router framework mode) in `react-server-components`; Next.js as a whole is out of scope.

The text was checked against the package versions published on npm in October 2026: `react` 19.3.1, `react-router` 8.5.1, `@tanstack/react-query` 5.105.0, `@tanstack/react-router` 1.170.46, `@tanstack/react-table` 9.3.1, `@tanstack/react-virtual` 3.14.24, `react-hook-form` 7.91.0, `@hookform/resolvers` 6.0.2, `zod` 4.6.7, `zustand` 5.0.16, `@reduxjs/toolkit` 2.13.0, `jotai` 3.0.1, `vite` 8.3.5, `@vitejs/plugin-react` 6.1.2, `babel-plugin-react-compiler` 1.0.0, `typescript` 7.0.2, `oxlint` 1.90.0, `eslint-plugin-react-hooks` 7.1.1, `vitest` 5.0.5, `@testing-library/react` 16.3.3, `@testing-library/jest-dom` 7.0.1, `msw` 3.0.3, `motion` 14.9.0, `react-error-boundary` 6.1.6, `tailwindcss` 4.3.3, `tailwind-merge` 3.7.0, `class-variance-authority` 0.7.1, `shadcn` 4.23.0, `i18next` 26.5.12, `react-i18next` 17.1.9, `dompurify` 3.4.17. Every skill starts by reading the installed versions, so it stays useful as they move.

## Use these skills

Each folder under `docs/v19/<group>/` is a complete skill. To use one:

- **Claude Code, for all your projects**: copy the folder to `~/.claude/skills/`, for example `cp -r docs/v19/data-and-routing/react-forms ~/.claude/skills/`.
- **Claude Code, for one project**: copy it to that project's `.claude/skills/` and commit it, so everyone on the project gets it.
- **claude.ai and Claude Desktop**: zip the folder (the zip holds one folder named like the skill, with `SKILL.md` inside) and upload it in the Skills section of claude.ai's settings.

The front matter uses only the portable keys (`name`, `description`, `metadata`), so the same folder works in Claude Code, claude.ai and the Skills API. Claude loads a skill when a request matches its description; in Claude Code you can also run one by name, such as `/react-forms`.

## Skills

| Skill | What it covers |
|---|---|
| [react-project-setup](docs/v19/core/react-project-setup/SKILL.md) | Vite 8 and TypeScript 7 project, templates, Oxlint or ESLint with the compiler rules, Tailwind 4, env variables, folder layout |
| [react-components](docs/v19/core/react-components/SKILL.md) | pure rendering, props and children, keys, conditional rendering, ref as a prop, Context with `use`, Fragment refs, React 19.x API map |
| [react-hooks-and-effects](docs/v19/core/react-hooks-and-effects/SKILL.md) | Rules of Hooks, state and reducers, when not to use an effect, `useEffectEvent`, `useSyncExternalStore`, custom hooks |
| [react-composition-patterns](docs/v19/core/react-composition-patterns/SKILL.md) | slots and children, variants over booleans, compound components, controlled and uncontrolled, headless hooks, `asChild` |
| [react-typescript](docs/v19/core/react-typescript/SKILL.md) | typing props, children, native props, refs, events, unions, generic components, context |
| [react-styling](docs/v19/ui/react-styling/SKILL.md) | choosing Tailwind, CSS Modules or CSS-in-JS, the `cn` helper, cva variants, shadcn/ui, tokens and dark mode, dynamic classes |
| [react-state-management](docs/v19/core/react-state-management/SKILL.md) | where state lives, Context done right, URL state, Zustand 5, Redux Toolkit 2, Jotai 3, persistence |
| [react-data-fetching](docs/v19/data-and-routing/react-data-fetching/SKILL.md) | TanStack Query 5 with `queryClient.query`, keys, mutations, optimistic UI, Suspense, infinite lists, push invalidation |
| [react-data-tables](docs/v19/ui/react-data-tables/SKILL.md) | TanStack Table 9: features, sorting, filtering, client and server pagination, row selection, virtual rows, v8 migration |
| [react-router-data-mode](docs/v19/data-and-routing/react-router-data-mode/SKILL.md) | React Router 8 data mode: loaders, actions, fetchers, revalidation, middleware, pending UI, tests |
| [tanstack-router](docs/v19/data-and-routing/tanstack-router/SKILL.md) | type-safe file routes, validated search params, loaders with TanStack Query, guards, code splitting |
| [react-forms](docs/v19/data-and-routing/react-forms/SKILL.md) | React 19 Actions, `useActionState`, `useOptimistic`, React Hook Form with Zod 4, accessible fields |
| [react-error-handling](docs/v19/core/react-error-handling/SKILL.md) | error boundaries, `react-error-boundary` 6, handler and async errors, root error reporting |
| [react-debugging](docs/v19/testing/react-debugging/SKILL.md) | React error messages by name, components that do not update or render too often, DevTools and DevTools for agents, owner stacks, hydration fixes, checking claims against React's sources |
| [react-performance](docs/v19/production/react-performance/SKILL.md) | profiling, React Compiler 1.0, transitions, `Activity`, code splitting, virtualization, live streams |
| [react-testing](docs/v19/testing/react-testing/SKILL.md) | Vitest 5, Testing Library, user-event, MSW 3, Browser Mode, Playwright |
| [react-accessibility](docs/v19/ui/react-accessibility/SKILL.md) | WCAG 2.2 AA in React: semantics, names, keyboard, focus, dialogs, ARIA patterns, live regions, axe |
| [react-i18n](docs/v19/ui/react-i18n/SKILL.md) | react-i18next 17, plurals, `Trans`, typed keys, `Intl` formatting, language switching, right-to-left layouts |
| [react-security](docs/v19/production/react-security/SKILL.md) | XSS sinks, DOMPurify, safe URLs and redirects, secrets in bundles, token storage, CSRF, CSP and Trusted Types, supply chain, patched Server Components releases |
| [react-app-layouts](docs/v19/ui/react-app-layouts/SKILL.md) | app shell, split views, side peek, status bar, hover previews, command palette, themes, every data state |
| [react-animation](docs/v19/ui/react-animation/SKILL.md) | React 19.3 `ViewTransition`, `addTransitionType`, shared elements, route transitions, Motion 14, reduced motion |
| [react-migrations](docs/v19/core/react-migrations/SKILL.md) | React 18 to 19 with codemods, class to function components, Create React App to Vite, TanStack Query 5, React Router, retired packages |
| [react-server-components](docs/v19/core/react-server-components/SKILL.md) | RSC boundaries, Server Functions as endpoints, Context from the server, React `cache`, request data, `use(browser())`, streaming, Next.js 16 caching, React Router RSC |
| [react-suspense-and-concurrency](docs/v19/core/react-suspense-and-concurrency/SKILL.md) | `use()`, Suspense placement, transitions, `useDeferredValue`, Activity |
| [react-design-system](docs/v19/ui/react-design-system/SKILL.md) | headless base choice, three-layer tokens, dark mode, Storybook 10 tests, publishing |
| [react-overlays-and-feedback](docs/v19/ui/react-overlays-and-feedback/SKILL.md) | dialogs, alert dialogs, popovers, menus, tooltips, Sonner toasts, focus rules |
| [react-virtual-lists](docs/v19/ui/react-virtual-lists/SKILL.md) | TanStack Virtual, measured rows, infinite scroll, end-anchored chat lists |
| [react-drag-and-drop](docs/v19/ui/react-drag-and-drop/SKILL.md) | dnd-kit line choice, sortable lists, kanban, keyboard and WCAG 2.5.7, file drops |
| [react-file-uploads](docs/v19/data-and-routing/react-file-uploads/SKILL.md) | react-dropzone, previews, XHR progress, presigned S3, tus and Uppy 6 |
| [react-realtime](docs/v19/data-and-routing/react-realtime/SKILL.md) | SSE vs WebSocket, backoff and jitter, heartbeats, resync, TanStack Query updates, presence |
| [react-auth-flows](docs/v19/data-and-routing/react-auth-flows/SKILL.md) | cookie vs BFF vs SPA client, PKCE, protected routes, single-flight refresh, sign-out |
| [react-charts-and-dataviz](docs/v19/ui/react-charts-and-dataviz/SKILL.md) | Recharts, visx or ECharts, formatting, colour-safe palettes, accessible charts |
| [react-ai-chat-ui](docs/v19/ui/react-ai-chat-ui/SKILL.md) | AI SDK 7 `useChat`, message parts, tool approvals, streamed Markdown, server route |
| [react-rich-text-editors](docs/v19/ui/react-rich-text-editors/SKILL.md) | Tiptap 3 or Lexical, toolbars, mentions, JSON storage, Yjs collaboration |
| [react-3d-and-canvas](docs/v19/ui/react-3d-and-canvas/SKILL.md) | react-three-fiber 9 and drei, on-demand rendering, instancing, Canvas 2D loops |
| [react-pwa-and-offline](docs/v19/production/react-pwa-and-offline/SKILL.md) | vite-plugin-pwa 2, caching strategies, update and install prompts, offline data |
| [react-build-and-deploy](docs/v19/production/react-build-and-deploy/SKILL.md) | Vite 8 code splitting, runtime config, SPA fallbacks, Docker and nginx, cache headers |
| [react-architecture](docs/v19/core/react-architecture/SKILL.md) | feature folders, layers, public APIs per feature, import rules, growth into packages |
| [react-code-review](docs/v19/testing/react-code-review/SKILL.md) | prioritized review checklist with reasons, comment labels, PR scan script |
| [react-e2e-testing](docs/v19/testing/react-e2e-testing/SKILL.md) | Playwright 1.64 flows, fixtures, auth state, mocks, clock, screenshots, flaky fixes |
| [react-observability](docs/v19/production/react-observability/SKILL.md) | Sentry 11, web-vitals 6 field data, structured logs, hidden source maps, releases |
| [react-ci-quality-gates](docs/v19/testing/react-ci-quality-gates/SKILL.md) | one GitHub Actions pipeline with lint, types, tests, budgets, e2e and Lighthouse CI |

16 scripts ship with the skills, each standalone with a usage line at its top: `react-accessibility/scripts/axe-check.mjs`, `react-architecture/scripts/check-imports.mjs`, `react-auth-flows/scripts/pkce.mjs`, `react-build-and-deploy/scripts/analyze-dist.mjs`, `react-ci-quality-gates/scripts/bundle-budget.mjs`, `react-code-review/scripts/pr-scan.mjs`, `react-design-system/scripts/check-tokens.mjs`, `react-e2e-testing/scripts/find-flaky-patterns.mjs`, `react-i18n/scripts/check-locales.mjs`, `react-migrations/scripts/find-legacy-apis.mjs`, `react-observability/scripts/check-sourcemaps.mjs`, `react-project-setup/scripts/installed-versions.mjs`, `react-pwa-and-offline/scripts/check-manifest.mjs`, `react-security/scripts/scan-bundle.sh`, `react-server-components/scripts/find-client-boundaries.mjs`, `react-styling/scripts/find-dynamic-classes.mjs`.

## Layout

- `docs/v19/<group>/<skill>/SKILL.md`: the skills; `references/*.md` beside them hold longer recipes, read only when a skill links them.
- `library.json`: name `react`, title, version, the self-test minimum.
- `questions.json`: the self-test; each question names a phrase its answering file holds.

## Sources

Every text, example and script in this library is written by MOZGII, Inc. The sources below were read as context: they showed what the skills should cover and which facts are true. Facts such as API names, versions, flags and error messages are used exactly; no sentence, example or script was copied from any source, whatever its licence, and a word-run check finds no eight words in a row shared with the sources below. `sources.json` records the commit of each, and `NOTICE` lists them.

The React team publishes no agent skills for people who build with React. Its only skills are for working on its own repositories: `.claude/skills` in `react/react` (formerly `facebook/react`) for developing React and the compiler, and `.claude/skills` in `reactjs/react.dev` for writing the docs. What it does publish for users and their agents is the documentation, with `https://react.dev/llms.txt` and a Markdown copy of each page, and the experimental `react-devtools-cdt-mcp`. The closest thing to a user-facing skill from an official repository is `react-expert` in `reactjs/react.dev`, a research method aimed at docs writers. Vercel's and TanStack's skills come from those companies, not the React team.

Read at a commit on 2026-10-30:

| Source | Publisher | Licence | What it informed |
|---|---|---|---|
| [react/react](https://github.com/react/react/tree/a703ca64f9ea5c1b650af0face1a98fb8c6b3a13) (`CHANGELOG.md`, the source, `.claude/skills`, compiler skills, security advisories) | The React team | MIT | 19.x changes, warning text, the advisory table; its skills cover developing React only, so nothing in them applied |
| [reactjs/react.dev](https://github.com/reactjs/react.dev/tree/0821e7d9428a6c58c922765b891bbffba9ed6249) (reference, blog, security posts, `llms.txt` page, `.claude/skills`) | The React team | CC BY 4.0 | `browser`, `cache`, `<ViewTransition>`, `useEffectEvent`, lint rules, DevTools for agents; `react-expert` informed the order of sources in `react-debugging` |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62) (`react-best-practices`, `composition-patterns`, `react-view-transitions`) | Vercel | no LICENSE file; its README and skill front matter state MIT; facts only | coverage check: request data on the server, React `cache`, payload duplication, listeners, hydration without a flash, view transition traps |
| [remix-run/react-router](https://github.com/remix-run/react-router/tree/5db4b541cde0d20a92bfe02c452425a056be38ef) (`.agents/skills/react-router`) | Remix Software and Shopify | MIT | mode detection, the docs shipped in the package |
| [TanStack/router](https://github.com/TanStack/router/tree/da2adec76dbe6c0da6d6a0d5640f7b9388217f45) (skills in its packages) | TanStack | MIT | search param rules, `beforeLoad` limits |
| [TanStack/table](https://github.com/TanStack/table/tree/c14e0221b1e656c7bb35e7b3d4cdf188719a3599) (skills in its packages) | TanStack | MIT | coverage check of `react-data-tables`; nothing was missing |
| [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp/tree/8d009e854f8aa55b1ec31628e836d4d4731b8ec8) (`docs/`) and the [third-party tools post](https://developer.chrome.com/blog/devtools-for-agents-3p-tools) | Google | Apache-2.0; CC BY 4.0 | the third-party flag and tool names |
| [vercel/next.js 16.4.3 release notes](https://github.com/vercel/next.js/releases/tag/v16.4.3) | Vercel | MIT | Next.js advisories |
| [getsentry/sentry-javascript 11.10.0 release notes](https://github.com/getsentry/sentry-javascript/releases/tag/11.10.0) | Sentry | MIT | `tunnel: true` |

Reference material from earlier rounds, kept here as a map for the next upgrade. It was not read again in this round and has no commit on record:

| Source | Licence | What it informed |
|---|---|---|
| [eslint-plugin-react-hooks](https://www.npmjs.com/package/eslint-plugin-react-hooks) 7.1.1 README and source | MIT | flat config, compiler rules, the compiler's list of incompatible library hooks |
| [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react) 6.1.2 README and [create-vite](https://github.com/vitejs/vite/tree/main/packages/create-vite) 9.3.3 templates | MIT | React Compiler setup with `@rolldown/plugin-babel`, templates, Oxlint default |
| [Oxlint](https://oxc.rs) 1.90 configuration schema | MIT | React, compiler and jsx-a11y rule names |
| [TypeScript](https://github.com/microsoft/TypeScript) 7.0 compiler output and [typescript-eslint](https://typescript-eslint.io) 8.72 package metadata | Apache-2.0, MIT | the removed `baseUrl` option (TS5102), TypeScript peer range |
| [React Router](https://github.com/remix-run/react-router) 8.x changelog | MIT | v8 changes, middleware, view transition deprecation; mode detection idea |
| [TanStack Query](https://github.com/TanStack/query) 5.105 type definitions and bundled codemods | MIT | `queryClient.query`, deprecations, mutation callback signatures, v4 to v5 codemods |
| [TanStack Router](https://github.com/TanStack/router) 1.170 and the skills it ships in its npm packages | MIT | file routes, search params with Zod 4, router context, plugin setup |
| [TanStack Table](https://github.com/TanStack/table) 9.3 type definitions and the skills it ships in its npm packages | MIT | features and row-model slots, server-side state, selection, React Compiler boundaries, v8 to v9 changes |
| [TanStack Virtual](https://github.com/TanStack/virtual) | MIT | virtualizer API |
| [React Hook Form](https://github.com/react-hook-form/react-hook-form) releases and [@hookform/resolvers](https://github.com/react-hook-form/resolvers) 6.0 | MIT | form APIs, resolver typing, v6 breaking change |
| [Zod](https://zod.dev) 4.6 type definitions | MIT | top-level formats, `flattenError`, coerce typing |
| [Zustand](https://github.com/pmndrs/zustand), [Jotai](https://github.com/pmndrs/jotai) (v3 migration guide), [Redux Toolkit](https://github.com/reduxjs/redux-toolkit) | MIT | store APIs, `useShallow`, `jotai-family`, `withTypes` |
| [Tailwind CSS](https://tailwindcss.com) 4.3 docs, [tailwind-merge](https://github.com/dcastil/tailwind-merge), [class-variance-authority](https://github.com/joe-bell/cva), [clsx](https://github.com/lukeed/clsx) | MIT | `@theme`, `@source`, `@custom-variant`, class merging, typed variants |
| [shadcn/ui](https://github.com/shadcn-ui/ui) docs and CLI 4.23 help | MIT | `init` templates and bases, `add --diff`, `info`, the MCP server |
| [i18next](https://github.com/i18next/i18next) 26 and [react-i18next](https://github.com/i18next/react-i18next) 17 type definitions, changelog and source; [i18next-cli](https://github.com/i18next/i18next-cli) help | MIT | init options, plural and `_zero` lookup, `Trans`, typed keys, extraction commands |
| [MDN Web Docs](https://developer.mozilla.org) on `Intl`, CSS logical properties, Popover and View Transitions | CC BY-SA 2.5 (linked, not copied) | browser API behaviour; summarized in our own words |
| [DOMPurify](https://github.com/cure53/DOMPurify) 3.4 README and types | Apache-2.0 or MPL-2.0 | sanitize options, Trusted Types output |
| [OWASP Cheat Sheet Series](https://cheatsheetseries.owasp.org) (XSS, CSRF, CSP, session management) | CC BY-SA 4.0 (linked, not copied) | security checks; summarized in our own words |
| [Vitest](https://github.com/vitest-dev/vitest) 5.0 release notes, browser mode guide, [vitest-browser-react](https://github.com/vitest-dev/vitest-browser-react) | MIT | v5 breaking changes, Browser Mode config |
| [Testing Library](https://github.com/testing-library) (React, user-event, jest-dom 7 release) | MIT | queries, user-event, jest-dom peer change |
| [MSW](https://github.com/mswjs/msw) 3.0 release notes and types | MIT | v3 breaking changes, `onUnhandledFrame` |
| [react-error-boundary](https://github.com/bvaughn/react-error-boundary) 6 README and types | MIT | boundary API, `getErrorMessage`, transitions and boundaries |
| [Motion](https://github.com/motiondivision/motion) changelog | MIT | v12 to v14 changes, `motion/react` entry |
| [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/) and [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | W3C Document License | widget keyboard models, success criteria; summarized, not copied |
| [axe-core](https://github.com/dequelabs/axe-core) | MPL-2.0 | automated accessibility checks (used as a tool, no text taken) |
| [Jeffallan/claude-skills](https://github.com/Jeffallan/claude-skills) `react-expert` | MIT | reviewed for coverage |
| [anthropics/skills](https://github.com/anthropics/skills) (`frontend-design`, `webapp-testing`) | Apache-2.0 | reviewed for skill format; no React content taken |
| [PatrickJS/awesome-cursorrules](https://github.com/PatrickJS/awesome-cursorrules), [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | CC0-1.0, MIT | surveyed for existing React rules and skills |
| [Claude skills documentation](https://code.claude.com/docs/en/skills.md) and [Agent Skills best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) | Anthropic documentation (linked, not copied) | skill format, front matter rules, size limits |
