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
		name: 'fair-payments-connector',
		packagePath: 'fair-payments-connector/package.json',
		phpFiles: ['fair-payments-connector/fair-payments-connector.php'],
		readmeFiles: ['fair-payments-connector/readme.txt'],
		versionConstant: 'FAIR_PAYMENTS_CONNECTOR_VERSION',
	},
	{
		name: 'fair-events',
		packagePath: 'fair-events/package.json',
		phpFiles: ['fair-events/fair-events.php'],
		readmeFiles: ['fair-events/readme.txt'],
		versionConstant: 'FAIR_EVENTS_VERSION',
	},
	{
		name: 'fair-platform',
		packagePath: 'fair-platform/package.json',
		phpFiles: ['fair-platform/fair-platform.php'],
		readmeFiles: ['fair-platform/readme.txt'],
		versionConstant: 'FAIR_PLATFORM_VERSION',
	},
	{
		name: 'fair-audience',
		packagePath: 'fair-audience/package.json',
		phpFiles: ['fair-audience/fair-audience.php'],
		readmeFiles: ['fair-audience/readme.txt'],
		versionConstant: 'FAIR_AUDIENCE_VERSION',
	},
	{
		name: 'fair-timetable',
		packagePath: 'fair-timetable/package.json',
		phpFiles: ['fair-timetable/fair-timetable.php'],
		readmeFiles: ['fair-timetable/readme.txt'],
	},
	{
		name: 'fair-finance',
		packagePath: 'fair-finance/package.json',
		phpFiles: ['fair-finance/fair-finance.php'],
		readmeFiles: ['fair-finance/readme.txt'],
		versionConstant: 'FAIR_FINANCE_VERSION',
	},
	{
		name: 'fair-events-experimental',
		packagePath: 'fair-events-experimental/package.json',
		phpFiles: ['fair-events-experimental/fair-events-experimental.php'],
		readmeFiles: ['fair-events-experimental/readme.txt'],
		versionConstant: 'FAIR_EVENTS_EXPERIMENTAL_VERSION',
	},
	{
		name: 'fair-payments-connector-experimental',
		packagePath: 'fair-payments-connector-experimental/package.json',
		phpFiles: [
			'fair-payments-connector-experimental/fair-payments-connector-experimental.php',
		],
		readmeFiles: ['fair-payments-connector-experimental/readme.txt'],
		versionConstant: 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_VERSION',
	},
	{
		name: 'fair-form',
		packagePath: 'fair-form/package.json',
		phpFiles: ['fair-form/fair-form.php'],
		readmeFiles: ['fair-form/readme.txt'],
		versionConstant: 'FAIR_FORM_VERSION',
	},
	{
		name: 'fair-audience-experimental',
		packagePath: 'fair-audience-experimental/package.json',
		phpFiles: ['fair-audience-experimental/fair-audience-experimental.php'],
		readmeFiles: ['fair-audience-experimental/readme.txt'],
		versionConstant: 'FAIR_AUDIENCE_EXPERIMENTAL_VERSION',
	},
];

/**
 * Update Stable tag in readme.txt
 */
function updateStableTag(content, newVersion) {
	const stableTagRegex = /(Stable tag:\s*)([0-9]+\.[0-9]+\.[0-9]+)/gi;
	return content.replace(stableTagRegex, `$1${newVersion}`);
}

/**
 * Update PHP version constant: define( 'CONSTANT_NAME', '1.0.0' )
 */
function updateVersionConstant(content, constantName, newVersion) {
	const regex = new RegExp(
		`(define\\(\\s*'${constantName}'\\s*,\\s*')([0-9]+\\.[0-9]+\\.[0-9]+)('\\s*\\))`,
		'g'
	);
	return content.replace(regex, `$1${newVersion}$3`);
}

/**
 * Update plugin header Version line: " * Version: 1.0.0"
 * wp dist-archive reads this to name the zip, so it must match package.json.
 */
function updatePluginHeaderVersion(content, newVersion) {
	const regex = /^(\s*\*\s*Version:\s*)([0-9]+\.[0-9]+\.[0-9]+)\s*$/m;
	return content.replace(regex, `$1${newVersion}`);
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

			// Update PHP plugin header Version + optional version constant
			for (const phpFile of plugin.phpFiles) {
				const phpFilePath = join(rootDir, phpFile);

				try {
					const originalContent = readFileSync(phpFilePath, 'utf8');
					let updatedContent = updatePluginHeaderVersion(
						originalContent,
						version
					);
					if (plugin.versionConstant) {
						updatedContent = updateVersionConstant(
							updatedContent,
							plugin.versionConstant,
							version
						);
					}

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

			// Update Stable tag in readme files
			for (const readmeFile of plugin.readmeFiles) {
				const readmeFilePath = join(rootDir, readmeFile);

				try {
					const originalContent = readFileSync(
						readmeFilePath,
						'utf8'
					);
					const updatedContent = updateStableTag(
						originalContent,
						version
					);

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
