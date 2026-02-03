/**
 * AI Translation Providers
 *
 * Integrations with OpenAI and Claude APIs for automated translation.
 */

import { config } from '../config.js';

/**
 * Base AI Provider class
 */
class AIProvider {
	constructor( providerName ) {
		this.config = config.ai.providers[ providerName ];
		this.apiKey = process.env[ this.config.envVar ];

		if ( ! this.apiKey ) {
			throw new Error(
				`Missing API key: ${ this.config.envVar } environment variable not set\n\n` +
					`   💡 To fix (option 1 - environment variable):\n` +
					`      export ${ this.config.envVar }=your_key_here\n\n` +
					`   💡 To fix (option 2 - .env file):\n` +
					`      1. Copy .env.example to .env\n` +
					`      2. Add your key: ${ this.config.envVar }=your_key_here`
			);
		}
	}

	/**
	 * Translate a batch of strings
	 *
	 * @param {Array<Object>} strings - Array of translation entries
	 * @param {string} targetLocale - Target locale code
	 * @param {Object} context - Additional context
	 * @returns {Promise<Object>} Object with translations array and usage info
	 */
	async translateBatch( strings, targetLocale, context ) {
		throw new Error( 'translateBatch must be implemented by subclass' );
	}

	/**
	 * Estimate cost for translation
	 *
	 * @param {number} inputTokens - Number of input tokens
	 * @param {number} outputTokens - Number of output tokens
	 * @returns {number} Estimated cost in dollars
	 */
	estimateCost( inputTokens, outputTokens ) {
		const inputCost =
			( inputTokens / 1000 ) * this.config.costPer1kTokens.input;
		const outputCost =
			( outputTokens / 1000 ) * this.config.costPer1kTokens.output;
		return inputCost + outputCost;
	}
}

/**
 * OpenAI Provider (GPT-4o-mini)
 */
class OpenAIProvider extends AIProvider {
	constructor() {
		super( 'openai' );
	}

	async translateBatch( strings, targetLocale, context ) {
		const systemPrompt = config.ai.systemPrompt( targetLocale, {
			localeName: config.localeNames[ targetLocale ],
		} );

		// Format input for the AI
		const inputStrings = strings.map( ( s, idx ) => ( {
			index: idx,
			msgid: s.msgid,
			context: s.msgctxt || null,
			reference: s.references?.[ 0 ] || null,
		} ) );

		const userPrompt = `Translate the following WordPress plugin strings to ${
			config.localeNames[ targetLocale ]
		}.
Return a JSON object with a "translations" array containing the translated strings in the same order.
Each translation should be a string value.

Input strings:
${ JSON.stringify( inputStrings, null, 2 ) }

Return format: {"translations": ["translation 1", "translation 2", ...]}`;

		const response = await fetch( this.config.apiEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${ this.apiKey }`,
			},
			body: JSON.stringify( {
				model: this.config.model,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt },
				],
				response_format: { type: 'json_object' },
				temperature: 0.3,
			} ),
		} );

		if ( ! response.ok ) {
			const errorText = await response.text();
			throw new Error(
				`OpenAI API error (${ response.status }): ${ errorText }\n\n` +
					`   💡 To fix:\n` +
					`      1. Check your API key is valid\n` +
					`      2. Check your API quota: https://platform.openai.com/usage\n` +
					`      3. If rate limited, wait a few minutes and retry`
			);
		}

		const data = await response.json();
		const result = JSON.parse( data.choices[ 0 ].message.content );
		let translations = result.translations;

		if (
			! Array.isArray( translations ) ||
			translations.length !== strings.length
		) {
			throw new Error(
				`OpenAI returned invalid response: expected ${
					strings.length
				} translations, got ${ translations?.length || 0 }`
			);
		}

		// Normalize translations to strings (in case AI returns objects)
		translations = translations.map( ( t ) => {
			if ( typeof t === 'string' ) return t;
			if ( typeof t === 'object' && t !== null ) {
				// If it's an object, try to extract the translation field
				return t.translation || t.msgstr || String( t );
			}
			return String( t );
		} );

