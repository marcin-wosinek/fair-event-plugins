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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

// Load environment variables from .env file if it exists
dotenv.config({ path: join(rootDir, '.env') });

/**
 * Parse CLI arguments
 */
function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		plugin: null,
		locale: null,
		provider: 'openai',
	};

	for (const arg of args) {
		if (arg.startsWith('--plugin=')) {
			options.plugin = arg.substring('--plugin='.length);
		} else if (arg.startsWith('--locale=')) {
			options.locale = arg.substring('--locale='.length);
		} else if (arg.startsWith('--provider=')) {
			options.provider = arg.substring('--provider='.length);
		}
	}

	return options;
}

/**
 * Validate arguments
 */
function validateArgs(options) {
	const errors = [];

	if (!options.plugin) {
		errors.push('Missing required argument: --plugin=PLUGIN_NAME');
	} else if (!config.plugins.find((p) => p.name === options.plugin)) {
		errors.push(`Invalid plugin: ${options.plugin}`);
		errors.push(
			`Available plugins: ${config.plugins.map((p) => p.name).join(', ')}`
		);
	}

	// Locale is optional - if not provided, all locales will be processed
	if (options.locale && !config.locales.includes(options.locale)) {
		errors.push(`Invalid locale: ${options.locale}`);
		errors.push(`Available locales: ${config.locales.join(', ')}`);
	}

	if (!['openai', 'claude'].includes(options.provider)) {
		errors.push(`Invalid provider: ${options.provider}`);
		errors.push('Available providers: openai, claude');
	}

	return errors;
}

/**
 * Prompt user for confirmation
 *
 * @param {string} question - Question to ask
 * @returns {Promise<boolean>} True if user confirms
 */
async function confirm(question) {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stderr,
	});

	return new Promise((resolve) => {
		rl.question(`${question} (y/n): `, (answer) => {
			rl.close();
			resolve(answer.toLowerCase() === 'y');
		});
	});
}

/**
 * Check if string is intentionally untranslated
 */
function isIntentionallyUntranslated(msgid) {
	return config.validation.ignorePatterns.some((pattern) =>
		pattern.test(msgid)
	);
}

/**
 * Main translation function
 */
async function aiTranslate(options) {
	const poFilePath = join(
		rootDir,
		config.paths.poFile(options.plugin, options.locale)
	);

	console.error(
		`🤖 AI-Assisted Translation: ${options.plugin} → ${config.localeNames[options.locale]}\n`
	);

	// Parse PO file
	const parsed = await parsePOFile(poFilePath);
	const untranslated = parsed.translations.filter((entry) => {
		if (entry.isHeader) return false;
		if (!isUntranslated(entry)) return false;
		// Skip plural forms (they need special handling)
		if (entry.msgidPlural) return false;
		// Skip intentionally untranslated
		if (isIntentionallyUntranslated(entry.msgid)) return false;
		return true;
	});

	if (untranslated.length === 0) {
		console.error('✅ All strings are already translated!');
		return;
	}

	console.error(`📝 Found ${untranslated.length} untranslated strings\n`);

	// Initialize AI provider
	let provider;
	try {
		provider = getProvider(options.provider);
	} catch (error) {
		console.error(`❌ ${error.message}`);
		process.exit(1);
	}

	console.error(
		`🔧 Provider: ${options.provider} (${provider.config.model})\n`
	);

	// Estimate cost
	const avgTokensPerString = 50; // Conservative estimate
	const estimatedInputTokens = untranslated.length * avgTokensPerString;
	const estimatedOutputTokens = untranslated.length * avgTokensPerString;
	const estimatedCost = provider.estimateCost(
		estimatedInputTokens,
		estimatedOutputTokens
	);

	console.error(`💰 Estimated cost: $${estimatedCost.toFixed(4)}`);
	console.error(`   (based on ~${avgTokensPerString} tokens per string)\n`);

	const proceed = await confirm(
		'Proceed with translation? This will update the .po file'
	);
	if (!proceed) {
		console.error('❌ Aborted by user');
		return;
	}
	console.error('');

	// Process in batches
	const batchSize = config.ai.batchSize;
	const results = [];
	let totalCost = 0;

	for (let i = 0; i < untranslated.length; i += batchSize) {
		const batch = untranslated.slice(i, i + batchSize);
		const batchNum = Math.floor(i / batchSize) + 1;
		const totalBatches = Math.ceil(untranslated.length / batchSize);

		console.error(
			`🔄 Processing batch ${batchNum}/${totalBatches} (${batch.length} strings)...`
		);

		try {
			const result = await provider.translateBatch(
				batch,
				options.locale,
				{}
			);

			for (let j = 0; j < batch.length; j++) {
				results.push({
					entry: batch[j],
					translation: result.translations[j],
				});
			}

			totalCost += result.usage.cost;
			console.error(
				`   ✅ Done (cost: $${result.usage.cost.toFixed(4)}, tokens: ${result.usage.totalTokens})`
			);
		} catch (error) {
			console.error(`   ❌ Error: ${error.message}`);

			// Ask if should continue
			const cont = await confirm('Continue with remaining batches?');
			if (!cont) break;
		}
	}

	console.error(`\n💰 Total cost: $${totalCost.toFixed(4)}`);
	console.error(
		`📊 Translated: ${results.length}/${untranslated.length} strings\n`
	);

	// Update PO file
	for (const result of results) {
		result.entry.msgstr = result.translation;
	}

	await writePOFile(poFilePath, parsed);
	console.error(`✅ Updated ${poFilePath}`);
	console.error('\n⚠️  Remember to run:');
	console.error(`   npm run makemo --workspace=${options.plugin}`);
	console.error(`   npm run build --workspace=${options.plugin}`);
}

