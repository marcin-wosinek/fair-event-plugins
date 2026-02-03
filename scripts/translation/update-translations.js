#!/usr/bin/env node

/**
 * Translation Update Script
 *
 * Executes makepot and updatepo for multiple plugins with a single consolidated prompt.
 * This updates .pot and .po files for all specified plugins and locales.
 *
 * Usage:
 *   # Update all plugins (recommended)
 *   node scripts/translation/update-translations.js
 *
 *   # Update specific plugin
 *   node scripts/translation/update-translations.js --plugin=fair-events
 *
 *   # Run without confirmation (CI mode)
 *   node scripts/translation/update-translations.js --yes
 */

import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn } from 'child_process';
import readline from 'readline';
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
		yes: false,
	};

	for ( const arg of args ) {
		if ( arg.startsWith( '--plugin=' ) ) {
			options.plugin = arg.substring( '--plugin='.length );
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

	if (
		options.plugin &&
		! config.plugins.find( ( p ) => p.name === options.plugin )
	) {
		errors.push( `Invalid plugin: ${ options.plugin }` );
		errors.push(
			`Available plugins: ${ config.plugins
				.map( ( p ) => p.name )
				.join( ', ' ) }`
		);
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
 * Run an npm script
 *
 * @param {string} command - npm script command
 * @param {string} workspace - workspace name
 * @returns {Promise<{code: number}>}
 */
function runNpmScript( command, workspace ) {
	return new Promise( ( resolve, reject ) => {
		const args = [ 'run', command, '--workspace', workspace ];
		const child = spawn( 'npm', args, {
			stdio: 'inherit',
			cwd: rootDir,
		} );

		child.on( 'close', ( code ) => {
			resolve( { code } );
		} );

		child.on( 'error', ( error ) => {
			reject( error );
		} );
	} );
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
			'  node scripts/translation/update-translations.js [OPTIONS]'
		);
		console.error( '\nExamples:' );
		console.error( '  node scripts/translation/update-translations.js' );
		console.error(
			'  node scripts/translation/update-translations.js --plugin=fair-events'
		);
		console.error(
			'  node scripts/translation/update-translations.js --yes'
		);
		console.error( '\nOptions:' );
		console.error(
			'  --plugin=PLUGIN       Process specific plugin (default: all)'
		);
		console.error(
			'  --yes, -y             Skip confirmation prompts (for CI/automation)'
		);
		process.exit( 1 );
	}

	console.error( '🌍 Translation Update Script\n' );
	console.error( '='.repeat( 60 ) );

	// Determine scope
	const plugins = options.plugin
		? [ config.plugins.find( ( p ) => p.name === options.plugin ) ]
		: config.plugins;

	const locales = config.locales;

	console.error( '📦 Plugins:', plugins.map( ( p ) => p.name ).join( ', ' ) );
	console.error(
		'🌐 Locales:',
		locales
			.map( ( l ) => `${ l } (${ config.localeNames[ l ] })` )
			.join( ', ' )
	);
	console.error( '='.repeat( 60 ) );
	console.error( '' );

	// Show what will be done
	console.error( '📝 Operations:\n' );
	console.error( '   1. Generate .pot files (makepot)' );
	console.error( '   2. Update .po files from .pot (updatepo)' );
	console.error( '' );
	console.error( `   Total plugins: ${ plugins.length }` );
	console.error( `   Total locales: ${ locales.length }` );
	console.error( '' );

	// Confirmation (unless --yes flag is used)
	if ( ! options.yes ) {
		const proceed = await confirm(
			'Proceed with updating translation files?'
		);
		if ( ! proceed ) {
			console.error( '❌ Aborted by user' );
			process.exit( 0 );
		}
		console.error( '' );
	}

	// Execute for each plugin
	let allSuccess = true;
	const results = {
		success: [],
		failed: [],
	};

	for ( const plugin of plugins ) {
		console.error( `\n${ '─'.repeat( 60 ) }` );
		console.error( `📦 Processing ${ plugin.name }` );
		console.error( `${ '─'.repeat( 60 ) }\n` );

		try {
			// Step 1: Generate .pot file
			console.error( '  1️⃣  Running makepot...' );
			const makepotResult = await runNpmScript( 'makepot', plugin.name );

			if ( makepotResult.code !== 0 ) {
				throw new Error( 'makepot failed' );
			}
			console.error( '     ✅ .pot file generated\n' );

			// Step 2: Update .po files
			console.error( '  2️⃣  Running updatepo...' );
			const updatepoResult = await runNpmScript(
				'updatepo',
				plugin.name
			);

			if ( updatepoResult.code !== 0 ) {
				throw new Error( 'updatepo failed' );
			}
			console.error( `     ✅ ${ locales.length } .po files updated\n` );

			results.success.push( plugin.name );
			console.error( `✅ ${ plugin.name } completed successfully` );
		} catch ( error ) {
			allSuccess = false;
			results.failed.push( plugin.name );
			console.error( `\n❌ ${ plugin.name } failed: ${ error.message }` );

			if ( ! options.yes && plugins.length > 1 ) {
				const cont = await confirm(
					'Continue with remaining plugins?'
				);
				if ( ! cont ) {
					break;
				}
			}
		}
	}

	// Final summary
	console.error( '\n' + '='.repeat( 60 ) );
	console.error( '📊 Summary\n' );
	console.error( `   ✅ Successful: ${ results.success.length }` );
	if ( results.success.length > 0 ) {
		results.success.forEach( ( name ) =>
			console.error( `      - ${ name }` )
		);
	}

	if ( results.failed.length > 0 ) {
		console.error( `\n   ❌ Failed: ${ results.failed.length }` );
		results.failed.forEach( ( name ) =>
			console.error( `      - ${ name }` )
		);
	}

	console.error( '\n' + '='.repeat( 60 ) );

	if ( allSuccess ) {
		console.error( '✅ All plugins updated successfully!' );
	} else {
		console.error( '⚠️  Some plugins failed to update' );
	}

	console.error( '='.repeat( 60 ) );
	console.error( '' );

	console.error( '📦 Next steps (optional):' );
	console.error( '   - Translate missing strings with AI:' );
	console.error(
		'     npm run translation:ai -- --plugin=PLUGIN --locale=LOCALE --provider=openai'
	);
	console.error(
		'   - Compile .mo files: npm run makemo --workspace=PLUGIN'
	);
	console.error( '   - Build JavaScript: npm run build --workspace=PLUGIN' );

	process.exit( allSuccess ? 0 : 1 );
}

main();
