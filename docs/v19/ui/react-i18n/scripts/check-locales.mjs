#!/usr/bin/env node
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// Copyright 2026 MOZGII, Inc. (https://mozgii.com/)
// Usage: node check-locales.mjs <locales-dir> [default-language]
// Checks i18next JSON files laid out as <locales-dir>/<language>/<namespace>.json against the default language (en):
// missing and extra keys, the plural forms each language needs (from Intl.PluralRules), empty values, and
// {{variables}} in a translation that the default language does not have (usually a typo).
// Exit code: 0 when clean, 1 when problems were found, 2 on a usage or read error. No dependencies; Node 18 or newer.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const USAGE = 'Usage: node check-locales.mjs <locales-dir> [default-language=en]   (files laid out as <locales-dir>/<language>/<namespace>.json)'
const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) { console.log(USAGE); process.exit(0) }
const [dir, base = 'en'] = argv
if (!dir) {
  console.error(USAGE)
  process.exit(2)
}

const SUFFIX = /_(ordinal_)?(zero|one|two|few|many|other)$/

function flatten(value, prefix, out) {
  for (const name of Object.keys(value)) {
    const entry = value[name]
    const key = prefix ? `${prefix}.${name}` : name
    const nested = entry && typeof entry === 'object' && !Array.isArray(entry)
    if (nested) flatten(entry, key, out)
    else out.set(key, typeof entry === 'string' ? entry : JSON.stringify(entry))
  }
  return out
}

function load(language) {
  const namespaces = new Map()
  for (const file of readdirSync(join(dir, language))) {
    if (!file.endsWith('.json')) continue
    const text = readFileSync(join(dir, language, file), 'utf8')
    try {
      namespaces.set(file.slice(0, -5), flatten(JSON.parse(text), '', new Map()))
    } catch (error) {
      throw new Error(`${language}/${file}: ${String(error?.message ?? error)}`)
    }
  }
  return namespaces
}

// Groups keys by their base: summary_one and summary_other belong to "summary" (cardinal), place_ordinal_two to "place" (ordinal).
function groups(keys) {
  const out = new Map()
  for (const key of keys) {
    const m = key.match(SUFFIX)
    const name = m ? key.slice(0, m.index) : key
    const kind = m ? (m[1] ? 'ordinal' : 'cardinal') : 'plain'
    const g = out.get(name) ?? { kinds: new Set(), keys: [] }
    g.kinds.add(kind)
    g.keys.push(key)
    out.set(name, g)
  }
  return out
}

const variables = (text) => new Set([...text.matchAll(/\{\{\s*([\w.]+)[^}]*\}\}/g)].map((m) => m[1]))

let languages, reference
try {
  languages = readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory())
  if (!languages.includes(base)) throw new Error(`no folder for the default language "${base}" in ${dir}`)
  reference = load(base)
} catch (error) {
  console.error(`Could not read locales: ${String(error?.message ?? error)}`)
  process.exit(2)
}

const problems = []
for (const language of languages) {
  let current
  try { current = load(language) } catch (error) { problems.push(error.message); continue }
  const cardinal = new Intl.PluralRules(language).resolvedOptions().pluralCategories
  const ordinal = new Intl.PluralRules(language, { type: 'ordinal' }).resolvedOptions().pluralCategories
  for (const [ns, refKeys] of reference) {
    const keys = current.get(ns)
    if (!keys) { problems.push(`${language}/${ns}.json: file missing`); continue }
    const refGroups = groups(refKeys.keys())
    const curGroups = groups(keys.keys())
    for (const [name, g] of refGroups) {
      if (g.kinds.has('plain') && !keys.has(name)) problems.push(`${language}/${ns}.json: missing ${name}`)
      if (g.kinds.has('cardinal')) {
        for (const c of cardinal) if (!keys.has(`${name}_${c}`)) problems.push(`${language}/${ns}.json: missing plural ${name}_${c}`)
      }
      if (g.kinds.has('ordinal')) {
        for (const c of ordinal) if (!keys.has(`${name}_ordinal_${c}`)) problems.push(`${language}/${ns}.json: missing ordinal ${name}_ordinal_${c}`)
      }
    }
    for (const [name, g] of curGroups) {
      const refGroup = refGroups.get(name)
      if (!refGroup) { problems.push(`${language}/${ns}.json: extra ${g.keys.join(', ')}`); continue }
      const allowed = new Set(refGroup.keys.flatMap((k) => [...variables(refKeys.get(k) ?? '')]))
      if (refGroup.kinds.has('cardinal')) allowed.add('count')
      for (const key of g.keys) {
        const text = keys.get(key) ?? ''
        if (text.trim() === '') problems.push(`${language}/${ns}.json: empty ${key}`)
        for (const v of variables(text)) if (!allowed.has(v)) problems.push(`${language}/${ns}.json: ${key} uses {{${v}}}, unknown in ${base}`)
      }
    }
  }
  for (const ns of current.keys()) if (!reference.has(ns)) problems.push(`${language}/${ns}.json: namespace not in ${base}`)
}

for (const p of problems) console.log(p)
console.log(problems.length === 0 ? `Locales OK: ${languages.join(', ')}` : `\n${problems.length} problem(s)`)
process.exit(problems.length === 0 ? 0 : 1)