/**
 * Main execution
 */
async function main() {
	const options = parseArgs();
	const errors = validateArgs(options);

	if (errors.length > 0) {
		console.error('❌ Error: Invalid arguments\n');
		errors.forEach((err) => console.error(`   ${err}`));
		console.error('\nUsage:');
		console.error(
			'  node scripts/translation/ai-translate.js --plugin=PLUGIN [--locale=LOCALE] --provider=PROVIDER'
		);
		console.error('\nExample (single locale):');
		console.error('  export OPENAI_API_KEY=your_key_here');
		console.error(
			'  node scripts/translation/ai-translate.js --plugin=fair-events --locale=fr_FR --provider=openai'
		);
		console.error('\nExample (all locales):');
		console.error(
			'  node scripts/translation/ai-translate.js --plugin=fair-events --provider=openai'
		);
		console.error('\nOptions:');
		console.error(
			'  --locale=LOCALE_CODE        Optional. If not provided, all locales will be translated'
		);
		console.error(
			'  --provider=openai|claude    AI provider to use (default: openai)'
		);
		console.error(
			'\nNote: This script always updates the .po file after translation.'
		);
		process.exit(1);
	}

	try {
		// If no locale specified, process all locales
		if (!options.locale) {
			console.error(
				`🌍 Processing all locales: ${config.locales.join(', ')}\n`
			);

			for (const locale of config.locales) {
				const localeOptions = { ...options, locale };
				console.error(`\n${'='.repeat(60)}`);
				console.error(`📍 Starting translation for ${locale}`);
				console.error(`${'='.repeat(60)}\n`);

				try {
					await aiTranslate(localeOptions);
				} catch (error) {
					console.error(
						`\n❌ Error translating ${locale}: ${error.message}`
					);
					// Continue with next locale instead of stopping
					continue;
				}
			}

			console.error(`\n${'='.repeat(60)}`);
			console.error('✅ All locales processed');
			console.error(`${'='.repeat(60)}\n`);
		} else {
			// Process single locale
			await aiTranslate(options);
		}
	} catch (error) {
		console.error(`\n❌ Error: ${error.message}`);
		if (error.stack) {
			console.error('\nStack trace:');
			console.error(error.stack);
		}
		process.exit(1);
	}
}

main();
