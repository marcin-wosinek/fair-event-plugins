#!/usr/bin/env node

/**
 * Stamp Build Version
 *
 * Replaces the Version: header in WordPress plugin PHP files
 * with the output of `git describe --tags` (e.g., "1.0.0-2-g8f0bec2").
 * Run during CI build, after `npm run build`.
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const buildVersion = execSync('git describe --tags --match="[0-9]*"', {
	encoding: 'utf8',
}).trim();

const pluginFiles = [
	'fair-events/fair-events.php',
	'fair-payments-connector/fair-payments-connector.php',
	'fair-platform/fair-platform.php',
	'fair-audience/fair-audience.php',
	'fair-timetable/fair-timetable.php',
];

const readmeFiles = [
	'fair-events/readme.txt',
	'fair-payments-connector/readme.txt',
	'fair-platform/readme.txt',
	'fair-audience/readme.txt',
	'fair-timetable/readme.txt',
];

const versionRegex = /(\*?\s*Version:\s*)([0-9]+\.[0-9]+\.[0-9]+[^\s*]*)/gi;
const stableTagRegex = /(Stable tag:\s*)([0-9]+\.[0-9]+\.[0-9]+[^\s]*)/gi;

console.log(`🏷️  Stamping build version: ${buildVersion}\n`);

for (const file of pluginFiles) {
	const filePath = join(rootDir, file);
	try {
		const original = readFileSync(filePath, 'utf8');
		const updated = original.replace(versionRegex, `$1${buildVersion}`);

		if (original !== updated) {
			writeFileSync(filePath, updated, 'utf8');
			console.log(`  ✅ ${file}`);
		} else {
			console.log(`  ⏭️  ${file} (no Version header found)`);
		}
	} catch (error) {
		console.error(`  ❌ ${file}: ${error.message}`);
	}
}

for (const file of readmeFiles) {
	const filePath = join(rootDir, file);
	try {
		const original = readFileSync(filePath, 'utf8');
		const updated = original.replace(stableTagRegex, `$1${buildVersion}`);

		if (original !== updated) {
			writeFileSync(filePath, updated, 'utf8');
			console.log(`  ✅ ${file}`);
		} else {
			console.log(`  ⏭️  ${file} (no Stable tag found)`);
		}
	} catch (error) {
		console.error(`  ❌ ${file}: ${error.message}`);
	}
}

console.log('\n🎉 Stamp complete!');
