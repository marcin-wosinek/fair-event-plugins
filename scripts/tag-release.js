#!/usr/bin/env node

/**
 * Custom Tag Release Script
 *
 * Creates git tags after changesets version bump:
 * - Single shared tag (e.g., "1.0.0") for the fixed group: fair-events, fair-payment, fair-audience
 * - Individual tag (e.g., "fair-platform@1.1.0") for fair-platform
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const FIXED_GROUP_PLUGIN = 'fair-events';
const INDEPENDENT_PLUGINS = ['fair-platform'];

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

const sharedVersion = getVersion(FIXED_GROUP_PLUGIN);
console.log(
	`📦 Fixed group (fair-events, fair-payment, fair-audience): ${sharedVersion}`
);
createTag(sharedVersion);

for (const plugin of INDEPENDENT_PLUGINS) {
	const version = getVersion(plugin);
	const tag = `${plugin}@${version}`;
	console.log(`📦 ${plugin}: ${version}`);
	createTag(tag);
}

console.log('\n🎉 Tagging complete!');
