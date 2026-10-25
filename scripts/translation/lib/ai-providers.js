/**
 * AI Translation Providers
 *
 * Integrations with OpenAI and Claude APIs for automated translation.
 *
 * Both translate methods return `{ results, usage }`, where `results[i]` is
 * `{ ok: true, translation }` or `{ ok: false, reason }` for the i-th input,
 * so one bad entry never discards its siblings. A thrown error means the
 * whole response was unusable; `error.usage` holds what it cost when the
 * provider reported it. Providers make one request per call: retries are
 * owned by the caller (see translate-runner.js).
 */

import { config } from '../config.js';
import {
	markerInstructions,
	prepareEntries,
	restorePluralQuotes,
	restoreQuotes,
} from './quote-markers.js';

/**
 * Attach usage info to an error thrown after a billed response.
 *
 * @param {Error} error - Error to throw
 * @param {Object|null} usage - Usage info
 * @returns {Error} The same error
 */
function withUsage(error, usage) {
	if (usage) error.usage = usage;
	return error;
}

/**
 * Base AI Provider class
 */
class AIProvider {
	constructor(providerName) {
		this.config = config.ai.providers[providerName];
		this.apiKey = process.env[this.config.envVar];

		if (!this.apiKey) {
			throw new Error(
				`Missing API key: ${this.config.envVar} environment variable not set\n\n` +
					`   💡 To fix (option 1 - environment variable):\n` +
					`      export ${this.config.envVar}=your_key_here\n\n` +
					`   💡 To fix (option 2 - .env file):\n` +
					`      1. Copy .env.example to .env\n` +
					`      2. Add your key: ${this.config.envVar}=your_key_here`
			);
		}
	}

	/**
	 * Translate a batch of strings
	 *
	 * @param {Array<Object>} strings - Array of translation entries
	 * @param {string} targetLocale - Target locale code
	 * @returns {Promise<Object>} { results, usage }; each successful result
	 *   holds the translated string
	 */
	async translateBatch(strings, targetLocale) {
		const prepared = prepareEntries(strings, targetLocale);
		const { translations, usage } = await this.requestTranslations(
			prepared,
			strings,
			targetLocale
		);

		return {
			results: prepared.items.map((item, idx) => {
				const restored = restoreQuotes(
					translations[idx],
					item.msgid,
					targetLocale,
					prepared.style
				);
				return restored.ok
					? { ok: true, translation: restored.text }
					: restored;
			}),
			usage,
		};
	}

	/**
	 * Translate a batch of plural-form strings
	 *
	 * @param {Array<Object>} strings - Entries with msgid + msgidPlural
	 * @param {string} targetLocale - Target locale code
	 * @returns {Promise<Object>} { results, usage }; each successful result
	 *   holds the locale's plural forms for one entry
	 */
	async translatePluralBatch(strings, targetLocale) {
		const pluralForm = config.pluralForms[targetLocale] || {
			nplurals: 2,
			forms: ['singular', 'plural'],
		};
		const prepared = prepareEntries(strings, targetLocale);
		const { translations, usage } = await this.requestPluralTranslations(
			prepared,
			strings,
			targetLocale,
			pluralForm
		);

		return {
			results: prepared.items.map((item, idx) => {
				const restored = restorePluralQuotes(
					translations[idx],
					item,
					pluralForm.nplurals,
					targetLocale,
					prepared.style
				);
				return restored.ok
					? { ok: true, translation: restored.forms }
					: restored;
			}),
			usage,
		};
	}

	/**
	 * Send one singular request.
	 *
	 * @returns {Promise<Object>} { translations, usage } with one raw value
	 *   per input, in input order
	 */
	async requestTranslations(prepared, strings, targetLocale) {
		throw new Error('requestTranslations must be implemented by subclass');
	}

	/**
	 * Send one plural request.
	 *
	 * @returns {Promise<Object>} { translations, usage } with one raw forms
	 *   value per input, in input order
	 */
	async requestPluralTranslations(prepared, strings, targetLocale) {
		throw new Error(
			`Plural translation is not supported by the ${this.config.model} provider`
		);
	}

