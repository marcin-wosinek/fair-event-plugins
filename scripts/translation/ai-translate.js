#!/usr/bin/env node

/**
 * AI-Assisted Translation
 *
 * Uses OpenAI or Claude APIs to automatically translate untranslated strings.
 * Always updates the .po file after translation.
 *
 * Usage:
 *   # Set API key (option 1: environment variable)
 *   export OPENAI_API_KEY=your_key_here
 *
 *   # Set API key (option 2: .env file)
 *   # Create .env file in project root with:
 *   # OPENAI_API_KEY=your_key_here
 *   # or
 *   # ANTHROPIC_API_KEY=your_key_here
 *
 *   # Translate with OpenAI
 *   node scripts/translation/ai-translate.js --plugin=fair-events --locale=fr_FR --provider=openai
 *
 *   # Translate with Claude
 *   node scripts/translation/ai-translate.js --plugin=fair-events --locale=fr_FR --provider=claude
 */

import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import readline from 'readline';
import dotenv from 'dotenv';
import { parsePOFile, isUntranslated } from './lib/po-parser.js';
import { writePOFile } from './lib/po-writer.js';
import { getProvider } from './lib/ai-providers.js';
import { config } from './config.js';

const __filename = fileURLToPath( import.meta.url );
const __dirname = dirname( __filename );
const rootDir = join( __dirname, '../..' );

// Load environment variables from .env file if it exists
dotenv.config( { path: join( rootDir, '.env' ) } );

/**
 * Parse CLI arguments
 */
function parseArgs() {
	const args = process.argv.slice( 2 );
	const options = {
		plugin: null,
		locale: null,
		provider: 'openai',
		yes: false,
	};

	for ( const arg of args ) {
		if ( arg.startsWith( '--plugin=' ) ) {
			options.plugin = arg.substring( '--plugin='.length );
		} else if ( arg.startsWith( '--locale=' ) ) {
			options.locale = arg.substring( '--locale='.length );
		} else if ( arg.startsWith( '--provider=' ) ) {
			options.provider = arg.substring( '--provider='.length );
		} else if ( arg === '--yes' || arg === '-y' ) {
			options.yes = true;
		}
	}

	return options;
}

/**
 * Validate arguments
 */
function validateArgs( options ) {
	const errors = [];

	if ( ! options.plugin ) {
		errors.push( 'Missing required argument: --plugin=PLUGIN_NAME' );
	} else if ( ! config.plugins.find( ( p ) => p.name === options.plugin ) ) {
		errors.push( `Invalid plugin: ${ options.plugin }` );
		errors.push(
			`Available plugins: ${ config.plugins
				.map( ( p ) => p.name )
				.join( ', ' ) }`
		);
	}

	// Locale is optional - if not provided, all locales will be processed
	if ( options.locale && ! config.locales.includes( options.locale ) ) {
		errors.push( `Invalid locale: ${ options.locale }` );
		errors.push( `Available locales: ${ config.locales.join( ', ' ) }` );
	}

	if ( ! [ 'openai', 'claude' ].includes( options.provider ) ) {
		errors.push( `Invalid provider: ${ options.provider }` );
		errors.push( 'Available providers: openai, claude' );
	}

	return errors;
}

/**
 * Prompt user for confirmation
 *
 * @param {string} question - Question to ask
 * @returns {Promise<boolean>} True if user confirms
 */
async function confirm( question ) {
	const rl = readline.createInterface( {
		input: process.stdin,
		output: process.stderr,
	} );

	return new Promise( ( resolve ) => {
		rl.question( `${ question } (y/n): `, ( answer ) => {
			rl.close();
			resolve( answer.toLowerCase() === 'y' );
		} );
	} );
}

/**
 * Check if string is intentionally untranslated
 */
function isIntentionallyUntranslated( msgid ) {
	return config.validation.ignorePatterns.some( ( pattern ) =>
		pattern.test( msgid )
	);
}

/**
 * Count untranslated strings for a plugin/locale pair
 *
 * @param {string} plugin - Plugin name
 * @param {string} locale - Locale code
 * @returns {Promise<number>} Number of untranslated strings
 */
async function countUntranslated( plugin, locale ) {
	const poFilePath = join( rootDir, config.paths.poFile( plugin, locale ) );

	try {
		const parsed = await parsePOFile( poFilePath );
		const untranslated = parsed.translations.filter( ( entry ) => {
			if ( entry.isHeader ) return false;
			if ( ! isUntranslated( entry ) ) return false;
			if ( entry.msgidPlural ) return false;
			if ( isIntentionallyUntranslated( entry.msgid ) ) return false;
			return true;
		} );

		return untranslated.length;
	} catch ( error ) {
		return 0;
	}
}

/**
 * Main translation function
 */
