#!/usr/bin/env node

/**
 * Sync WordPress Plugin Versions
 *
 * This script reads package.json versions from each plugin workspace
 * and updates the corresponding WordPress plugin header versions.
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
		packagePath: 'fair-calendar-button/package.json',
		phpFiles: ['fair-calendar-button/fair-calendar-button.php'],
		readmeFiles: ['fair-calendar-button/readme.txt'],
	},
	{
		name: 'fair-payment',
		packagePath: 'fair-payment/package.json',
		phpFiles: ['fair-payment/fair-payment.php'],
		readmeFiles: [],
	},
	{
		name: 'fair-registration',
		packagePath: 'fair-registration/package.json',
		phpFiles: ['fair-registration/fair-registration.php'],
		readmeFiles: [],
	},
	{
		name: 'fair-timetable',
		packagePath: 'fair-timetable/package.json',
		phpFiles: ['fair-timetable/fair-timetable.php'],
		readmeFiles: ['fair-timetable/readme.txt'],
	},
	{
		name: 'fair-schedule-blocks',
		packagePath: 'fair-schedule-blocks/package.json',
		phpFiles: ['fair-schedule-blocks/fair-schedule-blocks.php'],
		readmeFiles: ['fair-schedule-blocks/readme.txt'],
	},
	{
		name: 'fair-membership',
		packagePath: 'fair-membership/package.json',
		phpFiles: ['fair-membership/fair-membership.php'],
		readmeFiles: ['fair-membership/readme.txt'],
	},
	{
		name: 'fair-events',
		packagePath: 'fair-events/package.json',
		phpFiles: ['fair-events/fair-events.php'],
		readmeFiles: ['fair-events/readme.txt'],
	},
];

/**
 * Update WordPress plugin header version
 *
 * @param {string} content - PHP file content
 * @param {string} newVersion - New version to set
 * @returns {string} Updated content
 */
function updatePluginVersion(content, newVersion) {
	// Match WordPress plugin header version patterns:
	// Version: 1.0.0
	// * Version: 1.0.0
	const versionRegex = /(\*?\s*Version:\s*)([0-9]+\.[0-9]+\.[0-9]+)/gi;

	// Match WordPress plugin header stable tag patterns:
	// Stable tag: 1.0.0
	const stableTagRegex = /(Stable tag:\s*)([0-9]+\.[0-9]+\.[0-9]+)/gi;

	let updatedContent = content.replace(versionRegex, `$1${newVersion}`);
	updatedContent = updatedContent.replace(stableTagRegex, `$1${newVersion}`);

	return updatedContent;
}

/**
 * Main sync function
 */
function syncVersions() {
	console.log('🔄 Syncing WordPress plugin versions...\n');

	let updatedCount = 0;

	for (const plugin of plugins) {
		try {
			// Read package.json version
			const packageJsonPath = join(rootDir, plugin.packagePath);
			const packageData = JSON.parse(
				readFileSync(packageJsonPath, 'utf8')
			);
			const version = packageData.version;

			console.log(`📦 ${plugin.name}: ${version}`);

			// Update each PHP file
			for (const phpFile of plugin.phpFiles) {
				const phpFilePath = join(rootDir, phpFile);

				try {
					// Read current content
					const originalContent = readFileSync(phpFilePath, 'utf8');

					// Update version
					const updatedContent = updatePluginVersion(
						originalContent,
						version
					);

					// Only write if content changed
					if (originalContent !== updatedContent) {
						writeFileSync(phpFilePath, updatedContent, 'utf8');
						console.log(`   ✅ Updated ${phpFile}`);
						updatedCount++;
					} else {
						console.log(`   ⏭️  ${phpFile} already up to date`);
					}
				} catch (error) {
					console.error(
						`   ❌ Error updating ${phpFile}:`,
						error.message
					);
				}
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

					// Update version
					const updatedContent = updatePluginVersion(
						originalContent,
						version
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
syncVersions();
