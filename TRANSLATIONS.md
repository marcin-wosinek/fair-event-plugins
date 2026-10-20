# Translation Utilities

Comprehensive translation management tools for the Fair Event Plugins monorepo.

## Overview

This directory contains utilities for managing translations across all plugins:
- **Extract untranslated strings** - Find what needs translation
- **Coverage reports** - Track translation progress
- **Validation** - Check translation integrity
- **AI-assisted translation** - Auto-translate with OpenAI/Claude

## Quick Start

### Extract Untranslated Strings

Find all untranslated strings for a specific plugin and language:

```bash
# From monorepo root
node scripts/translation/get-untranslated.js --plugin=fair-events --locale=fr_FR

# Save to file
node scripts/translation/get-untranslated.js --plugin=fair-events --locale=fr_FR --output=untranslated-fr.json

# Include intentionally untranslated strings (URLs, names)
node scripts/translation/get-untranslated.js --plugin=fair-events --locale=fr_FR --include-intentional
```

**Output:**
```json
{
  "plugin": "fair-events",
  "locale": "fr_FR",
  "localeName": "French",
  "totalStrings": 223,
  "untranslatedCount": 68,
  "untranslated": [
    {
      "msgid": "Start Date",
      "msgidPlural": null,
      "msgctxt": null,
      "references": ["src/Admin/CopyEventPage.php:332"],
      "extractedComment": null
    }
  ],
  "generatedAt": "2026-01-06T12:00:00.000Z"
}
```

### Pull Community Translations from WordPress.org

