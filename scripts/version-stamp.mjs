/**
 * Plugin version stamping for CI builds and local deploys.
 *
 * Both flows take their plugins from discoverPlugins()
 * (scripts/plugin-workspaces.mjs). A header that can't be found or written
 * fails the stamp instead of shipping the plain release version unnoticed.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { refreshVersion } from './block-docs.mjs';
import { STABLE_TAG_RE, VERSION_HEADER_RE } from './plugin-workspaces.mjs';

/**
 * The build version from the plugin's own release tags, e.g. "1.0.0-2-g8f0bec2".
 *
 * @param {string} rootDir    Repository root.
 * @param {string} pluginName Workspace name.
 * @return {string|null} Null when the plugin has no release tag yet.
 */
export function describePluginTag(rootDir, pluginName) {
	try {
		const raw = execFileSync(
			'git',
			['describe', '--tags', `--match=${pluginName}@*`],
			{ cwd: rootDir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
		).trim();
		return raw.replace(`${pluginName}@`, '');
	} catch {
		return null;
	}
}

function stampFile(rootDir, relativePath, regex, version) {
	const filePath = join(rootDir, relativePath);
	const original = readFileSync(filePath, 'utf8');
	if (
		!new RegExp(regex.source, regex.flags.replace('g', '')).test(original)
	) {
		throw new Error(`no version header found in ${relativePath}`);
	}
	const updated = original.replace(regex, `$1${version}`);
	if (updated === original) {
		return 'current';
	}
	writeFileSync(filePath, updated, 'utf8');
	return 'stamped';
}

/**
 * Stamp each plugin's `Version:` header, readme `Stable tag:` and generated
 * block-docs version with its build version. Plugins that were never released
 * keep their package.json version.
 *
 * @param {object}   options
 * @param {string}   options.rootDir  Repository root.
 * @param {Array}    options.plugins  From discoverPlugins().
 * @param {Function} [options.describe] (pluginName) => version|null.
 * @param {Function} [options.log]    Line logger.
 * @return {string[]} Errors, each naming the plugin and file; empty on success.
 */
export function stampBuildVersions({
	rootDir,
	plugins,
	describe = (name) => describePluginTag(rootDir, name),
	log = console.log,
}) {
	const errors = [];

	for (const plugin of plugins) {
		const version = describe(plugin.name) ?? plugin.packageVersion;
		log(`📦 ${plugin.name}: ${version}`);
		for (const [file, regex] of [
			[plugin.phpFile, VERSION_HEADER_RE],
			[plugin.readmeFile, STABLE_TAG_RE],
		]) {
			try {
				const result = stampFile(rootDir, file, regex, version);
				log(
					result === 'stamped'
						? `  ✅ ${file}`
						: `  ✅ ${file} (already current)`
				);
			} catch (error) {
				errors.push(`${plugin.name}: ${file}: ${error.message}`);
				log(`  ❌ ${file}: ${error.message}`);
			}
		}
		try {
			if (refreshVersion(rootDir, plugin.name, version)) {
				log(`  ✅ ${plugin.name}/block-docs/index.json`);
			}
		} catch (error) {
			errors.push(
				`${plugin.name}: ${plugin.name}/block-docs/index.json: ${error.message}`
			);
			log(`  ❌ ${plugin.name}/block-docs/index.json: ${error.message}`);
		}
		log('');
	}

	return errors;
}

// Local deploys keep their own version format (any non-space value).
const LOCAL_VERSION_HEADER_RE = /(\*?\s*Version:\s*)([^\s\r\n*]+)/i;

/**
 * Temporarily stamp the `Version:` header of each plugin with `version`,
 * run `callback`, then restore the original files, also when stamping or the
 * callback fails.
 *
 * @param {object}   options
 * @param {string}   options.rootDir  Repository root.
 * @param {Array}    options.plugins  Discovered plugins to stamp.
 * @param {string}   options.version  Version to write.
 * @param {Function} options.callback Work to run while stamped (e.g. packaging).
 * @return {number} How many files were stamped and restored.
 */
export function withStampedHeaders({ rootDir, plugins, version, callback }) {
	const originals = new Map();
	try {
		for (const plugin of plugins) {
			const filePath = join(rootDir, plugin.phpFile);
			const original = readFileSync(filePath, 'utf8');
			if (!LOCAL_VERSION_HEADER_RE.test(original)) {
				throw new Error(
					`${plugin.name}: no version header found in ${plugin.phpFile}`
				);
			}
			const updated = original.replace(
				LOCAL_VERSION_HEADER_RE,
				`$1${version}`
			);
			if (updated !== original) {
				// Record before writing, so a failed write is restored too.
				originals.set(filePath, original);
				writeFileSync(filePath, updated, 'utf8');
			}
		}
		callback();
	} finally {
		for (const [filePath, content] of originals) {
			writeFileSync(filePath, content, 'utf8');
		}
	}
	return originals.size;
}
