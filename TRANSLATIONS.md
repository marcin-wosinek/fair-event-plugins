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
npm run translation:ai -- --plugin=fair-events --locale=fr_FR --provider=openai
# or
npm run translation:ai -- --plugin=fair-events --locale=fr_FR --provider=claude
```

The script will show a cost estimate and ask for confirmation before proceeding. After translation, it automatically updates the .po file.

**3. Compile translations:**
```bash
npm run makemo --workspace=fair-events
npm run build --workspace=fair-events
```

**Features:**
- Cost estimation with confirmation before proceeding
- Batch processing (20 strings at a time)
- Automatically updates .po file after translation
- Skips plural forms (need manual translation)
- Skips intentionally untranslated (URLs, names)

**Providers:**
- `openai` - GPT-4o-mini ($0.15/$0.60 per 1M tokens)
- `claude` - Claude 3.5 Haiku ($0.80/$4.00 per 1M tokens)

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

### Validate Translations

Check for placeholder mismatches, HTML tag errors, etc.:

```bash
# Single plugin/locale
npm run translation:validate -- --plugin=fair-events --locale=fr_FR

# All plugins and locales
npm run translation:validate -- --all
```

### Available Plugins

- `fair-events`
- `fair-calendar-button`
- `fair-rsvp`
- `fair-membership`
- `fair-team`

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

# 3. Check what needs translation
npm run translation:untranslated -- --plugin=fair-events --locale=fr_FR

# 4. Translate strings (AI-assisted or manual)
# Option A: AI translation (updates .po file automatically)
npm run translation:ai -- --plugin=fair-events --locale=fr_FR --provider=openai
# Option B: Manual editing
# Edit fair-events/languages/fair-events-fr_FR.po

# 5. Validate translations (optional)
npm run translation:validate -- --plugin=fair-events --locale=fr_FR

# 6. Compile .mo files for PHP translations
npm run makemo --workspace=fair-events

# 6. Build JavaScript and generate JSON translations
npm run build --workspace=fair-events
```

## Architecture

### Directory Structure

```
scripts/translation/
├── config.js                    # Central configuration
├── lib/
│   ├── po-parser.js            # PO file parsing library
│   ├── po-writer.js            # PO file writing library
│   ├── validators.js           # Validation functions
│   └── ai-providers.js         # AI API integrations (OpenAI, Claude)
├── get-untranslated.js         # Extract untranslated strings
├── coverage-report.js          # Coverage statistics
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

Available plugins: fair-events, fair-calendar-button, fair-rsvp, fair-membership, fair-team
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
node scripts/translation/get-untranslated.js --plugin=fair-payment --locale=fr_FR
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
