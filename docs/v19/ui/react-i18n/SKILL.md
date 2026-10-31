---
name: react-i18n
description: Translates and localizes React apps - react-i18next 17 with i18next 26 (setup, namespaces loaded on demand, useTranslation, Trans for markup, plurals and context, type-safe keys, language detection and switching), Intl formatting of dates, numbers, currencies, lists and relative times, right-to-left layouts with logical CSS, extracting keys with i18next-cli, and when FormatJS (react-intl) or Lingui fit better. Use when adding translations or a language switcher, when keys show instead of text, plurals are wrong, dates or prices show in the wrong format, a page flashes untranslated, or when preparing a React app for Arabic or Hebrew.
metadata:
  tags:
  - react
  - i18n
  - l10n
  - react-i18next
  - i18next
  - intl
  - plurals
  - rtl
---

# React internationalization

Internationalization (i18n) makes an app ready for many languages; localization fills in one of them. In React that means three jobs: look up translated text by key, format dates, numbers and money with the browser's `Intl` APIs for the user's locale, and lay out the page for the script's direction. This skill uses react-i18next 17 with i18next 26 as the default, because it has the largest ecosystem; FormatJS and Lingui are covered at the end.

## Step 0: read the installed i18n packages

i18next and react-i18next move fast (react-i18next 17 needs i18next 26.2 or newer; 17.1.9 and 26.5.12 when this was checked in October 2026), so read what is installed:

```bash
node -p "['i18next','react-i18next','i18next-browser-languagedetector','i18next-resources-to-backend','i18next-http-backend','react-intl','@lingui/react'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

## Set up i18next with translations loaded on demand

The i18next instance holds the current language and the loaded translations. Bundle the default language, load the others only when chosen, and initialize it once before rendering:

```bash
npm i i18next react-i18next i18next-browser-languagedetector i18next-resources-to-backend
```

```ts
// src/shared/i18n/i18n.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import resourcesToBackend from 'i18next-resources-to-backend'
import common from './locales/en/common.json'

export const languages = ['en', 'de', 'ar'] as const
export const defaultNS = 'common'

void i18n
  .use(LanguageDetector)                                    // ?lng=, localStorage, then the browser's languages
  .use(resourcesToBackend((lng: string, ns: string) => import(`./locales/${lng}/${ns}.json`)))
  .use(initReactI18next)
  .init({
    partialBundledLanguages: true,
    resources: { en: { common } },                          // English ships in the main bundle
    fallbackLng: 'en',
    supportedLngs: languages,
    ns: [defaultNS],
    defaultNS,
    interpolation: { escapeValue: false },                  // React already escapes text
  })

export default i18n
```

```tsx
// src/main.tsx
import './shared/i18n/i18n'
createRoot(document.getElementById('root')!).render(<Suspense fallback={<AppSkeleton />}><App /></Suspense>)
```

- Keep translation files per language and namespace: `locales/de/common.json`, `locales/de/invoices.json`. A namespace per feature keeps downloads small.
- `useTranslation` suspends while a namespace loads (`useSuspense` is on by default), so the app needs a `<Suspense>` above it.
- `escapeValue: false` is safe only because React escapes strings; never pass a translated string to `dangerouslySetInnerHTML`.

## Translate text with useTranslation

`useTranslation` returns `t`, which looks up a key in the current language and re-renders the component when the language changes:

```tsx
import { useTranslation } from 'react-i18next'

export function InvoiceHeader({ count, customer }: { count: number; customer: string }) {
  const { t } = useTranslation('invoices')
  return (
    <header>
      <h1>{t('title')}</h1>
      <p>{t('summary', { count, customer })}</p>
    </header>
  )
}
```

The messages live in `locales/en/invoices.json`:

```json
{
  "title": "Invoices",
  "summary_one": "{{count}} invoice for {{customer}}",
  "summary_other": "{{count}} invoices for {{customer}}"
}
```

- Keys name the meaning (`invoices.empty.title`), not the English text; English changes, keys should not.
- Never build sentences by concatenation (`t('hello') + ' ' + name`): word order differs between languages. Put the variable in the message.
- Outside components (a toast from a mutation), use `i18n.t('key')` from the instance.

## Plurals and context

Plural rules differ by language: English has two forms, Arabic six, Japanese one. i18next picks the form from `count` with `Intl.PluralRules`, so add one key per form the language needs:

An excerpt of `locales/ar/invoices.json`, with Arabic's zero, one, two, few, many and other:

```json
{ "summary_zero": "…", "summary_one": "…", "summary_two": "…", "summary_few": "…", "summary_many": "…", "summary_other": "…" }
```

- Pass a number as `count`; a string "3" picks the wrong form.
- For a special "No invoices" text, add a `_zero` key: when `count` is 0, i18next prefers `summary_zero` in every language, though English plural rules call 0 "other".
- Context selects variants: `t('invited', { context: 'female' })` reads `invited_female`, falling back to `invited`.
- Ordinals ("1st", "2nd") use `t('place', { count, ordinal: true })` and keys like `place_ordinal_one`.

## Trans for text with links and markup

The `Trans` component translates a message that contains React elements, such as a link or bold text, without splitting the sentence into pieces:

```tsx
import { Trans } from 'react-i18next'

