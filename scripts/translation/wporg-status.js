#!/usr/bin/env node

/**
 * WordPress.org Translation Status Report
 *
 * Reads the approval status of translation sets on translate.wordpress.org
 * for the plugins listed in published-plugins.json. By default only the
 * pl, es, de, fr and en sets are reported; --locale= picks any one remote
 * locale instead and --all-locales reports every remote locale.
 * Read-only: no local catalog is read or written, nothing is submitted.
 *
 * Usage:
 *   node scripts/translation/wporg-status.js
 *   node scripts/translation/wporg-status.js --all-locales
 *   node scripts/translation/wporg-status.js --plugin=fair-events --locale=es_ES
 *   node scripts/translation/wporg-status.js --set=stable --json
 *   node scripts/translation/wporg-status.js --output=wporg-status.json
 *
 * Exit codes: 0 complete report, 1 at least one request failed or a
 * requested project/branch/locale is missing, 2 invalid invocation.
 */

import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import {
	BRANCHES,
	UsageError,
	collectStatus,
	exitCodeFor,
	formatText,
	loadPublishedPlugins,
	resolveLocaleScope,
	selectPlugins,
} from './lib/wporg-status.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '../..');

/**
 * Parse CLI arguments
 */
export function parseArgs(args) {
	const options = {
		plugin: null,
		locale: null,
		allLocales: false,
		set: 'both',
		json: false,
		output: null,
	};

	for (const arg of args) {
		if (arg.startsWith('--plugin=')) {
			options.plugin = arg.substring('--plugin='.length);
		} else if (arg.startsWith('--locale=')) {
			options.locale = arg.substring('--locale='.length);
		} else if (arg.startsWith('--set=')) {
			options.set = arg.substring('--set='.length);
		} else if (arg.startsWith('--output=')) {
			options.output = arg.substring('--output='.length);
		} else if (arg === '--all-locales') {
			options.allLocales = true;
		} else if (arg === '--json') {
			options.json = true;
		} else {
			throw new UsageError(`Unknown argument: ${arg}`);
		}
	}

	if (options.set !== 'both' && !BRANCHES.includes(options.set)) {
		throw new UsageError(
			`Invalid --set: ${options.set} (expected stable, dev or both)`
		);
	}
	for (const name of ['plugin', 'locale', 'output']) {
		if (options[name] === '') {
			throw new UsageError(`--${name} needs a value`);
		}
	}
	resolveLocaleScope(options);

	return options;
}

/**
 * Run the report.
 *
 * @param {string[]} args Command-line arguments.
 * @param {object}   io   Output streams and collectStatus overrides (tests).
 * @returns {Promise<number>} Process exit code.
 */
export async function run(
	args,
	{ stdout = process.stdout, stderr = process.stderr, ...overrides } = {}
) {
	let options;
	let plugins;
	try {
		options = parseArgs(args);
		const registry = await loadPublishedPlugins(rootDir);
		plugins = selectPlugins(
			registry.plugins,
			registry.workspaces,
			options.plugin
		);
	} catch (error) {
		if (!(error instanceof UsageError)) {
			throw error;
		}
		stderr.write(`❌ Error: ${error.message}\n`);
		return 2;
	}

	const branches = options.set === 'both' ? BRANCHES : [options.set];
	stderr.write(
		`🌍 Reading WordPress.org translation status for ${plugins
			.map((plugin) => plugin.name)
			.join(', ')} (${branches.join(', ')})...\n`
	);

	const report = await collectStatus({
		plugins,
		branches,
		locale: options.locale,
		allLocales: options.allLocales,
		...overrides,
	});
	const json = JSON.stringify(report, null, 2);

	if (options.output) {
		await writeFile(options.output, `${json}\n`, 'utf8');
		stderr.write(`✅ JSON report saved to ${options.output}\n`);
	}
	stdout.write(`${options.json ? json : formatText(report)}\n`);

	// The text report already lists failures; with --json they go to stderr.
	for (const error of options.json ? report.errors : []) {
		stderr.write(
			`❌ [${error.category}] ${error.plugin} ${error.branch}: ${error.message} (${error.url})\n`
		);
	}
	if (report.errors.length > 0) {
		stderr.write(
			`\n⚠️  ${report.errors.length} of ${
				plugins.length * branches.length
			} requests failed; ${
				report.results.length
			} translation sets were still reported.\n`
		);
	}

	return exitCodeFor(report);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	run(process.argv.slice(2)).then(
		(code) => {
			process.exitCode = code;
		},
		(error) => {
			console.error(`❌ Error: ${error.message}`);
			process.exitCode = 1;
		}
	);
}
