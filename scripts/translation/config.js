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
		{
			name: 'fair-payments-connector',
			textDomain: 'fair-payments-connector',
		},
		{ name: 'fair-platform', textDomain: 'fair-platform' },
		{ name: 'fair-timetable', textDomain: 'fair-timetable' },
		{
			name: 'fair-events-experimental',
			textDomain: 'fair-events-experimental',
		},
		{ name: 'fair-finance', textDomain: 'fair-finance' },
		{ name: 'fair-form', textDomain: 'fair-form' },
		{
			name: 'fair-payments-connector-experimental',
			textDomain: 'fair-payments-connector-experimental',
		},
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
			/^Fair Payments Connector$/, // Plugin name
			/^Fair Platform$/, // Plugin name
			/^Fair Timetable$/, // Plugin name
			/^Fair Finance$/, // Plugin name
			/^Fair Form$/, // Plugin name
		],
	},

	// Plural-form rules per locale (standard gettext). `nplurals` is how many
	// msgstr[n] slots a plural entry has; `forms` describes when each index
	// applies so the AI knows which translation goes in which slot.
	pluralForms: {
		de_DE: {
			nplurals: 2,
			forms: ['n == 1 (singular)', 'n != 1 (plural)'],
		},
		es_ES: {
			nplurals: 2,
			forms: ['n == 1 (singular)', 'n != 1 (plural)'],
		},
		fr_FR: {
			nplurals: 2,
			forms: ['n <= 1 (singular)', 'n > 1 (plural)'],
		},
		pl_PL: {
			nplurals: 3,
			forms: [
				'n == 1',
				'n%10 in 2..4 and n%100 not in 12..14 (e.g. 2, 3, 4, 22)',
				'everything else (e.g. 0, 5, 11, 25)',
			],
		},
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
				model: 'claude-haiku-4-5-20251001',
				apiEndpoint: 'https://api.anthropic.com/v1/messages',
				envVar: 'ANTHROPIC_API_KEY',
				costPer1kTokens: { input: 0.0008, output: 0.004 },
			},
		},

		// Batch size for API calls
		batchSize: 20,

		// Per-locale style notes injected into the system prompt
		localeConventions: {
			es_ES: `Spanish (es_ES) WordPress conventions (aligned with the official es_ES community at translate.wordpress.org):
- Sentence case, NOT title case. Only the first word and proper nouns are capitalised. "Guardar evento" not "Guardar Evento".
- Informal second person (tú). Imperatives: "selecciona", "elige", "define", "guarda" — never "seleccione", "elija", "defina", "guarde". Possessives: "tu correo" not "su correo".
- Inverted opening punctuation: "¿…?" and "¡…!".
- Use «guillemets» when quoting a UI element name inside a longer sentence. Examples: "en la pestaña «Grupos»", "en el panel «Detalles del evento»". Do NOT use them for standalone labels or button text.
- "URL" is feminine: "la URL", "una URL". Adjectives and past participles agree accordingly: "la URL usada", not "el URL usado".
- Abbreviate "e.g." as "p. ej." (with spaces and both periods).
- "Query Loop" → "el bucle de consulta". Prefer "mediante" over "usando" when describing a WordPress mechanism: "mediante el bucle de consulta", not "usando Query Loop".
- Established WordPress Spanish terms: "Ajustes" (Settings), "Escritorio" (Dashboard), "Entrada" (Post), "Página" (Page), "Tema" (Theme), "Calendario" (Calendar), "Slug" (Slug, kept in English).`,
		},

		// System prompt template
		systemPrompt: (locale, context) => {
			const conventionNote = config.ai.localeConventions[locale]
				? `\n\n${config.ai.localeConventions[locale]}`
				: '';
			return `You are a professional translator.
Translate WordPress plugin strings from English to ${context.localeName} (${locale}).
Maintain formatting, placeholders (%s, %d, {{variable}}), and HTML tags.
Consider WordPress conventions and the plugin context.
IMPORTANT: Keep "Fair Event:" prefix untranslated - it's a product name. Only translate the part after the colon.
Example: "Fair Event: Start Date" → "Fair Event: Startdatum" (German), "Fair Event: Fecha de inicio" (Spanish).
Return translations in the same order as the input.${conventionNote}`;
		},
	},
};
