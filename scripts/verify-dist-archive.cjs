#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Verifies a built plugin ZIP includes its Composer-generated
 * vendor/autoload.php. Every plugin with a composer.json depends on
 * that file being present: most require it unconditionally from their
 * main entry point and fatal on activation if it's missing; the rest
 * (e.g. fair-payments-connector) guard the require with file_exists()
 * and instead silently lose all Composer-dependent functionality — a
 * ZIP missing vendor/ is a bug either way (see #1434).
 *
 * For plugins that supply blocks, also verifies the ZIP ships complete,
 * release-matched block documentation (block-docs/index.json and every
 * guide, example, and block.json it references, recording the version in
 * the shipped plugin header; see scripts/block-docs.mjs and #1682).
 *
 * For the plugins in DEV_ARTIFACT_PLUGINS, also rejects development test
 * artifacts — test suites, PHPUnit configuration, and test-result caches —
 * outside the production vendor/ directory (see #2001).
 *
 * Usage:
 *   node scripts/verify-dist-archive.cjs <plugin> <zipPath>   # targeted
 *   node scripts/verify-dist-archive.cjs                      # every dist/*.zip
 */

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const DEV_ARTIFACT_PLUGINS = [
	'fair-events-experimental',
	'fair-payments-connector-experimental',
];
const DEV_ARTIFACT_DIRECTORIES = [
	'__tests__',
	'tests',
	'e2e',
	'.phpunit.cache',
	'test-results',
	'playwright-report',
];
const DEV_ARTIFACT_FILES = [
	'phpunit.xml',
	'phpunit.xml.dist',
	'.phpunit.result.cache',
];

/**
 * @param {string}   pluginName
 * @param {string}   zipPath
 * @param {string[]} entries    Every file path in the archive.
 * @returns {string[]} error messages, one per offending entry.
 */
function verifyNoDevArtifacts(pluginName, zipPath, entries) {
	if (!DEV_ARTIFACT_PLUGINS.includes(pluginName)) {
		return [];
	}

	const errors = [];
	for (const entry of entries) {
		const segments = entry.split('/');
		// Match against paths inside the plugin directory. Production
		// Composer dependencies keep whatever their packages ship.
		const pluginSegments =
			segments[0] === pluginName ? segments.slice(1) : segments;
		if (pluginSegments[0] === 'vendor') {
			continue;
		}
		const fileName = pluginSegments[pluginSegments.length - 1];
		if (
			DEV_ARTIFACT_FILES.includes(fileName) ||
			pluginSegments
				.slice(0, -1)
				.some((segment) => DEV_ARTIFACT_DIRECTORIES.includes(segment))
		) {
			errors.push(
				`${pluginName}: ${zipPath} contains development artifact ${entry}`
			);
		}
	}

	if (errors.length === 0) {
		console.log(
			`${pluginName}: ${zipPath} contains no development test artifacts.`
		);
	}
	return errors;
}

/**
 * @param {string} pluginName
 * @param {string} zipPath
 * @returns {string|null} an error message, or null if the archive passes.
 */
function verifyComposer(pluginName, zipPath, entries) {
	const composerJsonPath = path.join(rootDir, pluginName, 'composer.json');
	if (!fs.existsSync(composerJsonPath)) {
		console.log(`${pluginName}: no composer.json, skipping.`);
		return null;
	}

	const requiredEntry = `${pluginName}/vendor/autoload.php`;
	if (!entries.includes(requiredEntry)) {
		return `${pluginName}: ${zipPath} is missing ${requiredEntry} (composer.json exists, so the plugin's entry point requires it unconditionally)`;
	}

	console.log(`${pluginName}: ${zipPath} contains ${requiredEntry}.`);
	return null;
}

/**
 * @param {string}   pluginName
 * @param {string}   zipPath
 * @param {string[]} entries    Every file path in the archive.
 * @param {object}   blockDocs  The scripts/block-docs.mjs module.
 * @returns {string[]} error messages.
 */
function verifyBlockDocs(pluginName, zipPath, entries, blockDocs) {
	if (!blockDocs.findDocumentedPlugins(rootDir).includes(pluginName)) {
		return [];
	}

	const errors = blockDocs.verifyArchiveDocs({
		pluginName,
		entries,
		readEntry: (entry) =>
			execFileSync('unzip', ['-p', zipPath, entry], {
				encoding: 'utf8',
				maxBuffer: 64 * 1024 * 1024,
			}),
	});
	if (errors.length === 0) {
		console.log(
			`${pluginName}: ${zipPath} contains complete block documentation.`
		);
	}
	return errors;
}

/**
 * @param {string} pluginName
 * @param {string} zipPath
 * @param {object} blockDocs The scripts/block-docs.mjs module.
 * @returns {string[]} error messages.
 */
function verify(pluginName, zipPath, blockDocs) {
	if (!fs.existsSync(zipPath)) {
		return [`${pluginName}: archive not found at ${zipPath}`];
	}

	const entries = execFileSync('unzip', ['-Z1', zipPath], {
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	})
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line && !line.endsWith('/'));

	const errors = [];
	const composerError = verifyComposer(pluginName, zipPath, entries);
	if (composerError) {
		errors.push(composerError);
	}
	errors.push(...verifyBlockDocs(pluginName, zipPath, entries, blockDocs));
	errors.push(...verifyNoDevArtifacts(pluginName, zipPath, entries));
	return errors;
}

/**
 * Infers the plugin slug from a dist/*.zip filename by matching it
 * against every top-level plugin directory (one with a package.json). wp
 * dist-archive names files "<plugin>.<version>.zip", but the version
 * itself can contain dots and dashes (e.g. git-describe output), so a
 * naive split on the first "." isn't reliable.
 */
function inferPlugin(zipFileName) {
	const candidates = fs
		.readdirSync(rootDir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.filter((name) =>
			fs.existsSync(path.join(rootDir, name, 'package.json'))
		)
		// Longest first, so "fair-events-experimental.1.0.0.zip" is not
		// claimed by "fair-events".
		.sort((a, b) => b.length - a.length);

	return (
		candidates.find((name) => zipFileName.startsWith(`${name}.`)) || null
	);
}

async function main() {
	const blockDocs = await import('./block-docs.mjs');
	const [pluginArg, zipArg] = process.argv.slice(2);

	const errors = [];

	if (pluginArg) {
		if (!zipArg) {
			console.error(
				'Usage: node scripts/verify-dist-archive.cjs <plugin> <zipPath>'
			);
			process.exit(1);
		}
		errors.push(...verify(pluginArg, zipArg, blockDocs));
	} else {
		if (!fs.existsSync(distDir)) {
			console.error(`Error: dist directory not found: ${distDir}`);
			process.exit(1);
		}
		const zipFiles = fs
			.readdirSync(distDir)
			.filter((name) => name.endsWith('.zip'));

		if (zipFiles.length === 0) {
			console.error(`Error: no *.zip files found in ${distDir}`);
			process.exit(1);
		}

		for (const zipFile of zipFiles) {
			const pluginName = inferPlugin(zipFile);
			if (!pluginName) {
				errors.push(
					`${zipFile}: could not infer plugin name from filename`
				);
				continue;
			}
			errors.push(
				...verify(pluginName, path.join(distDir, zipFile), blockDocs)
			);
		}
	}

	if (errors.length > 0) {
		console.error('\nDist archive verification failed:');
		for (const error of errors) {
			console.error(`  - ${error}`);
		}
		process.exit(1);
	}

	console.log('\n✓ Dist archive verification passed.');
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