// "terms": "By signing up you accept the <link>terms</link> and confirm you are <b>{{age}}</b> or older."
<Trans i18nKey="terms" ns="signup" values={{ age: 16 }}
  components={{
    // oxlint-disable-next-line jsx-a11y/anchor-has-content, jsx-a11y/control-has-associated-label -- Trans fills the link with the translated text
    link: <a href="/terms" />,
    b: <strong />,
  }} />
```

- Named tags (`<link>`) in the message are clearer for translators than numbered ones (`<1>`).
- Translators may move tags but not invent new ones; only the elements in `components` render.
- For plain text, `t` is simpler; use `Trans` only when the message holds elements.

## Format dates, numbers, money and lists with Intl

The browser's `Intl` APIs format values for a locale: decimal separators, currency position, date order, list conjunctions. Format with the current language, never with fixed patterns:

```ts
// src/shared/i18n/format.ts
export const formatters = (locale: string) => ({
  money: (n: number, currency: string) => new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n),
  date: (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d),
  relative: (days: number) => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(days, 'day'),   // "yesterday"
  list: (items: string[]) => new Intl.ListFormat(locale, { type: 'conjunction' }).format(items),             // "A, B and C"
})
```

```tsx
const { i18n } = useTranslation()
const f = formatters(i18n.resolvedLanguage ?? 'en')
<td>{f.money(invoice.total, invoice.currency)}</td>
```

- i18next can format inside messages too: `"due": "Due {{date, datetime}}"` with `t('due', { date })`, and `{{n, number}}` or `{{amount, currency(EUR)}}`.
- Creating `Intl` formatters is not free; in a table of thousands of cells, create one per locale and reuse it.
- Store and send dates as ISO strings in UTC; convert to the user's time zone only for display (`timeZone` option). `toLocaleString()` with no locale uses the browser default, not the app language.
- The currency comes from the data, not the locale: a German user may look at a USD invoice.

## Switch language and set lang and dir

Switching language changes `i18n.language`, loads missing namespaces and re-renders every component that uses `t`. Also update the document, so screen readers pronounce the text correctly and the layout flips for right-to-left scripts:

```tsx
import i18n, { languages } from '@/shared/i18n/i18n'

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
  document.documentElement.dir = i18n.dir(lng)              // 'rtl' for ar, he, fa, ur
})

