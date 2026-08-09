#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Verifies a built plugin ZIP includes its Composer-generated
 * vendor/autoload.php. Every plugin with a composer.json requires that
 * file unconditionally from its main entry point, so a ZIP missing it
 * fatals on activation instead of failing at build time (see #1434).
 *
 * Usage:
 *   node scripts/verify-dist-archive.cjs <plugin> <zipPath>   # targeted
 *   node scripts/verify-dist-archive.cjs                      # every dist/*.zip
 */

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

/**
 * @param {string} pluginName
 * @param {string} zipPath
 * @returns {string|null} an error message, or null if the archive passes.
 */
function verify(pluginName, zipPath) {
	const composerJsonPath = path.join(rootDir, pluginName, 'composer.json');
	if (!fs.existsSync(composerJsonPath)) {
		console.log(`${pluginName}: no composer.json, skipping.`);
		return null;
	}

	if (!fs.existsSync(zipPath)) {
		return `${pluginName}: archive not found at ${zipPath}`;
	}

	const listing = execSync(`unzip -l "${zipPath}"`, { encoding: 'utf8' });
	const requiredEntry = `${pluginName}/vendor/autoload.php`;
	if (!listing.includes(requiredEntry)) {
		return `${pluginName}: ${zipPath} is missing ${requiredEntry} (composer.json exists, so the plugin's entry point requires it unconditionally)`;
	}

	console.log(`${pluginName}: ${zipPath} contains ${requiredEntry}.`);
	return null;
}

/**
 * Infers the plugin slug from a dist/*.zip filename by matching it
 * against every top-level directory that has a composer.json. wp
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
			fs.existsSync(path.join(rootDir, name, 'composer.json'))
		);

	return (
		candidates.find((name) => zipFileName.startsWith(`${name}.`)) || null
	);
}

const [pluginArg, zipArg] = process.argv.slice(2);

const errors = [];

if (pluginArg) {
	if (!zipArg) {
		console.error(
			'Usage: node scripts/verify-dist-archive.cjs <plugin> <zipPath>'
		);
		process.exit(1);
	}
	const error = verify(pluginArg, zipArg);
	if (error) {
		errors.push(error);
	}
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
		const error = verify(pluginName, path.join(distDir, zipFile));
		if (error) {
			errors.push(error);
		}
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