	/**
	 * Estimate cost for translation
	 *
	 * @param {number} inputTokens - Number of input tokens
	 * @param {number} outputTokens - Number of output tokens
	 * @returns {number} Estimated cost in dollars
	 */
	estimateCost(inputTokens, outputTokens) {
		const inputCost =
			(inputTokens / 1000) * this.config.costPer1kTokens.input;
		const outputCost =
			(outputTokens / 1000) * this.config.costPer1kTokens.output;
		return inputCost + outputCost;
	}
}

/**
 * Format the user-prompt input for singular strings.
 */
function singularInput(prepared, strings) {
	return prepared.items.map((item, idx) => ({
		index: idx,
		msgid: item.msgid.text,
		context: strings[idx].msgctxt || null,
		reference: strings[idx].references?.[0] || null,
	}));
}

/**
 * Format the user-prompt input for plural strings.
 */
function pluralInput(prepared, strings) {
	return prepared.items.map((item, idx) => ({
		index: idx,
		singular: item.msgid.text,
		plural: item.msgidPlural?.text ?? strings[idx].msgidPlural,
		context: strings[idx].msgctxt || null,
	}));
}

/**
 * Prompt suffix with the marker rules, or '' for locales without markers.
 */
function markerNote(targetLocale, prepared) {
	const note = markerInstructions(targetLocale, prepared.style);
	return note ? `\n${note}\n` : '';
}

/**
 * OpenAI Provider (GPT-4o-mini)
 */
class OpenAIProvider extends AIProvider {
	constructor() {
		super('openai');
	}

	async requestTranslations(prepared, strings, targetLocale) {
		const inputStrings = singularInput(prepared, strings);

		const userPrompt = `Translate the following WordPress plugin strings to ${
			config.localeNames[targetLocale]
		}.
Return a JSON object with a "translations" array containing the translated strings in the same order.
Each translation should be a string value.
${markerNote(targetLocale, prepared)}
Input strings:
${JSON.stringify(inputStrings, null, 2)}

Return format: {"translations": ["translation 1", "translation 2", ...]}`;

		const { result, usage } = await this.request(targetLocale, userPrompt);
		const translations = result.translations;

		if (
			!Array.isArray(translations) ||
			translations.length !== strings.length
		) {
			throw withUsage(
				new Error(
					`OpenAI returned invalid response: expected ${
						strings.length
					} translations, got ${
						Array.isArray(translations)
							? translations.length
							: typeof translations
					}`
				),
				usage
			);
		}

		return { translations, usage };
	}

	async requestPluralTranslations(
		prepared,
		strings,
		targetLocale,
		pluralForm
	) {
		const nplurals = pluralForm.nplurals;
		const inputStrings = pluralInput(prepared, strings);

		const formGuide = pluralForm.forms
			.map((f, i) => `   [${i}] used when ${f}`)
			.join('\n');

		const userPrompt = `Translate the following WordPress plural strings to ${
			config.localeNames[targetLocale]
		}.
This language has ${nplurals} plural forms. For each input string return an
array of exactly ${nplurals} translations, one per form, in this order:
${formGuide}
Preserve every printf placeholder (%d, %s, %1$d, etc.) in all forms.
${markerNote(targetLocale, prepared)}
Input strings (each has the English singular and plural):
${JSON.stringify(inputStrings, null, 2)}

Return a JSON object: {"translations": [["form 0", "form 1", ...], ...]} with
one inner array of exactly ${nplurals} strings per input string, in order.`;

		const { result, usage } = await this.request(targetLocale, userPrompt);
		const translations = result.translations;

		if (
			!Array.isArray(translations) ||
			translations.length !== strings.length
		) {
			throw withUsage(
				new Error(
					`OpenAI returned invalid response: expected ${
						strings.length
					} entries, got ${
						Array.isArray(translations)
							? translations.length
							: typeof translations
					}`
				),
				usage
			);
		}

		return { translations, usage };
	}

	/**
	 * Send one chat completion and parse its JSON object.
	 *
	 * @returns {Promise<Object>} { result, usage }
	 */
	async request(targetLocale, userPrompt) {
		const systemPrompt = config.ai.systemPrompt(targetLocale, {
			localeName: config.localeNames[targetLocale],
		});

		const response = await fetch(this.config.apiEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify({
				model: this.config.model,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt },
				],
				response_format: { type: 'json_object' },
				temperature: 0.3,
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`OpenAI API error (${response.status}): ${errorText}\n\n` +
					`   💡 To fix:\n` +
					`      1. Check your API key is valid\n` +
					`      2. Check your API quota: https://platform.openai.com/usage\n` +
					`      3. If rate limited, wait a few minutes and retry`
			);
		}

