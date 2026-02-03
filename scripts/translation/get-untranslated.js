#!/usr/bin/env node

/**
 * Get Untranslated Strings
 *
 * Extracts untranslated strings for a given plugin and locale.
 *
 * Usage:
 *   npm run translation:untranslated -- --plugin=fair-events --locale=fr_FR
 *   npm run translation:untranslated -- --plugin=fair-events --locale=fr_FR --output=untranslated.json
 *   npm run translation:untranslated -- --plugin=fair-events --locale=fr_FR --include-intentional
 */

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { parsePOFile, isUntranslated } from './lib/po-parser.js';
import { config } from './config.js';

const __filename = fileURLToPath( import.meta.url );
const __dirname = dirname( __filename );
const rootDir = join( __dirname, '../..' );

/**
 * Parse CLI arguments
 */
function parseArgs() {
	const args = process.argv.slice( 2 );
	const options = {
		plugin: null,
		locale: null,
		output: null,
		ignoreIntentional: true,
	};

	for ( const arg of args ) {
		if ( arg.startsWith( '--plugin=' ) ) {
			options.plugin = arg.substring( '--plugin='.length );
		} else if ( arg.startsWith( '--locale=' ) ) {
			options.locale = arg.substring( '--locale='.length );
		} else if ( arg.startsWith( '--output=' ) ) {
			options.output = arg.substring( '--output='.length );
		} else if ( arg === '--include-intentional' ) {
			options.ignoreIntentional = false;
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

	if ( ! options.locale ) {
		errors.push( 'Missing required argument: --locale=LOCALE_CODE' );
	} else if ( ! config.locales.includes( options.locale ) ) {
		errors.push( `Invalid locale: ${ options.locale }` );
		errors.push( `Available locales: ${ config.locales.join( ', ' ) }` );
	}

	return errors;
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
 * Main extraction function
 */
async function extractUntranslated( options ) {
	const poFilePath = join(
		rootDir,
		config.paths.poFile( options.plugin, options.locale )
	);

	try {
		const parsed = await parsePOFile( poFilePath );
		const untranslated = [];

		for ( const entry of parsed.translations ) {
			// Skip header entry
			if ( entry.isHeader ) continue;

			// Check if untranslated
			if ( isUntranslated( entry ) ) {
				// Skip intentionally untranslated if option enabled
				if (
					options.ignoreIntentional &&
					isIntentionallyUntranslated( entry.msgid )
				) {
					continue;
				}

				untranslated.push( {
					msgid: entry.msgid,
					msgidPlural: entry.msgidPlural || null,
					msgctxt: entry.msgctxt || null,
					references: entry.references || [],
					extractedComment: entry.extractedComment || null,
				} );
			}
		}

		return {
			plugin: options.plugin,
			locale: options.locale,
			localeName: config.localeNames[ options.locale ],
			totalStrings: parsed.translations.length - 1, // Exclude header
			untranslatedCount: untranslated.length,
			untranslated: untranslated,
			generatedAt: new Date().toISOString(),
		};
	} catch ( error ) {
		if ( error.code === 'ENOENT' ) {
			throw new Error(
				`Translation file not found: ${ poFilePath }\n` +
					`   \n` +
					`   💡 To fix:\n` +
					`      1. Generate POT: npm run makepot --workspace=${ options.plugin }\n` +
					`      2. Update PO: npm run updatepo --workspace=${ options.plugin }`
			);
		}
		throw error;
	}
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
			'  npm run translation:untranslated -- --plugin=PLUGIN --locale=LOCALE'
		);
		console.error( '\nExample:' );
		console.error(
			'  npm run translation:untranslated -- --plugin=fair-events --locale=fr_FR'
		);
		console.error( '\nOptions:' );
		console.error(
			'  --output=FILE              Save output to file instead of stdout'
		);
		console.error(
			'  --include-intentional      Include intentionally untranslated strings (URLs, names)'
		);
		process.exit( 1 );
	}

	try {
		console.error(
			`🔍 Extracting untranslated strings from ${ options.plugin } (${ options.locale })...\n`
		);

		const result = await extractUntranslated( options );

		// Output to file or stdout
		const output = JSON.stringify( result, null, 2 );

		if ( options.output ) {
			await writeFile( options.output, output, 'utf8' );
			console.error( `✅ Saved to ${ options.output }` );
		} else {
			console.log( output );
		}

		const percentage = (
			( result.untranslatedCount / result.totalStrings ) *
			100
		).toFixed( 1 );
		console.error(
			`\n📊 Summary: ${ result.untranslatedCount } untranslated of ${ result.totalStrings } strings (${ percentage }% untranslated)`
		);
	} catch ( error ) {
		console.error( `\n❌ Error: ${ error.message }` );
		process.exit( 1 );
	}
}

main();
