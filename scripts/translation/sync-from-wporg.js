#!/usr/bin/env node

/**
 * Sync Community Translations from translate.wordpress.org
 *
 * Downloads approved (current) translations from the WordPress.org GlotPress
 * project for each plugin/locale and overrides the matching msgstr values in
 * the local .po files.
 *
 * Community translations win: a local string is only overwritten when
 * WordPress.org has a NON-EMPTY translation for it. Strings the community has
 * not translated keep whatever is in the local .po (e.g. AI-generated values),
 * so this never wipes existing translations for locales the community has not
 * touched yet.
 *
 * By default both the `stable` (latest release) and `dev` (trunk) translation
 * sets are pulled and merged, with `dev` taking priority — dev matches the
 * current source strings and usually has the freshest community work.
 *
 * Usage:
 *   # All plugins, all locales (both stable+dev sets)
 *   node scripts/translation/sync-from-wporg.js
 *
 *   # Preview changes without writing
 *   node scripts/translation/sync-from-wporg.js --dry-run
 *
 *   # A single plugin / locale
 *   node scripts/translation/sync-from-wporg.js --plugin=fair-events --locale=es_ES
 *
 *   # Only the stable (released) set
 *   node scripts/translation/sync-from-wporg.js --set=stable
 *
 *   # Skip confirmation (CI/automation)
 *   node scripts/translation/sync-from-wporg.js --yes
 */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { access } from 'fs/promises';
import readline from 'readline';
import { config } from './config.js';
import { parsePOFile, parsePOContent } from './lib/po-parser.js';
import { writePOFile } from './lib/po-writer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

const VALID_SETS = ['stable', 'dev', 'both'];

/**
 * Parse CLI arguments
 */
function parseArgs() {
	const args = process.argv.slice(2);
	const options = {
		plugin: null,
		locale: null,
		set: 'both',
		dryRun: false,
		yes: false,
	};

	for (const arg of args) {
		if (arg.startsWith('--plugin=')) {
			options.plugin = arg.substring('--plugin='.length);
		} else if (arg.startsWith('--locale=')) {
			options.locale = arg.substring('--locale='.length);
		} else if (arg.startsWith('--set=')) {
			options.set = arg.substring('--set='.length);
		} else if (arg === '--dry-run') {
			options.dryRun = true;
		} else if (arg === '--yes' || arg === '-y') {
			options.yes = true;
		}
	}

	return options;
}

/**
 * Validate arguments
 */
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

/**
 * Prompt user for confirmation
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
 * Unique key for a translation entry (context + source string).
 */
function entryKey(entry) {
	return `${entry.msgctxt || ''}${entry.msgid}`;
}

/**
 * Is a msgstr value a real translation (non-empty)?
 *
 * @param {string|string[]} msgstr
 * @returns {boolean}
 */
function isTranslated(msgstr) {
	if (Array.isArray(msgstr)) {
		return msgstr.some((s) => s && s.trim() !== '');
	}
	return Boolean(msgstr && msgstr.trim() !== '');
}

/**
 * Are two msgstr values equal (handles singular strings and plural arrays)?
 */
function msgstrEqual(a, b) {
	if (Array.isArray(a) || Array.isArray(b)) {
		const aa = Array.isArray(a) ? a : [a];
		const bb = Array.isArray(b) ? b : [b];
		if (aa.length !== bb.length) return false;
		return aa.every((v, i) => (v || '') === (bb[i] || ''));
	}
	return (a || '') === (b || '');
}

/**
 * Build a GlotPress export URL for a plugin/set/locale.
 */
function exportUrl(slug, set, wpLocale) {
	return `https://translate.wordpress.org/projects/wp-plugins/${slug}/${set}/${wpLocale}/default/export-translations?format=po`;
}

/**
 * Download and parse one GlotPress set into a Map keyed by entryKey.
 * Only non-empty translations are included.
 *
 * @returns {Promise<Map<string, string|string[]>>}
 */
