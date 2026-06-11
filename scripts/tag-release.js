#!/usr/bin/env node

/**
 * Custom Tag Release Script
 *
 * Creates per-plugin git tags after changesets version bump:
 * e.g., "fair-events@1.3.4", "fair-audience@1.3.4", "fair-platform@1.1.0"
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const ALL_PLUGINS = [
	'fair-events',
	'fair-audience',
	'fair-payments-connector',
	'fair-platform',
	'fair-timetable',
	'fair-finance',
	'fair-events-experimental',
];

function getVersion(pluginName) {
	const packagePath = join(rootDir, pluginName, 'package.json');
	const packageData = JSON.parse(readFileSync(packagePath, 'utf8'));
	return packageData.version;
}

function tagExists(tag) {
	try {
		execSync(`git rev-parse "refs/tags/${tag}"`, { stdio: 'pipe' });
		return true;
	} catch {
		return false;
	}
}

function createTag(tag) {
	if (tagExists(tag)) {
		console.log(`  ⏭️  Tag ${tag} already exists, skipping`);
		return;
	}
	execSync(`git tag "${tag}"`, { stdio: 'inherit' });
	console.log(`  ✅ Created tag: ${tag}`);
}

console.log('🏷️  Creating release tags...\n');

for (const plugin of ALL_PLUGINS) {
	const version = getVersion(plugin);
	const tag = `${plugin}@${version}`;
	console.log(`📦 ${plugin}: ${version}`);
	createTag(tag);
}

console.log('\n🎉 Tagging complete!');
