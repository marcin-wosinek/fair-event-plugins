#!/usr/bin/env node

/**
 * Translation Validator
 *
 * Validates translation integrity (placeholders, HTML tags, formatting).
 *
 * Usage:
 *   node scripts/translation/validate-translations.js --plugin=fair-events --locale=fr_FR
 *   node scripts/translation/validate-translations.js --all
 *   node scripts/translation/validate-translations.js --plugin=fair-events --locale=fr_FR --output=validation.json
 */

import { writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { parsePOFile } from './lib/po-parser.js';
import { validateEntry } from './lib/validators.js';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

/**
 * Parse CLI arguments
 */
function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		plugin: null,
		locale: null,
		all: false,
		output: null,
	};

	for (const arg of args) {
		if (arg.startsWith('--plugin=')) {
			options.plugin = arg.substring('--plugin='.length);
		} else if (arg.startsWith('--locale=')) {
			options.locale = arg.substring('--locale='.length);
		} else if (arg === '--all') {
			options.all = true;
		} else if (arg.startsWith('--output=')) {
			options.output = arg.substring('--output='.length);
		}
	}

	return options;
}

/**
 * Validate a plugin/locale pair
 */
async function validateTranslations(plugin, locale) {
	const poFilePath = join(rootDir, config.paths.poFile(plugin, locale));

	try {
		const parsed = await parsePOFile(poFilePath);

		const result = {
			plugin,
			locale,
			totalEntries: parsed.translations.filter((t) => !t.isHeader).length,
			errors: [],
			warnings: [],
			summary: {
				errorCount: 0,
				warningCount: 0,
				validEntries: 0,
			},
		};

		for (const entry of parsed.translations) {
			if (entry.isHeader) continue; // Skip header

			const { errors, warnings } = validateEntry(entry, locale);

			if (errors.length > 0 || warnings.length > 0) {
				result.errors.push(...errors);
				result.warnings.push(...warnings);
			} else if (entry.msgstr && entry.msgstr.length > 0) {
				result.summary.validEntries++;
			}
		}

		result.summary.errorCount = result.errors.length;
		result.summary.warningCount = result.warnings.length;

		return result;
	} catch (error) {
		if (error.code === 'ENOENT') {
			console.error(
				`⚠️  Warning: Translation file not found: ${poFilePath}`
			);
			return null;
		}
		throw error;
	}
}

/**
 * Main execution
 */
async function main() {
	const options = parseArgs();

	if (!options.all && (!options.plugin || !options.locale)) {
		console.error(
			'❌ Error: Specify --plugin and --locale, or use --all\n'
		);
		console.error('Usage:');
		console.error(
			'  node scripts/translation/validate-translations.js --plugin=PLUGIN --locale=LOCALE'
		);
		console.error(
			'  node scripts/translation/validate-translations.js --all'
		);
		console.error('\nExample:');
		console.error(
			'  node scripts/translation/validate-translations.js --plugin=fair-events --locale=fr_FR'
		);
		process.exit(1);
	}

	console.error('🔍 Validating translations...\n');

	const results = [];

	try {
		if (options.all) {
			// Validate all plugins and locales
			for (const plugin of config.plugins) {
				for (const locale of config.locales) {
					console.error(`Validating ${plugin.name} (${locale})...`);
					const result = await validateTranslations(
						plugin.name,
						locale
					);
					if (result) {
						results.push(result);
					}
				}
			}
		} else {
			const result = await validateTranslations(
				options.plugin,
				options.locale
			);
			if (result) {
				results.push(result);
			}
		}

		const finalReport = {
			generatedAt: new Date().toISOString(),
			totalPlugins: new Set(results.map((r) => r.plugin)).size,
			totalLocales: new Set(results.map((r) => r.locale)).size,
			summary: {
				totalErrors: results.reduce(
					(sum, r) => sum + r.summary.errorCount,
					0
				),
				totalWarnings: results.reduce(
					(sum, r) => sum + r.summary.warningCount,
					0
				),
				totalValidEntries: results.reduce(
					(sum, r) => sum + r.summary.validEntries,
					0
				),
			},
			results,
		};

		const output = JSON.stringify(finalReport, null, 2);

		if (options.output) {
			await writeFile(options.output, output, 'utf8');
			console.error(`\n✅ Validation report saved to ${options.output}`);
		} else {
			console.log(output);
		}

		// Summary
		console.error(`\n📊 Validation Summary:`);
		console.error(`   Errors: ${finalReport.summary.totalErrors}`);
		console.error(`   Warnings: ${finalReport.summary.totalWarnings}`);
		console.error(
			`   Valid Entries: ${finalReport.summary.totalValidEntries}`
		);

		// Exit with error code if errors found
		if (finalReport.summary.totalErrors > 0) {
			console.error(
				`\n⚠️  Found ${finalReport.summary.totalErrors} validation errors`
			);
			process.exit(1);
		} else if (finalReport.summary.totalWarnings > 0) {
			console.error(
				`\n⚠️  Found ${finalReport.summary.totalWarnings} warnings (no errors)`
			);
		} else {
			console.error('\n✅ All translations are valid!');
		}
	} catch (error) {
		console.error(`\n❌ Error: ${error.message}`);
		process.exit(1);
	}
}

main();
