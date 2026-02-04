/**
 * Translation Utilities Configuration
 *
 * Central configuration for all translation management tools.
 */

export const config = {
	// Active plugins with translations
	plugins: [
		{ name: 'fair-audience', textDomain: 'fair-audience' },
		{ name: 'fair-events', textDomain: 'fair-events' },
	],

	// Supported locales
	locales: ['de_DE', 'es_ES', 'fr_FR', 'pl_PL'],

	// Locale metadata
	localeNames: {
		de_DE: 'German',
		es_ES: 'Spanish',
		fr_FR: 'French',
		pl_PL: 'Polish',
	},

	// Path patterns
	paths: {
		languagesDir: (plugin) => `${plugin}/languages`,
		poFile: (plugin, locale) =>
			`${plugin}/languages/${plugin}-${locale}.po`,
		potFile: (plugin) => `${plugin}/languages/${plugin}.pot`,
	},

	// Validation rules
	validation: {
		// Placeholder patterns to match
		placeholderPatterns: [
			/%[sdfxXouceEgG]/g, // printf-style: %s, %d, %f, etc.
			/%\d+\$[sdfxXouceEgG]/g, // Positional printf: %1$s, %2$d
			/\{\{[^}]+\}\}/g, // React variables: {{variable}}
		],

		// Strings that are intentionally untranslated
		ignorePatterns: [
			/^https?:\/\//, // URLs
			/^Marcin Wosinek$/, // Author name
			/^Fair Events$/, // Plugin name
			/^Fair Calendar Button$/, // Plugin name
			/^Fair RSVP$/, // Plugin name
			/^Fair Membership$/, // Plugin name
			/^Fair Team$/, // Plugin name
			/^Fair Audience$/, // Plugin name
			/^Fair Payment$/, // Plugin name
			/^Fair Platform$/, // Plugin name
		],
	},

	// AI provider configurations
	ai: {
		providers: {
			openai: {
				model: 'gpt-4o-mini',
				apiEndpoint: 'https://api.openai.com/v1/chat/completions',
				envVar: 'OPENAI_API_KEY',
				costPer1kTokens: { input: 0.00015, output: 0.0006 },
			},
			claude: {
				model: 'claude-3-5-haiku-20241022',
				apiEndpoint: 'https://api.anthropic.com/v1/messages',
				envVar: 'ANTHROPIC_API_KEY',
				costPer1kTokens: { input: 0.0008, output: 0.004 },
			},
		},

		// Batch size for API calls
		batchSize: 20,

		// System prompt template
		systemPrompt: (locale, context) =>
			`You are a professional translator.
Translate WordPress plugin strings from English to ${context.localeName} (${locale}).
Maintain formatting, placeholders (%s, %d, {{variable}}), and HTML tags.
Consider WordPress conventions and the plugin context.
IMPORTANT: Keep "Fair Event:" prefix untranslated - it's a product name. Only translate the part after the colon.
Example: "Fair Event: Start Date" → "Fair Event: Startdatum" (German), "Fair Event: Fecha de inicio" (Spanish).
Return translations in the same order as the input.`,
	},
};
