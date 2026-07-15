#!/usr/bin/env node

/**
 * Export Local Translations for Import to translate.wordpress.org
 *
 * Writes a .po file per plugin/locale containing ONLY the local translations
 * that WordPress.org does NOT already have a non-empty translation for.
 * Community-approved strings (anything already translated on GlotPress,
 * `stable` or `dev`) are always excluded, so importing the output can never
 * override work the community has already done — it only fills gaps.
 *
 * The output is a plain .po file suitable for GlotPress's "Import
 * Translations" upload (Project Translation Editor / admin permission
 * required on translate.wordpress.org) or for pasting individual strings
 * into the suggestion UI.
 *
 * Usage:
 *   # All plugins, all locales — preview first
 *   node scripts/translation/export-for-wporg.js --dry-run
 *
 *   # Write the import files
 *   node scripts/translation/export-for-wporg.js
 *
 *   # Single plugin / locale
 *   node scripts/translation/export-for-wporg.js --plugin=fair-events --locale=es_ES
 *
 *   # Custom output directory (default: <plugin>/languages/wporg-import/)
 *   node scripts/translation/export-for-wporg.js --output-dir=/tmp/wporg-import
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { access, mkdir } from 'fs/promises';
import { config } from './config.js';
import { parsePOFile } from './lib/po-parser.js';
import { writePOFile } from './lib/po-writer.js';
import { entryKey, isTranslated, fetchCommunity } from './lib/wporg.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

const VALID_SETS = ['stable', 'dev', 'both'];

function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		plugin: null,
		locale: null,
		set: 'both',
		outputDir: null,
		dryRun: false,
	};

	for (const arg of args) {
		if (arg.startsWith('--plugin=')) {
			options.plugin = arg.substring('--plugin='.length);
		} else if (arg.startsWith('--locale=')) {
			options.locale = arg.substring('--locale='.length);
		} else if (arg.startsWith('--set=')) {
			options.set = arg.substring('--set='.length);
		} else if (arg.startsWith('--output-dir=')) {
			options.outputDir = arg.substring('--output-dir='.length);
		} else if (arg === '--dry-run') {
			options.dryRun = true;
		}
	}

	return options;
}

function validateArgs(options) {
	const errors = [];

	if (
		options.plugin &&
		!config.plugins.find((p) => p.name === options.plugin)
	) {
		errors.push(`Invalid plugin: ${options.plugin}`);
		errors.push(
			`Available plugins: ${config.plugins.map((p) => p.name).join(', ')}`
		);
	}

	if (options.locale && !config.locales.includes(options.locale)) {
		errors.push(`Invalid locale: ${options.locale}`);
		errors.push(`Available locales: ${config.locales.join(', ')}`);
	}

	if (!VALID_SETS.includes(options.set)) {
		errors.push(`Invalid set: ${options.set}`);
		errors.push(`Available sets: ${VALID_SETS.join(', ')}`);
	}

	return errors;
}

async function fileExists(filePath) {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Export one plugin/locale. Returns a result summary.
 */
async function exportOne(plugin, locale, options) {
	const wpLocale = config.wpOrgLocales[locale];
	const slug = plugin.wpOrgSlug || plugin.name;
	const relPath = config.paths.poFile(plugin.name, locale);
	const poPath = join(rootDir, relPath);

	if (!wpLocale) {
		return { skipped: `no WordPress.org locale mapping for ${locale}` };
	}
	if (!(await fileExists(poPath))) {
		return { skipped: `local .po not found: ${relPath}` };
	}

	const community = await fetchCommunity(slug, options.set, wpLocale);
	if (community === null) {
		return { skipped: `no WordPress.org project for ${slug}` };
	}

	const parsed = await parsePOFile(poPath);
	const missing = [];

	for (const entry of parsed.translations) {
		if (entry.isHeader || entry.msgid === undefined) continue;
		if (!isTranslated(entry.msgstr)) continue; // nothing local to offer
		if (community.has(entryKey(entry))) continue; // community already has this — never override

		missing.push(entry);
	}

	if (missing.length === 0) {
		return { exported: 0 };
	}

	const outputDir = options.outputDir
		? join(options.outputDir)
		: join(rootDir, config.paths.languagesDir(plugin.name), 'wporg-import');
	const outputPath = join(outputDir, `${plugin.name}-${locale}.po`);

	if (!options.dryRun) {
		await mkdir(outputDir, { recursive: true });
		await writePOFile(outputPath, {
			metadata: parsed.metadata,
			translations: missing,
		});
	}

	return { exported: missing.length, outputPath, entries: missing };
}