export function LanguageSelect() {
  const { i18n } = useTranslation()
  const names = new Intl.DisplayNames([i18n.resolvedLanguage ?? 'en'], { type: 'language' })
  return (
    <select aria-label="Language" value={i18n.resolvedLanguage} onChange={(e) => void i18n.changeLanguage(e.target.value)}>
      {languages.map((l) => <option key={l} value={l} lang={l}>{new Intl.DisplayNames([l], { type: 'language' }).of(l)} ({names.of(l)})</option>)}
    </select>
  )
}
```

- Show each language's name in that language ("Deutsch"), so people find their own.
- The detector caches the choice in `localStorage` (`i18nextLng`); a server-side profile setting should win when the user is signed in.
- Wrap the change in `startTransition` if a namespace must load, to keep the old screen instead of a fallback flash.

## Right-to-left layouts with logical CSS

Right-to-left (RTL) languages mirror the layout: the sidebar moves right, text aligns right, arrows point left. With `dir="rtl"` on `<html>`, logical CSS properties flip by themselves:

| Instead of | Use |
|---|---|
| `margin-left`, `padding-right` | `margin-inline-start`, `padding-inline-end` |
| `left: 0`, `right: 0` | `inset-inline-start: 0`, `inset-inline-end: 0` |
| `text-align: left` | `text-align: start` |
| Tailwind `ml-4`, `pr-2`, `left-0` | `ms-4`, `pe-2`, `start-0` |

- Mirror directional icons (back arrows, chevrons) with `rtl:-scale-x-100`; never mirror logos, media controls or numbers.
- Numbers and Latin product names inside Arabic text stay left to right; the browser handles that when markup is clean.
- Test with a real RTL language early; a pseudo-locale catches hard-coded strings, not mirroring.

## Type-safe keys and extraction

Typed keys make `t('titel')` a compile error instead of a key shown on screen. Declare the default language's resources to i18next:

```ts
// src/shared/i18n/i18next.d.ts
import 'i18next'
import type common from './locales/en/common.json'
import type invoices from './locales/en/invoices.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: { common: typeof common; invoices: typeof invoices }
  }
}
```

```bash
npx i18next-cli init          # writes i18next.config.ts (locales, input globs, output path)
npx i18next-cli extract       # adds keys found in t() and <Trans> to the JSON files
npx i18next-cli lint          # finds hard-coded strings in JSX
npx i18next-cli status de     # what is missing in German
```

- Very large translation sets slow the type checker; `enableSelector: 'optimize'` in `CustomTypeOptions` with the selector form `t(($) => $.title)` avoids it.
- Run `extract` in CI with a check mode so a key used in code but missing in the default language fails the build.

## Worked example: a translated summary with every state

A worked example: a summary card whose loading, error, empty and success texts all come from translations, with a plural, formatted money and a date in the current language, and roles for screen readers:

```tsx
// src/features/invoices/InvoiceSummary.tsx
import { useTranslation } from 'react-i18next'
import { formatters } from '@/shared/i18n/format'

type Due = { id: string; total: number; currency: string; dueAt: string }        // dueAt: ISO string in UTC
export type SummaryState = { status: 'loading' } | { status: 'error'; onRetry: () => void } | { status: 'ready'; invoices: readonly Due[] }

export function InvoiceSummary({ state }: { state: SummaryState }) {
  const { t, i18n } = useTranslation(['invoices', 'common'])          // typed keys: 'common:…' needs its namespace listed
  const f = formatters(i18n.resolvedLanguage ?? 'en')
  if (state.status === 'loading') return <p role="status">{t('summary.loading')}</p>
  if (state.status === 'error') {
    return <div role="alert"><p>{t('summary.error')}</p><button type="button" onClick={state.onRetry}>{t('common:actions.retry')}</button></div>
  }
  if (state.invoices.length === 0) return <p>{t('summary.empty')}</p>
  const next = state.invoices.toSorted((a, b) => a.dueAt.localeCompare(b.dueAt))[0]!
  return (
    <section aria-label={t('summary.label')}>
      <p>{t('summary.count', { count: state.invoices.length })}</p>
      <p>{t('summary.next', { amount: f.money(next.total, next.currency), date: f.date(new Date(next.dueAt)) })}</p>
    </section>
  )
}
```

An excerpt of `locales/en/invoices.json` with those messages:

```json
{ "summary": { "label": "Invoice summary", "loading": "Loading invoices…", "error": "Invoices could not be loaded.",
  "empty": "No open invoices.", "count_one": "{{count}} open invoice", "count_other": "{{count}} open invoices",
  "next": "Next payment: {{amount}} on {{date}}" } }
