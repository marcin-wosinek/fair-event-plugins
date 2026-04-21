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
		name: 'fair-payment',
		packagePath: 'fair-payment/package.json',
		phpFiles: ['fair-payment/fair-payment.php'],
		readmeFiles: ['fair-payment/readme.txt'],
		versionConstant: 'FAIR_PAYMENT_VERSION',
	},
	{
		name: 'fair-events',
		packagePath: 'fair-events/package.json',
		phpFiles: ['fair-events/fair-events.php'],
		readmeFiles: ['fair-events/readme.txt'],
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

			// Update PHP version constant
			if (plugin.versionConstant) {
				for (const phpFile of plugin.phpFiles) {
					const phpFilePath = join(rootDir, phpFile);

					try {
						const originalContent = readFileSync(
							phpFilePath,
							'utf8'
						);
						const updatedContent = updateVersionConstant(
							originalContent,
							plugin.versionConstant,
							version
						);

						if (originalContent !== updatedContent) {
							writeFileSync(phpFilePath, updatedContent, 'utf8');
							console.log(
								`   ✅ Updated ${plugin.versionConstant} in ${phpFile}`
							);
							updatedCount++;
						} else {
							console.log(
								`   ⏭️  ${plugin.versionConstant} already up to date`
							);
						}
					} catch (error) {
						console.error(
							`   ❌ Error updating ${phpFile}:`,
							error.message
						);
					}
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
