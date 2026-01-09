#!/usr/bin/env node

/**
 * Sync Changelog to readme.txt
 *
 * This script reads CHANGELOG.md from each plugin workspace
 * and syncs the content to the == Changelog == section in readme.txt
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Plugin configurations
const plugins = [
	{
		name: 'fair-calendar-button',
		changelogPath: 'fair-calendar-button/CHANGELOG.md',
		readmeFiles: ['fair-calendar-button/readme.txt'],
	},
	{
		name: 'fair-timetable',
		changelogPath: 'fair-timetable/CHANGELOG.md',
		readmeFiles: ['fair-timetable/readme.txt'],
	},
	{
		name: 'fair-schedule-blocks',
		changelogPath: 'fair-schedule-blocks/CHANGELOG.md',
		readmeFiles: ['fair-schedule-blocks/readme.txt'],
	},
	{
		name: 'fair-membership',
		changelogPath: 'fair-membership/CHANGELOG.md',
		readmeFiles: ['fair-membership/readme.txt'],
	},
	{
		name: 'fair-events',
		changelogPath: 'fair-events/CHANGELOG.md',
		readmeFiles: ['fair-events/readme.txt'],
	},
	{
		name: 'fair-rsvp',
		changelogPath: 'fair-rsvp/CHANGELOG.md',
		readmeFiles: ['fair-rsvp/readme.txt'],
	},
	{
		name: 'fair-team',
		changelogPath: 'fair-team/CHANGELOG.md',
		readmeFiles: ['fair-team/readme.txt'],
	},
	{
		name: 'fair-audience',
		changelogPath: 'fair-audience/CHANGELOG.md',
		readmeFiles: ['fair-audience/readme.txt'],
	},
];

/**
 * Extract changelog content from CHANGELOG.md
 * Gets everything from the first ## version header onwards
 *
 * @param {string} content - CHANGELOG.md content
 * @returns {string} Extracted changelog entries
 */
function extractChangelogContent(content) {
	// Find the first version header (## followed by version number)
	const versionHeaderRegex = /^## \d+\.\d+\.\d+/m;
	const match = content.match(versionHeaderRegex);

	if (!match) {
		return '';
	}

	// Get everything from the first version header onwards
	const startIndex = content.indexOf(match[0]);
	let changelogContent = content.substring(startIndex);

	// Remove the "# package-name" header if it exists at the beginning
	changelogContent = changelogContent.replace(/^# [^\n]+\n\n/, '');

	return changelogContent.trim();
}

/**
 * Update readme.txt with changelog content
 *
 * @param {string} readmeContent - readme.txt content
 * @param {string} changelogContent - Changelog content to insert
 * @returns {string} Updated readme.txt content
 */
function updateReadmeChangelog(readmeContent, changelogContent) {
	// Find the == Changelog == section
	const changelogSectionRegex = /== Changelog ==/i;
	const match = readmeContent.match(changelogSectionRegex);

	if (!match) {
		console.log('   ⚠️  No == Changelog == section found in readme.txt');
		return readmeContent;
	}

	const changelogStartIndex = readmeContent.indexOf(match[0]);

	// Find the next section (== something ==) or end of file
	const nextSectionRegex = /\n== [^=]+ ==/;
	const afterChangelog = readmeContent.substring(
		changelogStartIndex + match[0].length
	);
	const nextSectionMatch = afterChangelog.match(nextSectionRegex);

	let beforeChangelog = readmeContent.substring(0, changelogStartIndex);
	let afterChangelogSection = '';

	if (nextSectionMatch) {
		const nextSectionIndex =
			changelogStartIndex +
			match[0].length +
			afterChangelog.indexOf(nextSectionMatch[0]);
		afterChangelogSection = readmeContent.substring(nextSectionIndex);
	}

	// Construct new content
	return (
		beforeChangelog +
		'== Changelog ==\n\n' +
		changelogContent +
		'\n' +
		afterChangelogSection
	);
}

/**
 * Main sync function
 */
function syncChangelogs() {
	console.log('📋 Syncing changelogs to readme.txt files...\n');

	let updatedCount = 0;

	for (const plugin of plugins) {
		try {
			console.log(`📦 ${plugin.name}`);

			// Read CHANGELOG.md
			const changelogPath = join(rootDir, plugin.changelogPath);
			let changelogContent;

			try {
				const fullChangelogContent = readFileSync(
					changelogPath,
					'utf8'
				);
				changelogContent =
					extractChangelogContent(fullChangelogContent);

				if (!changelogContent) {
					console.log(
						'   ⚠️  No version entries found in CHANGELOG.md'
					);
					console.log('');
					continue;
				}
			} catch (error) {
				console.log(
					`   ⏭️  CHANGELOG.md not found, skipping: ${error.message}`
				);
				console.log('');
				continue;
			}

			// Update each readme file
			for (const readmeFile of plugin.readmeFiles) {
				const readmeFilePath = join(rootDir, readmeFile);

				try {
					// Read current content
					const originalContent = readFileSync(
						readmeFilePath,
						'utf8'
					);

					// Update changelog section
					const updatedContent = updateReadmeChangelog(
						originalContent,
						changelogContent
					);

					// Only write if content changed
					if (originalContent !== updatedContent) {
						writeFileSync(readmeFilePath, updatedContent, 'utf8');
						console.log(`   ✅ Updated ${readmeFile}`);
						updatedCount++;
					} else {
						console.log(`   ⏭️  ${readmeFile} already up to date`);
					}
				} catch (error) {
					console.error(
						`   ❌ Error updating ${readmeFile}:`,
						error.message
					);
				}
			}
		} catch (error) {
			console.error(`❌ Error processing ${plugin.name}:`, error.message);
		}

		console.log(''); // Empty line for readability
	}

	console.log(`🎉 Sync complete! Updated ${updatedCount} file(s).`);
}

// Run the sync
syncChangelogs();
