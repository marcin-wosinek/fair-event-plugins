#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Script to create SVN tag from dist archive
 * Usage: node scripts/svn-tag.cjs <plugin-name>
 */

const pluginName = process.argv[2];

if (!pluginName) {
	console.error('Usage: node scripts/svn-tag.cjs <plugin-name>');
	process.exit(1);
}

const pluginDir = path.join(__dirname, '..', pluginName);
const packageJsonPath = path.join(pluginDir, 'package.json');
const svnDir = path.join(pluginDir, 'svn');

// Check if plugin exists
if (!fs.existsSync(pluginDir)) {
	console.error(`Error: Plugin directory not found: ${pluginDir}`);
	process.exit(1);
}

// Check if package.json exists
if (!fs.existsSync(packageJsonPath)) {
	console.error(`Error: package.json not found: ${packageJsonPath}`);
	process.exit(1);
}

// Check if svn directory exists
if (!fs.existsSync(svnDir)) {
	console.error(`Error: SVN directory not found: ${svnDir}`);
	console.error('Please run "npm run svn:checkout" first');
	process.exit(1);
}

// Read version from package.json
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;

if (!version) {
	console.error('Error: Version not found in package.json');
	process.exit(1);
}

console.log(`Creating SVN tag for ${pluginName} version ${version}...`);

// Paths
const distDir = path.join(__dirname, '..', 'dist');
const zipFile = path.join(distDir, `${pluginName}.${version}.zip`);
const tagDir = path.join(svnDir, 'tags', version);

try {
	// 1. Install production-only dependencies
	const composerJsonPath = path.join(pluginDir, 'composer.json');
	if (fs.existsSync(composerJsonPath)) {
		console.log(
			'Installing production dependencies (--no-dev) in plugin...'
		);
		try {
			execSync('composer install --no-dev --optimize-autoloader', {
				cwd: pluginDir,
				stdio: 'inherit',
			});
		} catch (error) {
			console.warn(
				'Warning: composer install failed, continuing anyway...'
			);
		}
	}

	// 2. Always rebuild dist archive to ensure .distignore is respected
	if (fs.existsSync(zipFile)) {
		console.log('Removing old dist archive to ensure fresh build...');
		fs.unlinkSync(zipFile);
	}

	console.log('Creating dist archive...');
	execSync(`wp dist-archive ${pluginName} dist --create-target-dir`, {
		cwd: path.join(__dirname, '..'),
		stdio: 'inherit',
	});

	// 2. Create tags directory if it doesn't exist
	if (!fs.existsSync(tagDir)) {
		console.log(`Creating tag directory: ${version}`);
		fs.mkdirSync(tagDir, { recursive: true });
	} else {
		console.log(`Tag directory already exists: ${version}`);
		console.log('Cleaning existing tag directory...');
		fs.rmSync(tagDir, { recursive: true, force: true });
		fs.mkdirSync(tagDir, { recursive: true });
	}

	// 3. Extract zip to tag directory
	console.log(`Extracting to ${tagDir}...`);
	execSync(`unzip -q -o "${zipFile}" -d "${tagDir}"`, {
		stdio: 'inherit',
	});

	// 4. Move contents from nested directory to tag root
	// wp dist-archive creates a zip with plugin-name/files structure
	// We need to move files from tags/version/plugin-name/ to tags/version/
	const nestedDir = path.join(tagDir, pluginName);
	if (fs.existsSync(nestedDir)) {
		const files = fs.readdirSync(nestedDir);
		for (const file of files) {
			const src = path.join(nestedDir, file);
			const dest = path.join(tagDir, file);
			fs.renameSync(src, dest);
		}
		fs.rmdirSync(nestedDir);
		console.log('Moved files to tag root');
	}

	// 5. Restore dev dependencies for local development
	if (fs.existsSync(composerJsonPath)) {
		console.log('\nRestoring dev dependencies for local development...');
		try {
			execSync('composer install', {
				cwd: pluginDir,
				stdio: 'inherit',
			});
		} catch (error) {
			console.warn(
				'Warning: Failed to restore dev dependencies. Run "composer install" manually in the plugin directory.'
			);
		}
	}

	console.log(`\n✓ Successfully created SVN tag ${version} for ${pluginName}`);
	console.log(`  Location: ${tagDir}`);
	console.log(
		`\nNext steps:\n  cd ${pluginName}/svn\n  svn add tags/${version}\n  svn ci -m "Tagging version ${version}"`
	);
} catch (error) {
	console.error('Error:', error.message);

	// Try to restore dev dependencies even on error
	const composerJsonPath = path.join(pluginDir, 'composer.json');
	if (fs.existsSync(composerJsonPath)) {
		console.log('\nRestoring dev dependencies...');
		try {
			execSync('composer install', {
				cwd: pluginDir,
				stdio: 'pipe',
			});
		} catch (e) {
			// Ignore errors during cleanup
		}
	}

	process.exit(1);
}
