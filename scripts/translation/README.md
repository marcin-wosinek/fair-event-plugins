# Translation Management

This directory contains scripts for managing translations across all Fair Event plugins.

## Quick Start

### Update Translation Files (Recommended)

The easiest way to update .pot and .po files for all plugins:

```bash
# Update all plugins with one command and one confirmation prompt
npm run translation:update
```

This will:
1. Generate .pot files from source code (makepot)
2. Update .po files from .pot files (updatepo)
3. Show ONE consolidated confirmation prompt for all plugins

### Update Specific Plugin

```bash
# Update only fair-events
npm run translation:update -- --plugin=fair-events
```

### Automation / CI Mode

Use the `--yes` flag to skip the confirmation prompt:

```bash
npm run translation:update -- --yes
```

## Individual Scripts

You can also run individual translation scripts for specific tasks:

### 1. Get Untranslated Strings

Extract untranslated strings for a specific plugin and locale:

```bash
npm run translation:untranslated -- --plugin=fair-events --locale=fr_FR
npm run translation:untranslated -- --plugin=fair-events --locale=fr_FR --output=untranslated.json
```

### 2. Coverage Report

Generate translation coverage statistics:

```bash
# All plugins and locales
npm run translation:coverage

# Specific plugin
npm run translation:coverage -- --plugin=fair-events

# Output as markdown
npm run translation:coverage -- --markdown > TRANSLATION_STATUS.md
```

### 3. Validate Translations

Check translation integrity (placeholders, HTML tags, formatting):

```bash
# Validate specific plugin/locale
npm run translation:validate -- --plugin=fair-events --locale=fr_FR

# Validate all translations
npm run translation:validate -- --all
```

### 4. AI Translation

Translate untranslated strings using OpenAI or Claude:

```bash
# Translate with OpenAI (single locale)
npm run translation:ai -- --plugin=fair-events --locale=fr_FR --provider=openai

# Translate with Claude (all locales) - shows ONE combined cost estimate and confirmation
npm run translation:ai -- --plugin=fair-events --provider=claude

# Skip confirmations (for automation)
npm run translation:ai -- --plugin=fair-events --locale=fr_FR --provider=openai --yes
```

**When translating all locales** (no `--locale` specified), the script will:
1. Calculate the total number of untranslated strings across all languages
2. Show the estimated cost for translating ALL languages combined
3. Ask for ONE confirmation
4. Process all languages automatically without additional prompts

## Configuration

Edit `/scripts/translation/config.js` to configure:

- **Plugins**: Add/remove plugins from translation management
- **Locales**: Add/remove supported languages
- **AI Providers**: Configure OpenAI/Claude models and costs
- **Validation Rules**: Customize placeholder patterns and ignore patterns
- **Batch Size**: Adjust AI translation batch size

## Complete Translation Workflow

The complete workflow for managing translations:

1. **Update translation files** (generate .pot and update .po):
   ```bash
   npm run translation:update
   ```

2. **Translate missing strings** (optional - using AI):
   ```bash
   export OPENAI_API_KEY=your_key_here
   npm run translation:ai -- --plugin=fair-events --locale=fr_FR --provider=openai
   ```

3. **Compile .mo files** (for PHP):
   ```bash
   npm run makemo --workspace=fair-events
   ```

4. **Build JavaScript** (for JSON):
   ```bash
   npm run build --workspace=fair-events
   ```

5. **Test translations** in WordPress admin and frontend

## API Keys

Set your API key as an environment variable or in a `.env` file in the project root:

```bash
# .env file
OPENAI_API_KEY=sk-...
# or
ANTHROPIC_API_KEY=sk-ant-...
```

## Cost Estimates

The `translation:ai` script provides cost estimates before translating:

- **OpenAI** (gpt-4o-mini): ~$0.00015 per 1K input tokens, ~$0.0006 per 1K output tokens
- **Claude** (claude-3-5-haiku): ~$0.0008 per 1K input tokens, ~$0.004 per 1K output tokens

**When translating all locales**, the script shows:
1. A breakdown of untranslated strings by language
2. The total combined estimated cost for all languages
3. A single confirmation prompt
4. Final actual costs per language and total

Actual costs depend on the number of strings and their length.

## Supported Locales

Current supported locales (configured in `config.js`):

- `de_DE` - German
- `es_ES` - Spanish
- `fr_FR` - French
- `pl_PL` - Polish

## Examples

### Complete translation update for all plugins

```bash
# 1. Update .pot and .po files for all plugins (with one confirmation)
npm run translation:update

# 2. Optionally translate missing strings with AI
export OPENAI_API_KEY=your_key_here
npm run translation:ai -- --plugin=fair-events --locale=fr_FR --provider=openai

# 3. Compile .mo files for all plugins
for plugin in fair-audience fair-events fair-calendar-button fair-rsvp fair-membership fair-team; do
  npm run makemo --workspace=$plugin
done

# 4. Build all plugins
npm run build
```

### Update only one plugin

```bash
# Update .pot and .po files for fair-events only
npm run translation:update -- --plugin=fair-events

# Compile and build
npm run makemo --workspace=fair-events
npm run build --workspace=fair-events
```

### Check translation status

```bash
# Generate coverage report
npm run translation:coverage -- --markdown > TRANSLATION_STATUS.md

# Validate all translations
npm run translation:validate -- --all

# Get untranslated strings
npm run translation:untranslated -- --plugin=fair-events --locale=fr_FR
```

## Troubleshooting

### "Translation file not found"

Run these commands first:
```bash
npm run makepot --workspace=PLUGIN_NAME
npm run updatepo --workspace=PLUGIN_NAME
```

### "Invalid plugin" error

Check available plugins in `scripts/translation/config.js` and ensure the plugin is listed.

### API key not working

- Verify the environment variable is set: `echo $OPENAI_API_KEY`
- Check the `.env` file exists and has the correct format
- Ensure the API key is valid and has sufficient credits

### Cost concerns

- Use `--skip-ai` flag to run validation/coverage without AI translation
- Start with a single locale to test: `--locale=fr_FR`
- Review cost estimate before confirming