		const data = await response.json();
		const usage = data.usage
			? {
					inputTokens: data.usage.prompt_tokens,
					outputTokens: data.usage.completion_tokens,
					totalTokens: data.usage.total_tokens,
					cost: this.estimateCost(
						data.usage.prompt_tokens,
						data.usage.completion_tokens
					),
				}
			: null;

		let result;
		try {
			result = JSON.parse(data.choices?.[0]?.message?.content);
		} catch (e) {
			throw withUsage(
				new Error(`OpenAI returned invalid JSON: ${e.message}`),
				usage
			);
		}
		if (!result || typeof result !== 'object') {
			throw withUsage(
				new Error('OpenAI returned a non-object response'),
				usage
			);
		}

		return { result, usage };
	}
}

/**
 * Claude Provider (Claude Haiku)
 */
class ClaudeProvider extends AIProvider {
	constructor() {
		super('claude');
	}

	async requestTranslations(prepared, strings, targetLocale) {
		const inputStrings = singularInput(prepared, strings);

		const userPrompt = `Translate the following WordPress plugin strings to ${
			config.localeNames[targetLocale]
		}.
Return a JSON object with a "translations" object that maps "t<index>" to the
translated string for the input with that index (e.g. "t0", "t1", ...).
Each translation should be a single string value.
Never put the ASCII double quote character (") inside a translation unless the
input already contains it; use the target language's typographic quotation
marks instead.
${markerNote(targetLocale, prepared)}
Input strings:
${JSON.stringify(inputStrings, null, 2)}

Return format: {"translations": {"t0": "translation 1", "t1": "translation 2", ...}}`;

		// One required key per input string, so the schema itself fixes the
		// count: a translation containing quotes can no longer be split into
		// extra entries. The description carries the marked source text.
		const translationProperties = Object.fromEntries(
			inputStrings.map(({ index, msgid }) => [
				`t${index}`,
				{ type: 'string', description: msgid },
			])
		);

		// Use tool-use (structured output) so the API returns a validated
		// JSON object instead of free-form text. This avoids parse failures
		// from unescaped quotes/newlines that Claude occasionally emits,
		// especially for longer locales like German.
		const translationTool = {
			name: 'return_translations',
			// Strict mode makes the API enforce the schema, so
			// `translations` always comes back as a real object rather than
			// a stringified one with unescaped quotes.
			strict: true,
			description:
				'Return the translated strings in the same order and count as the input.',
			input_schema: {
				type: 'object',
				properties: {
					translations: {
						type: 'object',
						properties: translationProperties,
						required: Object.keys(translationProperties),
						additionalProperties: false,
						description:
							'Translated strings keyed by "t<index>" of the input string.',
					},
				},
				required: ['translations'],
				additionalProperties: false,
			},
		};

		const { result, usage } = await this.request(
			targetLocale,
			userPrompt,
			translationTool
		);
		const keyed = result.translations;

		if (!keyed || typeof keyed !== 'object' || Array.isArray(keyed)) {
			throw withUsage(
				new Error(
					`Claude returned invalid response: expected a "translations" object, got ${
						Array.isArray(keyed) ? 'array' : typeof keyed
					}`
				),
				usage
			);
		}

		return {
			translations: inputStrings.map(({ index }) => keyed[`t${index}`]),
			usage,
		};
	}