async function fetchSet(slug, set, wpLocale) {
	const url = exportUrl(slug, set, wpLocale);
	const res = await fetch(url, { redirect: 'follow' });

	// A 404 means this plugin/locale has no GlotPress project on
	// WordPress.org (e.g. not published there yet) — treat as "no data",
	// not a failure.
	if (res.status === 404) {
		return null;
	}
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} for ${url}`);
	}

	const text = await res.text();
	const parsed = parsePOContent(text);

	const map = new Map();
	for (const entry of parsed.translations) {
		if (entry.isHeader || entry.msgid === undefined) continue;
		if (!isTranslated(entry.msgstr)) continue;
		map.set(entryKey(entry), entry.msgstr);
	}
	return map;
}

/**
 * Fetch the requested set(s) and merge them. When both sets are requested,
 * `dev` overrides `stable` (dev tracks trunk / newest community work).
 *
 * @returns {Promise<Map<string, string|string[]>>}
 */
async function fetchCommunity(slug, setOption, wpLocale) {
	const sets = setOption === 'both' ? ['stable', 'dev'] : [setOption];
	const merged = new Map();
	let anyFound = false;
	for (const set of sets) {
		const map = await fetchSet(slug, set, wpLocale);
		if (map === null) continue; // set has no GlotPress project
		anyFound = true;
		for (const [key, value] of map) {
			merged.set(key, value);
		}
	}
	// No set existed on WordPress.org at all → signal "not hosted".
	return anyFound ? merged : null;
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
 * Sync a single plugin/locale. Returns a result summary.
 */
async function syncOne(plugin, locale, options) {
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
	if (community.size === 0) {
		return { available: 0, overridden: 0, changes: [] };
	}

	const parsed = await parsePOFile(poPath);
	const changes = [];

	for (const entry of parsed.translations) {
		if (entry.isHeader || entry.msgid === undefined) continue;
		const communityValue = community.get(entryKey(entry));
		if (communityValue === undefined) continue;
		if (msgstrEqual(entry.msgstr, communityValue)) continue;

		changes.push({
			msgid: entry.msgid,
			from: entry.msgstr,
			to: communityValue,
		});
		entry.msgstr = communityValue;
	}

	if (changes.length > 0 && !options.dryRun) {
		await writePOFile(poPath, parsed);
	}

	return { available: community.size, overridden: changes.length, changes };
}

/**
 * Render a msgstr value compactly for the change preview.
 */
function preview(value) {
	const str = Array.isArray(value) ? value.join(' / ') : value || '';
	const oneLine = str.replace(/\n/g, '\\n');
	return oneLine.length > 60 ? `${oneLine.slice(0, 57)}…` : oneLine;
}

async function main() {
	const options = parseArgs();
	const errors = validateArgs(options);

	if (errors.length > 0) {
		console.error('❌ Error: Invalid arguments\n');
		errors.forEach((err) => console.error(`   ${err}`));
		console.error('\nUsage:');
		console.error(
			'  node scripts/translation/sync-from-wporg.js [OPTIONS]\n'
		);
		console.error('Options:');
		console.error(
			'  --plugin=PLUGIN   Process specific plugin (default: all)'
		);
		console.error(
			'  --locale=LOCALE   Process specific locale (default: all)'
		);
		console.error(
			`  --set=SET         GlotPress set: ${VALID_SETS.join(
				' | '
			)} (default: both)`
		);
		console.error('  --dry-run         Preview changes without writing');
		console.error('  --yes, -y         Skip confirmation prompts');
		process.exit(1);
	}

	const plugins = options.plugin
		? [config.plugins.find((p) => p.name === options.plugin)]
		: config.plugins;
	const locales = options.locale ? [options.locale] : config.locales;

	console.error(
		'🌍 Sync community translations from translate.wordpress.org\n'
	);
	console.error('='.repeat(60));
	console.error('📦 Plugins:', plugins.map((p) => p.name).join(', '));
	console.error('🌐 Locales:', locales.join(', '));
	console.error(`🔀 Set: ${options.set}`);
	console.error(
		`✍️  Mode: ${options.dryRun ? 'dry-run (no writes)' : 'write'}`
	);
	console.error('='.repeat(60));
	console.error(
		'\nCommunity translations override local values. Strings the'
	);
	console.error(
		'community has NOT translated keep their existing local value.\n'
	);

	if (!options.dryRun && !options.yes) {
		const proceed = await confirm('Proceed?');
		if (!proceed) {
			console.error('❌ Aborted by user');
			process.exit(0);
		}
	}

	let totalOverridden = 0;
	const failures = [];

	for (const plugin of plugins) {
		for (const locale of locales) {
			const label = `${plugin.name} · ${locale}`;
			try {
				const result = await syncOne(plugin, locale, options);

				if (result.skipped) {
					console.error(`⏭️  ${label}: ${result.skipped}`);
					continue;
				}

				totalOverridden += result.overridden;
				const verb = options.dryRun ? 'would override' : 'overrode';
				console.error(
					`${
						result.overridden > 0 ? '✏️ ' : '✅'
					} ${label}: ${verb} ${result.overridden} of ${
						result.available
					} community strings`
				);

				for (const change of result.changes) {
					console.error(`     • "${preview(change.msgid)}"`);
					console.error(`         - ${preview(change.from)}`);
					console.error(`         + ${preview(change.to)}`);
				}
			} catch (error) {
				failures.push(`${label}: ${error.message}`);
				console.error(`❌ ${label}: ${error.message}`);
			}
		}
	}

	console.error('\n' + '='.repeat(60));
	console.error(
		`📊 ${
			options.dryRun ? 'Would override' : 'Overrode'
		} ${totalOverridden} string(s) total`
	);
	if (failures.length > 0) {
		console.error(`⚠️  ${failures.length} failure(s):`);
		failures.forEach((f) => console.error(`   - ${f}`));
	}
	console.error('='.repeat(60));

	if (!options.dryRun && totalOverridden > 0) {
		console.error('\n📦 Next steps:');
		console.error(
			'   - Compile .mo files: npm run makemo --workspace=PLUGIN'
		);
		console.error(
			'   - Build JS/JSON:     npm run build --workspace=PLUGIN'
		);
	}

	process.exit(failures.length > 0 ? 1 : 0);
}

main();