Approved translations at [translate.wordpress.org](https://translate.wordpress.org/)
are the source of truth. This script downloads them and **overrides the matching
`msgstr` values in the local `.po` files**, so community-managed values always
win over anything translated automatically (AI) or by hand in the repo.

```bash
# All plugins, all locales — preview first
npm run translation:pull -- --dry-run

# Apply
npm run translation:pull

# Single plugin / locale
npm run translation:pull -- --plugin=fair-events --locale=es_ES
```

**How the merge works:**

- A local string is overwritten **only when WordPress.org has a non-empty
  translation** for it. Strings the community has not translated keep their
  existing local value, so this never wipes AI/manual translations for locales
  the community has not touched yet.
- By default both the `stable` (latest release) and `dev` (trunk) GlotPress sets
  are pulled and merged, with **`dev` winning** — dev tracks the current source
  strings and usually holds the freshest community work. Restrict with
  `--set=stable` or `--set=dev`.
- Because `translation:ai` only fills *empty* strings, running AI translation
  afterwards never clobbers the community values this pull applied.

**Options:** `--plugin=`, `--locale=`, `--set=stable|dev|both` (default `both`),
`--dry-run`, `--yes`.

After pulling, recompile and rebuild the affected plugin:

```bash
npm run makemo --workspace=fair-events
npm run build --workspace=fair-events
```

### Export Local Translations for Import to WordPress.org

The reverse direction: hand your local (AI-assisted or manual) translations
to the WordPress.org community **without risking an override of anything
they've already approved**. This does not upload anything itself — GlotPress
has no public API for that — it generates a `.po` file per plugin/locale
containing only the strings WordPress.org does not already have a non-empty
translation for (checked against both the `stable` and `dev` sets, same as
`translation:pull`). Anything the community has already translated —
correct or not — is left out, so importing the output can only fill gaps,
never clobber community work.

```bash
# Preview first
npm run translation:export-for-wporg -- --dry-run

# Write the files
npm run translation:export-for-wporg

# Single plugin / locale
npm run translation:export-for-wporg -- --plugin=fair-events --locale=es_ES
```

Output lands in `<plugin>/languages/wporg-import/<plugin>-<locale>.po`
(git-ignored — it's a throwaway artifact, regenerate anytime).

**Options:** `--plugin=`, `--locale=`, `--set=stable|dev|both` (default `both`),
`--output-dir=`, `--dry-run`.

To actually get the strings onto translate.wordpress.org, import the
generated `.po` file through GlotPress's importer (requires Project
Translation Editor or admin rights on that locale/project):

```
https://translate.wordpress.org/projects/wp-plugins/<slug>/<stable|dev>/<locale>/default/import-translations/
```

Without those rights, use the file as a reference and paste individual
strings into the GlotPress suggestion UI for a PTE to review instead.

### AI-Assisted Translation

Automatically translate untranslated strings using OpenAI or Claude:

**1. Set up API key:**
```bash
# Copy .env.example to .env
cp .env.example .env

# Edit .env and add your API key (uncomment and add your key):
# OPENAI_API_KEY=sk-...
# or
# ANTHROPIC_API_KEY=sk-ant-...
```

The script will automatically load keys from `.env` file. No need to export environment variables!

**2. Run AI translation:**
```bash
# Single locale
npm run translation:ai -- --plugin=fair-events --locale=fr_FR --provider=openai

# All locales (de_DE, es_ES, fr_FR, pl_PL) - locale parameter is optional
npm run translation:ai -- --plugin=fair-events --provider=openai

# With Claude
npm run translation:ai -- --plugin=fair-events --locale=fr_FR --provider=claude
```

The script will show a cost estimate and ask for confirmation before proceeding. After translation, it automatically updates the .po file. When run without `--locale`, it processes all 4 supported locales sequentially.

**3. Compile translations:**
```bash
npm run makemo --workspace=fair-events
npm run build --workspace=fair-events
```

**Features:**
- Cost estimation with confirmation before proceeding
- Batch processing (20 strings at a time)
- Automatically updates .po file after translation
- Processes all locales when --locale is omitted (de_DE, es_ES, fr_FR, pl_PL)
- Skips plural forms (need manual translation)
- Skips intentionally untranslated (URLs, names)

**Providers:**
- `openai` - GPT-4o-mini ($0.15/$0.60 per 1M tokens)
- `claude` - Claude 3.5 Haiku ($0.80/$4.00 per 1M tokens)

#### Per-Locale Style Conventions

`config.js` → `ai.localeConventions` holds a per-locale style note appended to
the AI system prompt. It exists so machine translations match what the
WordPress community locale team would actually approve — which keeps the diff
small when those strings later come back through `translation:pull`.

Defined for `es_ES` and `pl_PL`. The `pl_PL` note is distilled from the
official Codex page [Konwencje przyjęte w polskim tłumaczeniu WordPressa](https://codex.wordpress.org/pl:Konwencje_przyj%C4%99te_w_polskim_t%C5%82umaczeniu_WordPressa)
and covers four areas:

- **Form of address** — informal *ty*, never `Proszę` + infinitive; personal
  pronouns always lowercase (`twój`, not `Twój`); sentence case.
- **Typography** — Polish quotes `„…”`, the single ellipsis character `…`, the
  en dash `–` for dashes, and literal characters rather than HTML entities.
- **Inflection** — *WordPressa*, *blogu* (not *bloga*), *witryna* for the site
  vs *strona* for a single page within it.
- **Glossary** — the Codex term table (`link` → *odnośnik*, `dashboard` →
  *kokpit*, `slug` → *uproszczona nazwa*, `URL` → *adres URL*, `image` →
  *obrazek*, `load` → *wczytywać*, and so on).

These notes only steer **new** AI translations — `translation:ai` skips
non-empty `msgstr` values, so existing entries are left alone. To re-translate
what is already there, blank the offending `msgstr` values first and re-run.

To add a locale note, add a key to `ai.localeConventions` keyed by locale code.
Locales with no entry fall back to the generic prompt.

### Coverage Reports

Generate translation coverage statistics:

```bash
# All plugins and locales
npm run translation:coverage

# Single plugin
npm run translation:coverage -- --plugin=fair-events

# Markdown output
npm run translation:coverage -- --markdown > TRANSLATION_STATUS.md
```

### WordPress.org Translation Status

`translation:coverage` measures the local `.po` catalogs. To see what is
actually approved — or waiting for review — on
[translate.wordpress.org](https://translate.wordpress.org/), use the remote
status report:

```bash
# Every published plugin, stable and dev, the default locales (pl, es, de, fr, en)
npm run translation:wporg-status

# Every remote translation set, whatever its locale
npm run translation:wporg-status -- --all-locales

# One plugin / one locale (any remote locale, also outside the default list)
npm run translation:wporg-status -- --plugin=fair-events --locale=es_ES

# One branch only
npm run translation:wporg-status -- --set=stable

# JSON on stdout (diagnostics go to stderr), or JSON saved to a file
npm run --silent translation:wporg-status -- --json > wporg-status.json
npm run translation:wporg-status -- --output=wporg-status.json
```

**Options:** `--plugin=`, `--locale=`, `--all-locales`,
`--set=stable|dev|both` (default `both`), `--json`, `--output=<file>`.

The report is **read-only**. It reads no local catalog, submits nothing to
WordPress.org, and writes a file only when `--output` asks for one. It is run
by hand; nothing schedules it.

**Scope.** The plugins reported are the ones listed in
`scripts/translation/published-plugins.json`, which maps a workspace name to
its WordPress.org slug. The report does not ask WordPress.org which plugins
exist, so **update that file when a plugin is first published** (or removed
from WordPress.org). Entries are checked against the root `package.json`
workspaces and each plugin's main file; `fair-events-shared` and unpublished
workspaces are not reported. `--plugin=` with an unpublished workspace or an
unknown name is an error — a filter is never silently widened. Readme
translation projects (`stable-readme`, `dev-readme`) are not included.

**Locales and variants.** By default the report covers the GlotPress locales
`pl`, `es`, `de`, `fr` and `en`, whether or not the repository has a catalog
for them — the locales in `config.js` do not apply here. The identifiers are
matched exactly and include every variant of the locale: `de` covers both the
default and the formal German set, while regional locales such as `en-gb` or
`pt-br` are not part of the default. A default locale WordPress.org has no set
for is simply absent from the report; it is not an error.

Two options change the selection, and it applies equally to the terminal
report, `--json` and `--output`:

-   `--all-locales` reports every translation set WordPress.org returns.
-   `--locale=` replaces the default list with one locale — any remote locale,
    also one outside the default list. It accepts the GlotPress locale (`de`,
    `es`, `pt-br`) or the WordPress locale (`de_DE`, `es_ES`, `de_DE_formal`).
    A GlotPress locale matches all of its variants; a WordPress locale matches
    one. A requested locale with no set is a `missing-locale` error.

Combining `--all-locales` with `--locale=` is an invalid invocation (exit code
`2`). The same branch endpoints are requested whatever the selection; it only
narrows which of the returned sets are reported.

The variant is the translation-set slug (`default`, `formal`, …) and is kept
apart from the branch (`stable` is the latest release, `dev` is trunk), so the
two branches are never merged.

**Metrics.** One row per plugin, branch and translation set:

| Report field      | Terminal column | GlotPress field      | Meaning                                  |
| ----------------- | --------------- | -------------------- | ---------------------------------------- |
| `percentApproved` | Approved %      | `percent_translated` | Approved share, as GlotPress reports it  |
| `approved`        | Approved        | `current_count`      | Strings with an approved translation     |
| `waiting`         | Waiting         | `waiting_count`      | Suggestions awaiting review              |
| `fuzzy`           | Fuzzy           | `fuzzy_count`        | Translations flagged for another look    |
| `untranslated`    | Untranslated    | `untranslated_count` | Strings with no translation in any state |
| `total`           | —               | `all_count`          | Strings in the branch                    |

The percentage is never recomputed locally. A metric WordPress.org does not return is `null` in JSON and `unavailable` in
the terminal; `0` always means a real zero.

Each JSON row also carries `url` (the GlotPress page of that translation set),
`sourceUrl` (the API response it was read from) and `retrievedAt`. The report
itself has `schemaVersion`, `generatedAt`, the applied `filters`, one
`responses` entry per branch that answered, and `errors`. `filters` records
the locale selection: `localeScope` is `default`, `all` or `explicit`,
`locales` lists the locales matched (`null` for `all`), and `locale` is the
`--locale=` value or `null`. Each `responses` entry has `setCount` (sets the
branch returned) and `matchedCount` (sets in the selection).

**Failures.** A request that fails never shows up as zero coverage: it
produces an entry in `errors` instead of rows, and rows from the requests
that succeeded are still reported.

| `category`        | Meaning                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `missing-project` | WordPress.org has no translation project for the registered slug     |
| `missing-branch`  | The project exists but has no such `stable`/`dev` branch             |
| `missing-locale`  | The branch answered, but has no set for the requested `--locale`     |
| `network`         | No answer: connection failure or the 20-second timeout               |
| `http`            | Unexpected HTTP status (including 429/5xx that survived the retries) |
| `parse`           | The answer was not the expected JSON structure                       |

At most three requests run at once. Network failures, HTTP 429 and HTTP 5xx
are retried up to twice with a short backoff. A branch that answers with no
translation sets at all, or none in the default locales (and no `--locale`
filter), is a successful, empty result — not an error.

**Exit codes:** `0` everything requested was reported; `1` at least one entry
in `errors` (the successful rows are still printed); `2` invalid invocation or
registry, before any request is made.

### Validate Translations

Check for placeholder mismatches, HTML tag errors, etc.:

```bash
# Single plugin/locale
npm run translation:validate -- --plugin=fair-events --locale=fr_FR

# All plugins and locales
npm run translation:validate -- --all
```

### Available Plugins

Fully translated (`.po` files exist for all locales):

- `fair-audience`
- `fair-audience-experimental`
- `fair-events`
- `fair-events-experimental`
- `fair-finance`
- `fair-payments-connector`
- `fair-platform`

POT only (translations not started yet):

- `fair-payments-connector-experimental`
- `fair-timetable`

### Available Locales

- `de_DE` - German
- `es_ES` - Spanish
- `fr_FR` - French
- `pl_PL` - Polish

## Configuration

All utilities use centralized configuration in `config.js`:

**Plugins and locales:**
```javascript
plugins: [
  { name: 'fair-events', textDomain: 'fair-events' },
  // ...
]

locales: ['de_DE', 'es_ES', 'fr_FR', 'pl_PL']
```

**Intentionally untranslated patterns:**
```javascript
validation: {
  ignorePatterns: [
    /^https?:\/\//,      // URLs
    /^Marcin Wosinek$/,  // Author name
    /^Fair [A-Z]/        // Plugin names
  ]
}
```

## Integration with Existing Workflow

### Standard Translation Workflow

```bash
# 1. Extract translatable strings from source code
npm run makepot --workspace=fair-events

# 2. Update .po files with new strings from .pot
npm run updatepo --workspace=fair-events

# 3. Pull approved community translations from WordPress.org (these win)
npm run translation:pull -- --plugin=fair-events

# 4. Check what still needs translation
npm run translation:untranslated -- --plugin=fair-events --locale=fr_FR

# 5. Translate the remaining gaps (AI-assisted or manual)
# Option A: AI translation (updates .po file automatically)
npm run translation:ai -- --plugin=fair-events --locale=fr_FR --provider=openai
# Option B: Manual editing
# Edit fair-events/languages/fair-events-fr_FR.po

# 6. Validate translations (optional)
npm run translation:validate -- --plugin=fair-events --locale=fr_FR

# 7. Compile .mo files for PHP translations
npm run makemo --workspace=fair-events

# 8. Build JavaScript and generate JSON translations
npm run build --workspace=fair-events
```

### Shared Package Strings (`fair-events-shared`)

`fair-events-shared` lives in its own npm workspace, so a plugin's own
`wp i18n make-pot . --exclude=node_modules,...` scan never sees the strings
its shared components contribute (recurrence controls, the mini calendar,
event-source selector, questionnaire/form helpers, duration options,
date/time controls). `npm run makepot` for a consuming plugin now runs a
second step automatically to pick these up:

```bash
wp i18n make-pot . languages/<plugin>.pot --exclude=node_modules,vendor,tests,build,svn
node ../scripts/translation/merge-shared-strings.js --plugin=<plugin>
```

`merge-shared-strings.js` (`scripts/translation/merge-shared-strings.js`)
re-scans `fair-events-shared/src` filtered to the plugin's own text domain
(`--domain=<plugin>`) and merges the result into the plugin's already-generated
POT file. Nothing else in the pipeline changes — `updatepo`, the AI/community
translation tools, and the coverage/untranslated reports all just read the
resulting `.pot`/`.po` files, so they include shared strings automatically
once a plugin's catalog has been regenerated this way.

**How a string is routed.** Each shared string is extracted into the catalog
of the text domain it *literally* declares in its `__( 'string', 'domain' )`
call — not into every plugin that happens to import the file. A file authored
against `'fair-events'` only ever lands in `fair-events.pot`; the same file's
strings authored against `'fair-audience'` only land in `fair-audience.pot`.
This is enforced by a Jest check,
`fair-events-shared/__tests__/text-domains.test.js`, which fails the build if
a literal domain used anywhere in `fair-events-shared/src` doesn't match a
known plugin's text domain (config.js `plugins` list) — the fastest way to
catch a typo'd or stale domain (e.g. an old plugin slug left behind after a
rename) before it silently ships strings that can never resolve at runtime.

**Source references and the JS translation path.** The merged entries'
`#:` reference comments are rewritten to
`../fair-events-shared/src/<file>:<line>` — the exact path
`webpack-bundle-output` records for shared modules in `build/map.json`. This
match is required for `wp i18n make-json --use-map=build/map.json` (see
[I18N_SETUP.md](./I18N_SETUP.md)) to route a shared string into the correct
per-bundle JSON file; a bare filename reference resolves fine for the PHP
`.mo` path but is silently dropped from every JS translation JSON, since the
map lookup is a literal string match.

**Dynamic text domains are not extracted.** A call such as
`__( label, this.textDomain )` can't be statically parsed by
`wp i18n make-pot`, so its strings are invisible to extraction entirely (not
misfiled, just skipped). A shared component whose labels belong to whichever
plugin uses it should therefore take the translated labels from its consumer
instead of a text domain. `DurationOptions` works this way: it formats
untranslated English labels by default, and accepts `formatLabel` and
`otherLabel` config entries. Fair Events passes them from
`fair-events/src/Admin/components/durationLabels.js`
(`...getDurationLabelConfig()`), where the strings are literal `fair-events`
calls — `_n()` for the singular/plural unit labels and an `_x()` template for
an hours-and-minutes combination — so they are extracted into its own catalog
and routed into each admin bundle's JSON. Another plugin reusing
`DurationOptions` supplies its own formatter under its own domain rather than
loading the Fair Events catalog.

**Only plugins that depend on `fair-events-shared`** (checked via each
plugin's `package.json` `dependencies`) run the merge step in their `makepot`
script. Currently: `fair-audience`, `fair-audience-experimental`,
`fair-events`, `fair-events-experimental`, `fair-form`,
`fair-payments-connector`.

## Architecture

### Directory Structure

```
scripts/translation/
├── config.js                    # Central configuration
├── lib/
│   ├── po-parser.js            # PO file parsing library
│   ├── po-writer.js            # PO file writing library
│   ├── validators.js           # Validation functions
│   ├── wporg-status.js         # WordPress.org translation status reader
│   └── ai-providers.js         # AI API integrations (OpenAI, Claude)
├── published-plugins.json      # Plugins published on WordPress.org
├── get-untranslated.js         # Extract untranslated strings
├── sync-from-wporg.js          # Pull community translations (WordPress.org wins)
├── coverage-report.js          # Coverage statistics
├── wporg-status.js             # WordPress.org translation status (read-only)
├── validate-translations.js    # Validate integrity
└── ai-translate.js             # AI-assisted translation
```

### PO File Format

The parser handles the complete .po file format:

```po
#. Extracted comment (translator note)
#: src/Admin/settings/Settings.js:45
msgid "Show Draft Events"
msgstr ""

#: src/PostTypes/Event.php:30
msgctxt "Post type general name"
msgid "Events"
msgstr "Eventos"

# Plural forms
msgid "%d event"
msgid_plural "%d events"
msgstr[0] "%d evento"
msgstr[1] "%d eventos"
```

**Key features:**
- Multi-line strings
- Escape sequences (`\n`, `\t`, `\"`, `\\`)
- Context (`msgctxt`)
- Plural forms (`msgid_plural`, `msgstr[n]`)
- Source references (`#:`)
- Extracted comments (`#.`)

## Error Handling

### Translation File Not Found

```
❌ Error: Translation file not found
   File: fair-events/languages/fair-events-fr_FR.po

   💡 To fix:
      1. Generate POT: npm run makepot --workspace=fair-events
      2. Update PO: npm run updatepo --workspace=fair-events
```

### Invalid Plugin or Locale

```
❌ Error: Invalid arguments
   Invalid plugin: fair-eventss

Available plugins: fair-audience, fair-events, fair-payments-connector, fair-platform, fair-events-experimental, fair-finance, fair-payments-connector-experimental, fair-timetable
```

## Coming Soon

### Coverage Report

Generate translation coverage statistics:

```bash
node scripts/translation/coverage-report.js
node scripts/translation/coverage-report.js --markdown > TRANSLATION_STATUS.md
```

### Translation Validation

Check translation integrity (placeholders, HTML tags):

```bash
node scripts/translation/validate-translations.js --plugin=fair-events --locale=fr_FR
```

### AI-Assisted Translation

Auto-translate with OpenAI or Claude:

```bash
export OPENAI_API_KEY=your_key_here
node scripts/translation/ai-translate.js --plugin=fair-events --locale=fr_FR --provider=openai --dry-run
```

## Development

### Adding a New Plugin

1. Add to `config.js`:
```javascript
plugins: [
  { name: 'your-plugin', textDomain: 'your-plugin' }
]
```

2. Ensure translation files exist:
```
your-plugin/languages/
├── your-plugin.pot
├── your-plugin-de_DE.po
├── your-plugin-es_ES.po
├── your-plugin-fr_FR.po
└── your-plugin-pl_PL.po
```

### Adding a New Locale

1. Add to `config.js`:
```javascript
locales: ['de_DE', 'es_ES', 'fr_FR', 'pl_PL', 'it_IT']

localeNames: {
  it_IT: 'Italian'
}
```

2. Create .po files for all plugins:
```bash
# For each plugin
npm run updatepo --workspace=fair-events
```

## Testing

### Manual Testing

```bash
# Test with fair-events French (should find ~68 untranslated)
node scripts/translation/get-untranslated.js --plugin=fair-events --locale=fr_FR

# Test with invalid plugin (should show error)
node scripts/translation/get-untranslated.js --plugin=invalid --locale=fr_FR

# Test with missing file (should show helpful error)
node scripts/translation/get-untranslated.js --plugin=fair-payments-connector --locale=fr_FR
```

## Troubleshooting

### "Cannot find module" Error

Make sure you're running from the monorepo root:
```bash
cd /path/to/fair-event-plugins
node scripts/translation/get-untranslated.js --plugin=fair-events --locale=fr_FR
```

### Empty Results

If you get 0 untranslated strings but expect more:

1. Check if `--include-intentional` flag is needed
2. Verify the .po file exists and has content
3. Check if translations were recently added

### Parser Errors

If the parser fails on a .po file:

1. Check file encoding (should be UTF-8)
2. Verify .po file syntax (use `msgfmt -c` to validate)
3. Report the issue with the problematic file

## References

- [WordPress i18n Documentation](https://developer.wordpress.org/apis/internationalization/)
- [GNU gettext PO Format](https://www.gnu.org/software/gettext/manual/html_node/PO-Files.html)
- [WP-CLI i18n Commands](https://developer.wordpress.org/cli/commands/i18n/)

## License

ISC - Same as the main project