	async requestPluralTranslations(
		prepared,
		strings,
		targetLocale,
		pluralForm
	) {
		const nplurals = pluralForm.nplurals;
		const inputStrings = pluralInput(prepared, strings);

		const formGuide = pluralForm.forms
			.map((f, i) => `   [${i}] used when ${f}`)
			.join('\n');

		const userPrompt = `Translate the following WordPress plural strings to ${
			config.localeNames[targetLocale]
		}.
This language has ${nplurals} plural forms. For each input string return an
array of exactly ${nplurals} translations, one per form, in this order:
${formGuide}
Preserve every printf placeholder (%d, %s, %1$d, etc.) in all forms.
${markerNote(targetLocale, prepared)}
Input strings (each has the English singular and plural):
${JSON.stringify(inputStrings, null, 2)}

Return a JSON object whose "translations" is an array with one entry per input
string, and each entry is an array of exactly ${nplurals} translated strings.`;

		const translationTool = {
			name: 'return_plural_translations',
			description: `Return plural translations: one array of exactly ${nplurals} forms per input string.`,
			input_schema: {
				type: 'object',
				properties: {
					translations: {
						type: 'array',
						items: {
							type: 'array',
							items: { type: 'string' },
						},
						description: `One array of ${nplurals} translated forms per input string, in input order.`,
					},
				},
				required: ['translations'],
			},
		};

		const { result, usage } = await this.request(
			targetLocale,
			userPrompt,
			translationTool,
			{ textFallback: false }
		);
		const translations = result.translations;

		if (
			!Array.isArray(translations) ||
			translations.length !== strings.length
		) {
			throw withUsage(
				new Error(
					`Claude returned invalid response: expected ${
						strings.length
					} entries, got ${
						Array.isArray(translations)
							? translations.length
							: typeof translations
					}`
				),
				usage
			);
		}

		return { translations, usage };
	}

	/**
	 * Send one message forcing the given tool and return its input.
	 *
	 * @param {string} targetLocale - Target locale code
	 * @param {string} userPrompt - User prompt
	 * @param {Object} tool - Tool definition to force
	 * @param {Object} options - { textFallback } parses JSON from a text
	 *   block when no tool_use block came back
	 * @returns {Promise<Object>} { result, usage }
	 */
	async request(
		targetLocale,
		userPrompt,
		tool,
		{ textFallback = true } = {}
	) {
		const systemPrompt = config.ai.systemPrompt(targetLocale, {
			localeName: config.localeNames[targetLocale],
		});

		const response = await fetch(this.config.apiEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify({
				model: this.config.model,
				max_tokens: 8192,
				system: systemPrompt,
				messages: [{ role: 'user', content: userPrompt }],
				temperature: 0.3,
				tools: [tool],
				tool_choice: { type: 'tool', name: tool.name },
			}),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Claude API error (${response.status}): ${errorText}\n\n` +
					`   💡 To fix:\n` +
					`      1. Check your API key is valid\n` +
					`      2. Check your API quota: https://console.anthropic.com/\n` +
					`      3. If rate limited, wait a few minutes and retry`
			);
		}

		const data = await response.json();
		const usage = data.usage
			? {
					inputTokens: data.usage.input_tokens,
					outputTokens: data.usage.output_tokens,
					totalTokens:
						data.usage.input_tokens + data.usage.output_tokens,
					cost: this.estimateCost(
						data.usage.input_tokens,
						data.usage.output_tokens
					),
				}
			: null;

		// Prefer the structured tool_use output (parsed JSON object).
		const toolUse = data.content?.find((b) => b.type === 'tool_use');
		if (toolUse?.input && typeof toolUse.input === 'object') {
			return { result: toolUse.input, usage };
		}
		if (!textFallback) {
			throw withUsage(
				new Error('Claude returned no structured output'),
				usage
			);
		}

		// Fallback: parse JSON from a text block (older behavior), which
		// Claude sometimes wraps in a markdown code block.
		const contentText =
			data.content?.find((b) => b.type === 'text')?.text || '';
		const jsonMatch = contentText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
		try {
			const result = JSON.parse(jsonMatch ? jsonMatch[1] : contentText);
			if (!result || typeof result !== 'object') {
				throw new Error('not an object');
			}
			return { result, usage };
		} catch (e) {
			throw withUsage(
				new Error(
					`Claude returned invalid JSON: ${contentText.substring(
						0,
						200
					)}...`
				),
				usage
			);
		}
	}
}

/**
 * Get provider instance by name
 *
 * @param {string} providerName - 'openai' or 'claude'
 * @returns {AIProvider} Provider instance
 */
export function getProvider(providerName) {
	switch (providerName) {
		case 'openai':
			return new OpenAIProvider();
		case 'claude':
			return new ClaudeProvider();
		default:
			throw new Error(
				`Unknown provider: ${providerName}\n\n` +
					`   Available providers: openai, claude`
			);
	}
}
