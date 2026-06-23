#!/usr/bin/env node

/**
 * Stamp Build Version
 *
 * Replaces the Version: header in WordPress plugin PHP files with the output
 * of `git describe --tags --match="<plugin-name>@*"` (prefix stripped), e.g. "1.0.0-2-g8f0bec2".
 * Run during CI build, after `npm run build`.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const versionRegex = /(\*?\s*Version:\s*)([0-9]+\.[0-9]+\.[0-9]+[^\s*]*)/gi;
const stableTagRegex = /(Stable tag:\s*)([0-9]+\.[0-9]+\.[0-9]+[^\s]*)/gi;

const plugins = [
	{
		name: 'fair-events',
		phpFile: 'fair-events/fair-events.php',
		readmeFile: 'fair-events/readme.txt',
	},
	{
		name: 'fair-payments-connector',
		phpFile: 'fair-payments-connector/fair-payments-connector.php',
		readmeFile: 'fair-payments-connector/readme.txt',
	},
	{
		name: 'fair-platform',
		phpFile: 'fair-platform/fair-platform.php',
		readmeFile: 'fair-platform/readme.txt',
	},
	{
		name: 'fair-audience',
		phpFile: 'fair-audience/fair-audience.php',
		readmeFile: 'fair-audience/readme.txt',
	},
	{
		name: 'fair-timetable',
		phpFile: 'fair-timetable/fair-timetable.php',
		readmeFile: 'fair-timetable/readme.txt',
	},
	{
		name: 'fair-finance',
		phpFile: 'fair-finance/fair-finance.php',
		readmeFile: 'fair-finance/readme.txt',
	},
];

function getBuildVersion(pluginName) {
	const raw = execSync(`git describe --tags --match="${pluginName}@*"`, {
		encoding: 'utf8',
	}).trim();
	return raw.replace(`${pluginName}@`, '');
}

function stampFile(filePath, regex, buildVersion) {
	try {
		const original = readFileSync(filePath, 'utf8');
		const updated = original.replace(regex, `$1${buildVersion}`);
		if (original !== updated) {
			writeFileSync(filePath, updated, 'utf8');
			console.log(`  ✅ ${filePath}`);
		} else {
			console.log(`  ⏭️  ${filePath} (no header found)`);
		}
	} catch (error) {
		console.error(`  ❌ ${filePath}: ${error.message}`);
	}
}

console.log('🏷️  Stamping build versions...\n');

for (const plugin of plugins) {
	const buildVersion = getBuildVersion(plugin.name);
	console.log(`📦 ${plugin.name}: ${buildVersion}`);
	stampFile(join(rootDir, plugin.phpFile), versionRegex, buildVersion);
	stampFile(join(rootDir, plugin.readmeFile), stableTagRegex, buildVersion);
	console.log('');
}

console.log('🎉 Stamp complete!');