async function aiTranslate( options ) {
	const poFilePath = join(
		rootDir,
		config.paths.poFile( options.plugin, options.locale )
	);

	console.error(
		`🤖 AI-Assisted Translation: ${ options.plugin } → ${
			config.localeNames[ options.locale ]
		}\n`
	);

	// Parse PO file
	const parsed = await parsePOFile( poFilePath );
	const untranslated = parsed.translations.filter( ( entry ) => {
		if ( entry.isHeader ) return false;
		if ( ! isUntranslated( entry ) ) return false;
		// Skip plural forms (they need special handling)
		if ( entry.msgidPlural ) return false;
		// Skip intentionally untranslated
		if ( isIntentionallyUntranslated( entry.msgid ) ) return false;
		return true;
	} );

	if ( untranslated.length === 0 ) {
		console.error( '✅ All strings are already translated!' );
		return null;
	}

	console.error( `📝 Found ${ untranslated.length } untranslated strings\n` );

	// Initialize AI provider
	let provider;
	try {
		provider = getProvider( options.provider );
	} catch ( error ) {
		console.error( `❌ ${ error.message }` );
		process.exit( 1 );
	}

	console.error(
		`🔧 Provider: ${ options.provider } (${ provider.config.model })\n`
	);

	// Estimate cost
	const avgTokensPerString = 50; // Conservative estimate
	const estimatedInputTokens = untranslated.length * avgTokensPerString;
	const estimatedOutputTokens = untranslated.length * avgTokensPerString;
	const estimatedCost = provider.estimateCost(
		estimatedInputTokens,
		estimatedOutputTokens
	);

	console.error( `💰 Estimated cost: $${ estimatedCost.toFixed( 4 ) }` );
	console.error(
		`   (based on ~${ avgTokensPerString } tokens per string)\n`
	);

	// Skip confirmation if --yes flag is set OR if skipConfirmation is passed
	// (skipConfirmation is used when processing multiple locales with one confirmation)
	if ( ! options.yes && ! options.skipConfirmation ) {
		const proceed = await confirm(
			'Proceed with translation? This will update the .po file'
		);
		if ( ! proceed ) {
			console.error( '❌ Aborted by user' );
			return;
		}
		console.error( '' );
	} else if ( options.yes ) {
		console.error( '✓ Auto-confirming (--yes flag)\n' );
	} else if ( options.skipConfirmation ) {
		console.error( '✓ Proceeding (confirmed for all locales)\n' );
	}

	// Process in batches
	const batchSize = config.ai.batchSize;
	const results = [];
	let totalCost = 0;

	for ( let i = 0; i < untranslated.length; i += batchSize ) {
		const batch = untranslated.slice( i, i + batchSize );
		const batchNum = Math.floor( i / batchSize ) + 1;
		const totalBatches = Math.ceil( untranslated.length / batchSize );

		console.error(
			`🔄 Processing batch ${ batchNum }/${ totalBatches } (${ batch.length } strings)...`
		);

		try {
			const result = await provider.translateBatch(
				batch,
				options.locale,
				{}
			);

			for ( let j = 0; j < batch.length; j++ ) {
				results.push( {
					entry: batch[ j ],
					translation: result.translations[ j ],
				} );
			}

			totalCost += result.usage.cost;
			console.error(
				`   ✅ Done (cost: $${ result.usage.cost.toFixed(
					4
				) }, tokens: ${ result.usage.totalTokens })`
			);
		} catch ( error ) {
			console.error( `   ❌ Error: ${ error.message }` );

			// Ask if should continue (unless --yes flag is used)
			if ( ! options.yes ) {
				const cont = await confirm(
					'Continue with remaining batches?'
				);
				if ( ! cont ) break;
			}
		}
	}

	console.error( `\n💰 Total cost: $${ totalCost.toFixed( 4 ) }` );
	console.error(
		`📊 Translated: ${ results.length }/${ untranslated.length } strings\n`
	);

	// Update PO file
	for ( const result of results ) {
		result.entry.msgstr = result.translation;
	}

	await writePOFile( poFilePath, parsed );
	console.error( `✅ Updated ${ poFilePath }` );
	console.error( '\n⚠️  Remember to run:' );
	console.error( `   npm run makemo --workspace=${ options.plugin }` );
	console.error( `   npm run build --workspace=${ options.plugin }` );

	// Return results for multi-locale processing
	return {
		locale: options.locale,
		translatedCount: results.length,
		totalCount: untranslated.length,
		cost: totalCost,
	};
}

/**
 * Main execution
 */
