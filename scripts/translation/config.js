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
		{
			name: 'fair-audience-experimental',
			textDomain: 'fair-audience-experimental',
		},
		{
			name: 'fair-calendar-button',
			textDomain: 'fair-calendar-button',
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

	// Map our gettext locales to translate.wordpress.org locale slugs.
	// Used by sync-from-wporg.js to build GlotPress export URLs.
	wpOrgLocales: {
		de_DE: 'de',
		es_ES: 'es',
		fr_FR: 'fr',
		pl_PL: 'pl',
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

			// Source: "Konwencje przyjęte w polskim tłumaczeniu WordPressa"
			// (WordPress Codex, pl: namespace).
			pl_PL: `Polish (pl_PL) WordPress conventions (from the official pl_PL Codex page "Konwencje przyjęte w polskim tłumaczeniu WordPressa"):

FORM OF ADDRESS
- Informal second person singular (ty), never the formal "proszę + infinitive" and never "Państwo". Write "Spróbuj ponownie.", not "Proszę spróbować ponownie."; "Wybierz źródła wydarzeń.", not "Proszę wybrać źródła wydarzeń.".
- Personal pronouns are ALWAYS lowercase — capitals are for letters/correspondence only. "twój adres e-mail", "jeśli nie prosiłeś", never "Twój adres e-mail".
- Sentence case, not title case: "Lista wydarzeń", not "Lista Wydarzeń". Keep product names capitalised as-is.

PUNCTUATION AND TYPOGRAPHY
- Polish quotation marks „…” (U+201E opening, U+201D closing). Never "…" or «…». Use them when naming a UI element inside a sentence: kliknij „Anuluj”.
- Ellipsis is the single character … (U+2026), never three dots "...". "Wczytywanie…", not "Wczytywanie...".
- Dash is – (en dash, U+2013), never the keyboard hyphen "-". "Fair Platform – Ustawienia", not "Fair Platform - Ustawienia". A hyphen only joins compounds (e-mail, biało-czerwony).
- Write these characters literally; do NOT emit HTML entities (&bdquo;, &rdquo;, &ndash;, &hellip;).

INFLECTION
- "WordPress" is inflected: WordPressa, WordPressowi, WordPressie.
- "blog" takes -u in the genitive: "blogu", never "bloga".
- "importer": importera (gen.), importer (acc.), importery (nom. pl.).
- "witryna" is the whole site; "strona" is a single page within it (like a page in a book). Do not use "strona" for the site.
- "arkusz stylów" (not "arkusz stylu"), "kierunek pisania" (not "kierunek tekstu").

GLOSSARY (English → Polish)
- activate/enable → "włącz" in almost every case. Reserve "aktywuj" for activating an account or a site.
- admin bar → "pasek administratora"; sidebar → "panel boczny" (widget areas are a "panel"; a "pasek" is e.g. a toolbar); panel → "ekran" when it means a screen, otherwise "panel"; screen → "ekran".
- avatar → "obrazek profilowy"; image → "obrazek" (NOT "obraz"); thumbnail (theme thumbnail) → "ikona".
- await moderation → "oczekiwać na moderację"; affect/reflect → "mieć wpływ".
- cache → "pamięć podręczna"; persistent cache → "trwała pamięć podręczna".
- child theme → "motyw potomny"; parent theme → "motyw nadrzędny"; theme → "motyw".
- compatible → "zgodny"; could not… → "nie można było…"; credits → "autorzy".
- current (in the sense of "in use") → "używany"; customize → "spersonalizuj".
- dashboard → "kokpit" (never "pulpit"/"panel sterowania").
- deprecated → "przestarzała praktyka"; documentation on → "dokumentacja dot.".
- embed → "osadzać"; feature → "funkcja"; feedback → "uwagi"; front page → "strona główna".
- ID → "identyfikator"; layout → "układ"; link → "odnośnik" (NOT "link"); permalink → "bezpośredni odnośnik".
- load → "wczytywać" (not "ładować"); log in → "logować się".
- maintenance release → "wydanie z poprawkami błędów"; security release → "wydanie z poprawkami błędów w zabezpieczeniach"; release → "wydanie"; security → "zabezpieczenia".
- media library → "biblioteka mediów"; network (multisite) → "sieć witryn".
- plugin → "wtyczka"; post format → "format wpisu"; post type → "typ wpisu" (format and type are different things).
- preview → "podgląd" (noun), "podejrzyj" (verb); protected → "zabezpieczony".
- rating → "klasyfikacja" for content ratings, "ocena" for star ratings.
- remove/delete → "usuwać"; revision → "wersja"; term → "taksonomia".
- slug → "uproszczona nazwa" (e.g. post slug → "uproszczona nazwa wpisu"); static → "statyczny".
- support → "wspierać"/"wsparcie"/"pomoc techniczna"/"obsługiwać" ("… is not supported" → "… nie jest obsługiwane").
- URL → "adres URL" (always with "adres", never bare "URL").
- view → "zobacz"; visit (your own site) → "przejdź na witrynę" (not "odwiedź").

STOCK PHRASES
- "Sorry, you are not allowed to…" → "Przepraszamy, nie posiadasz uprawnienia do…".
- "You are about to X. 'Cancel' to stop, 'OK' to Y." → Zamierzasz X. Kliknij „Anuluj”, aby anulować tę operację, lub „OK”, aby ją sfinalizować.`,
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