async function main() {
	const options = parseArgs();
	const errors = validateArgs(options);

	if (errors.length > 0) {
		console.error('❌ Error: Invalid arguments\n');
		errors.forEach((err) => console.error(`   ${err}`));
		console.error('\nUsage:');
		console.error(
			'  node scripts/translation/export-for-wporg.js [OPTIONS]\n'
		);
		console.error('Options:');
		console.error(
			'  --plugin=PLUGIN      Process specific plugin (default: all)'
		);
		console.error(
			'  --locale=LOCALE      Process specific locale (default: all)'
		);
		console.error(
			`  --set=SET            GlotPress set to check against: ${VALID_SETS.join(
				' | '
			)} (default: both)`
		);
		console.error(
			'  --output-dir=DIR     Where to write the .po files (default: <plugin>/languages/wporg-import/)'
		);
		console.error('  --dry-run            Preview without writing files');
		process.exit(1);
	}

	const plugins = options.plugin
		? [config.plugins.find((p) => p.name === options.plugin)]
		: config.plugins;
	const locales = options.locale ? [options.locale] : config.locales;

	console.error(
		'📤 Export local translations for import to translate.wordpress.org\n'
	);
	console.error('='.repeat(60));
	console.error('📦 Plugins:', plugins.map((p) => p.name).join(', '));
	console.error('🌐 Locales:', locales.join(', '));
	console.error(`🔀 Checked against set: ${options.set}`);
	console.error(
		`✍️  Mode: ${options.dryRun ? 'dry-run (no writes)' : 'write'}`
	);
	console.error('='.repeat(60));
	console.error(
		'\nOnly strings WordPress.org does NOT already have a translation for'
	);
	console.error(
		'are included — community-approved strings are never touched.\n'
	);

	let totalExported = 0;
	const failures = [];

	for (const plugin of plugins) {
		for (const locale of locales) {
			const label = `${plugin.name} · ${locale}`;
			try {
				const result = await exportOne(plugin, locale, options);

				if (result.skipped) {
					console.error(`⏭️  ${label}: ${result.skipped}`);
					continue;
				}

				totalExported += result.exported;
				if (result.exported === 0) {
					console.error(`✅ ${label}: nothing new to export`);
					continue;
				}

				const verb = options.dryRun ? 'would export' : 'exported';
				console.error(
					`📝 ${label}: ${verb} ${result.exported} string(s)${
						result.outputPath ? ` → ${result.outputPath}` : ''
					}`
				);
			} catch (error) {
				failures.push(`${label}: ${error.message}`);
				console.error(`❌ ${label}: ${error.message}`);
			}
		}
	}

	console.error('\n' + '='.repeat(60));
	console.error(
		`📊 ${
			options.dryRun ? 'Would export' : 'Exported'
		} ${totalExported} string(s) total`
	);
	if (failures.length > 0) {
		console.error(`⚠️  ${failures.length} failure(s):`);
		failures.forEach((f) => console.error(`   - ${f}`));
	}
	console.error('='.repeat(60));

	if (!options.dryRun && totalExported > 0) {
		console.error('\n📦 Next steps:');
		console.error(
			'   - Review the generated .po file(s) in languages/wporg-import/'
		);
		console.error(
			'   - Import via GlotPress (Project Translation Editor rights required):'
		);
		console.error(
			'     https://translate.wordpress.org/projects/wp-plugins/<slug>/<stable|dev>/<locale>/default/import-translations/'
		);
	}

	process.exit(failures.length > 0 ? 1 : 0);
}

main();