async function main() {
	const options = parseArgs();
	const errors = validateArgs( options );

	if ( errors.length > 0 ) {
		console.error( '❌ Error: Invalid arguments\n' );
		errors.forEach( ( err ) => console.error( `   ${ err }` ) );
		console.error( '\nUsage:' );
		console.error(
			'  node scripts/translation/ai-translate.js --plugin=PLUGIN [--locale=LOCALE] --provider=PROVIDER'
		);
		console.error( '\nExample (single locale):' );
		console.error( '  export OPENAI_API_KEY=your_key_here' );
		console.error(
			'  node scripts/translation/ai-translate.js --plugin=fair-events --locale=fr_FR --provider=openai'
		);
		console.error( '\nExample (all locales):' );
		console.error(
			'  node scripts/translation/ai-translate.js --plugin=fair-events --provider=openai'
		);
		console.error( '\nOptions:' );
		console.error(
			'  --locale=LOCALE_CODE        Optional. If not provided, all locales will be translated'
		);
		console.error(
			'  --provider=openai|claude    AI provider to use (default: openai)'
		);
		console.error(
			'  --yes, -y                   Skip confirmation prompts (for automation)'
		);
		console.error(
			'\nNote: This script always updates the .po file after translation.'
		);
		process.exit( 1 );
	}

	try {
		// If no locale specified, process all locales
		if ( ! options.locale ) {
			console.error(
				`🌍 Processing all locales: ${ config.locales.join( ', ' ) }\n`
			);

			// Calculate total cost for all locales upfront
			console.error( '📊 Calculating translation requirements...\n' );

			let provider;
			try {
				provider = getProvider( options.provider );
			} catch ( error ) {
				console.error( `❌ ${ error.message }` );
				process.exit( 1 );
			}

			const localeData = [];
			let totalUntranslated = 0;

			for ( const locale of config.locales ) {
				const count = await countUntranslated( options.plugin, locale );
				localeData.push( {
					locale,
					count,
				} );
				totalUntranslated += count;
			}

			if ( totalUntranslated === 0 ) {
				console.error( '✅ All strings are already translated!' );
				return;
			}

			// Display breakdown
			console.error( '📝 Untranslated strings by locale:\n' );
			localeData.forEach( ( data ) => {
				if ( data.count > 0 ) {
					console.error(
						`   ${ data.locale } (${
							config.localeNames[ data.locale ]
						}): ${ data.count } strings`
					);
				}
			} );
			console.error( `\n   Total: ${ totalUntranslated } strings\n` );

			// Calculate total estimated cost
			const avgTokensPerString = 50;
			const estimatedInputTokens = totalUntranslated * avgTokensPerString;
			const estimatedOutputTokens =
				totalUntranslated * avgTokensPerString;
			const estimatedTotalCost = provider.estimateCost(
				estimatedInputTokens,
				estimatedOutputTokens
			);

			console.error(
				`🔧 Provider: ${ options.provider } (${ provider.config.model })`
			);
			console.error(
				`💰 Estimated total cost: $${ estimatedTotalCost.toFixed( 4 ) }`
			);
			console.error(
				`   (based on ~${ avgTokensPerString } tokens per string)\n`
			);

			// Single confirmation for all locales (unless --yes flag)
			if ( ! options.yes ) {
				const proceed = await confirm(
					'Proceed with translation for all locales? This will update all .po files'
				);
				if ( ! proceed ) {
					console.error( '❌ Aborted by user' );
					process.exit( 0 );
				}
				console.error( '' );
			} else {
				console.error( '✓ Auto-confirming (--yes flag)\n' );
			}

			// Process all locales with confirmation already given
			const translationResults = [];
			let actualTotalCost = 0;
			let totalTranslated = 0;

			for ( const locale of config.locales ) {
				const localeOptions = {
					...options,
					locale,
					skipConfirmation: true,
				};
				console.error( `\n${ '='.repeat( 60 ) }` );
				console.error(
					`📍 Starting translation for ${ locale } (${ config.localeNames[ locale ] })`
				);
				console.error( `${ '='.repeat( 60 ) }\n` );

				try {
					const result = await aiTranslate( localeOptions );
					if ( result ) {
						translationResults.push( result );
						actualTotalCost += result.cost;
						totalTranslated += result.translatedCount;
					}
				} catch ( error ) {
					console.error(
						`\n❌ Error translating ${ locale }: ${ error.message }`
					);
					// Continue with next locale instead of stopping
					continue;
				}
			}

			// Final summary
			console.error( `\n${ '='.repeat( 60 ) }` );
			console.error( '✅ All locales processed' );
			console.error( `${ '='.repeat( 60 ) }` );
			console.error( '\n📊 Final Summary:\n' );
			translationResults.forEach( ( result ) => {
				console.error(
					`   ${ result.locale } (${
						config.localeNames[ result.locale ]
					}): ${ result.translatedCount }/${
						result.totalCount
					} strings - $${ result.cost.toFixed( 4 ) }`
				);
			} );
			console.error(
				`\n   💰 Total actual cost: $${ actualTotalCost.toFixed( 4 ) }`
			);
			console.error(
				`   📝 Total translated: ${ totalTranslated } strings\n`
			);
			console.error( `${ '='.repeat( 60 ) }\n` );
		} else {
			// Process single locale
			await aiTranslate( options );
		}
	} catch ( error ) {
		console.error( `\n❌ Error: ${ error.message }` );
		if ( error.stack ) {
			console.error( '\nStack trace:' );
			console.error( error.stack );
		}
		process.exit( 1 );
	}
}

main();