```

- The amount and date are formatted before interpolation, so translators move `{{amount}}` and `{{date}}` freely without knowing number formats.
- The currency comes from the invoice, not from the language; the time zone stays the browser's unless the product says otherwise.

## FormatJS or Lingui instead of i18next

Choosing another i18n library makes sense when the team writes messages in ICU MessageFormat or wants compiled catalogs:

| Library | Model | Pick it when | Where it loses |
|---|---|---|---|
| react-i18next | JSON keys, i18next plural suffixes, plugins for loading and detection | the default; most plugins, tooling and services | its suffix plurals are not ICU, so ICU-based translation tools need conversion |
| FormatJS (`react-intl` 12) | ICU messages (`{count, plural, one {# invoice} other {# invoices}}`), `<FormattedMessage>`, `useIntl()` | translators and the backend already use ICU; standard message syntax | loading per namespace and language detection are yours to build |
| Lingui 6 | ICU messages written in source with macros (`` t`Hello ${name}` ``, `<Trans>`), compiled catalogs | smallest runtime, source text as keys, extraction built in | needs its macro or compiler step in the build; source text as keys changes when English copy changes |

All three use `Intl` underneath; the formatting advice above holds for each.

## Verify React i18n

Translations are proven when every language has every key and plural form, the code uses no hard-coded strings, and one RTL language renders mirrored. Run:

```bash
node <this-skill>/scripts/check-locales.mjs src/shared/i18n/locales en   # missing, extra and empty keys, plural forms, unknown {{variables}}
npx i18next-cli extract --ci --dry-run      # fails when code uses keys the files lack
npx i18next-cli status                      # fails while translations are missing
npx i18next-cli lint                        # hard-coded strings in JSX
npx tsc -b                                  # typed keys: a misspelled key is a compile error
```

When the file is not on disk (a pack install), read this script from the library that served this page and save it first.

- `check-locales.mjs` needs no dependencies; it derives the plural forms each language needs from `Intl.PluralRules`, so it catches a German file that is fine and an Arabic one missing `_few`.
- Switch to Arabic in the running app: `<html lang="ar" dir="rtl">`, the sidebar on the right, chevrons mirrored, numbers still readable.
- A pseudo-locale or a long language (German) shows truncation and hard-coded strings that English hides.

## Pre-merge checklist for React i18n

Check each point before merging translated UI.

1. No user-visible string literal in JSX; `i18next-cli lint` (or the library's extractor) is clean.
2. Messages carry their variables; no concatenated sentences.
3. Plurals use `count` with every form the target languages need.
4. Dates, numbers, money and lists formatted with `Intl` for the current language; dates stored in UTC.
5. `<html lang dir>` follow the language; layout uses logical properties; tested in one RTL language.
6. Only the default language bundled; others loaded per namespace, under a `<Suspense>`.
7. Keys typed; missing keys fail CI.

## Gotchas and anti-patterns in React i18n

Each entry gives the symptom you see, its cause and the fix.

1. **The screen shows `invoices:title` instead of text.** Cause: the namespace was not loaded or the key path is wrong. Fix: `useTranslation('invoices')`, check the file name, and turn on `debug: true` to see missing-key logs.
2. **A blank screen on start, or `A component suspended while responding to synchronous input` after switching language.** Cause: `useTranslation` suspends while a namespace loads, with no `<Suspense>` above it or from an urgent update. Fix: a boundary above the app, and `startTransition(() => { void i18n.changeLanguage(lng) })` for the switch.
3. **"1 invoices" or the wrong Arabic form.** Cause: missing `_one`/`_other` keys, or `count` passed as a string. Fix: one key per plural form, `count` as a number.
4. **HTML entities such as `&amp;` show in the text.** Cause: `escapeValue: true` escapes once and React escapes again. Fix: `interpolation: { escapeValue: false }`.
5. **Dates show in US order for German users.** Cause: `toLocaleDateString()` without a locale, or a fixed format string. Fix: `Intl.DateTimeFormat(i18n.resolvedLanguage)`.
6. **The layout stays left-aligned in Arabic.** Cause: `dir` not set, or physical CSS (`ml-4`, `left`). Fix: set `document.documentElement.dir = i18n.dir(lng)` and use logical properties.
7. **The type checker becomes slow after adding typed keys.** Cause: deep resource types. Fix: `enableSelector: 'optimize'` and the selector form of `t`.
8. **Translations flash in English before the chosen language.** Cause: the detected language loads after the first render. Fix: keep the `<Suspense>` fallback until `i18n.isInitialized`, or bundle the most used languages.
9. **Anti-pattern: keys built at runtime (`` t(`status.${code}`) ``).** Symptom: extraction misses them and a new status shows its raw key. Cause: static analysis cannot see the full key. Fix: a map of complete keys (`{ paid: 'status.paid' }`), or list them in the extractor's config.
10. **Anti-pattern: translating with string concatenation.** Symptom: grammatically broken sentences in German or Japanese. Cause: `t('due') + ' ' + date`. Fix: one message with variables.

Facts here were checked against the i18next 26 and react-i18next 17 type definitions and changelog (MIT), the i18next-cli README and the ECMAScript Intl documentation on MDN; the text and examples are original.

## See also

- `react-accessibility` (`lang` on the page and on language names), `react-styling` (logical utilities), `react-forms` (translated validation messages).
