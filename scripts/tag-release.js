#!/usr/bin/env node

/**
 * Custom Tag Release Script
 *
 * Creates per-plugin git tags after changesets version bump:
 * e.g., "fair-events@1.3.4", "fair-audience@1.3.4", "fair-platform@1.1.0"
 *
 * Pass --push to push the newly created tags to origin (used by CI).
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');
const shouldPush = process.argv.includes('--push');

const ALL_PLUGINS = [
	'fair-events',
	'fair-audience',
	'fair-payments-connector',
	'fair-platform',
	'fair-timetable',
	'fair-finance',
	'fair-events-experimental',
	'fair-audience-experimental',
	'fair-payments-connector-experimental',
	'fair-form',
	'fair-calendar-button',
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
		return false;
	}
	execSync(`git tag "${tag}"`, { stdio: 'inherit' });
	console.log(`  ✅ Created tag: ${tag}`);
	return true;
}

function pushTags(tags) {
	const refs = tags.map((tag) => `"refs/tags/${tag}"`).join(' ');
	execSync(`git push origin ${refs}`, { stdio: 'inherit' });
	console.log(`\n🚀 Pushed ${tags.length} tag(s) to origin`);
}

console.log('🏷️  Creating release tags...\n');

const createdTags = [];

for (const plugin of ALL_PLUGINS) {
	const version = getVersion(plugin);
	const tag = `${plugin}@${version}`;
	console.log(`📦 ${plugin}: ${version}`);
	if (createTag(tag)) {
		createdTags.push(tag);
	}
}

if (shouldPush && createdTags.length > 0) {
	pushTags(createdTags);
}

console.log('\n🎉 Tagging complete!');