		return {
			translations,
			usage: {
				inputTokens: data.usage.prompt_tokens,
				outputTokens: data.usage.completion_tokens,
				totalTokens: data.usage.total_tokens,
				cost: this.estimateCost(
					data.usage.prompt_tokens,
					data.usage.completion_tokens
				),
			},
		};
	}
}

/**
 * Claude Provider (Claude 3.5 Haiku)
 */
class ClaudeProvider extends AIProvider {
	constructor() {
		super( 'claude' );
	}

	async translateBatch( strings, targetLocale, context ) {
		const systemPrompt = config.ai.systemPrompt( targetLocale, {
			localeName: config.localeNames[ targetLocale ],
		} );

		// Format input for the AI
		const inputStrings = strings.map( ( s, idx ) => ( {
			index: idx,
			msgid: s.msgid,
			context: s.msgctxt || null,
			reference: s.references?.[ 0 ] || null,
		} ) );

		const userPrompt = `Translate the following WordPress plugin strings to ${
			config.localeNames[ targetLocale ]
		}.
Return a JSON object with a "translations" array containing the translated strings in the same order.
Each translation should be a string value.

Input strings:
${ JSON.stringify( inputStrings, null, 2 ) }

Return format: {"translations": ["translation 1", "translation 2", ...]}`;

		const response = await fetch( this.config.apiEndpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-api-key': this.apiKey,
				'anthropic-version': '2023-06-01',
			},
			body: JSON.stringify( {
				model: this.config.model,
				max_tokens: 4096,
				system: systemPrompt,
				messages: [ { role: 'user', content: userPrompt } ],
				temperature: 0.3,
			} ),
		} );

		if ( ! response.ok ) {
			const errorText = await response.text();
			throw new Error(
				`Claude API error (${ response.status }): ${ errorText }\n\n` +
					`   💡 To fix:\n` +
					`      1. Check your API key is valid\n` +
					`      2. Check your API quota: https://console.anthropic.com/\n` +
					`      3. If rate limited, wait a few minutes and retry`
			);
		}

		const data = await response.json();
		const contentText = data.content[ 0 ].text;

		// Try to extract JSON from the response
		let result;
		try {
			result = JSON.parse( contentText );
		} catch ( e ) {
			// Sometimes Claude wraps JSON in markdown code blocks
			const jsonMatch = contentText.match(
				/```(?:json)?\s*([\s\S]*?)\s*```/
			);
			if ( jsonMatch ) {
				result = JSON.parse( jsonMatch[ 1 ] );
			} else {
				throw new Error(
					`Claude returned invalid JSON: ${ contentText.substring(
						0,
						200
					) }...`
				);
			}
		}

		let translations = result.translations;

		if (
			! Array.isArray( translations ) ||
			translations.length !== strings.length
		) {
			throw new Error(
				`Claude returned invalid response: expected ${
					strings.length
				} translations, got ${ translations?.length || 0 }`
			);
		}

		// Normalize translations to strings (in case AI returns objects)
		translations = translations.map( ( t ) => {
			if ( typeof t === 'string' ) return t;
			if ( typeof t === 'object' && t !== null ) {
				// If it's an object, try to extract the translation field
				return t.translation || t.msgstr || String( t );
			}
			return String( t );
		} );

		return {
			translations,
			usage: {
				inputTokens: data.usage.input_tokens,
				outputTokens: data.usage.output_tokens,
				totalTokens: data.usage.input_tokens + data.usage.output_tokens,
				cost: this.estimateCost(
					data.usage.input_tokens,
					data.usage.output_tokens
				),
			},
		};
	}
}

/**
 * Get provider instance by name
 *
 * @param {string} providerName - 'openai' or 'claude'
 * @returns {AIProvider} Provider instance
 */
export function getProvider( providerName ) {
	switch ( providerName ) {
		case 'openai':
			return new OpenAIProvider();
		case 'claude':
			return new ClaudeProvider();
		default:
			throw new Error(
				`Unknown provider: ${ providerName }\n\n` +
					`   Available providers: openai, claude`
			);
	}
}
