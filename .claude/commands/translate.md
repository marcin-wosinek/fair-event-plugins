---
description: Run the translation tooling for a plugin/locale (TRANSLATIONS.md)
argument-hint: [plugin] [locale]
---

Handle translations for: $ARGUMENTS

Use the project's translation tooling (see TRANSLATIONS.md) and the i18n build
(see I18N_SETUP.md). Run from the repo root.

Tooling scripts:

- `npm run translation:untranslated` — list untranslated strings (per plugin/locale)
- `npm run translation:coverage` — coverage report
- `npm run translation:validate` — validate `.po` files
- `npm run translation:ai` — AI-assisted translation (needs `OPENAI_API_KEY` or
  `ANTHROPIC_API_KEY` in `.env`)

Standard i18n cycle:

`npm run makepot` (extract `.pot`) → `npm run updatepo` (sync `.po`) → translate →
`npm run makemo` (compile `.mo` for PHP) → `npm run build` (regenerates
`build/languages/*.json` with correct hashes via `--use-map`).

Figure out what the given plugin/locale needs, show me the plan, then run the
appropriate commands. Don't commit unless I ask.
