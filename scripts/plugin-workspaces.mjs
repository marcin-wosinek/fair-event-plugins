/**
 * WordPress plugin workspaces, discovered from the root `package.json`.
 *
 * The root `workspaces` list is the single authority for which plugins the
 * monorepo ships. Build stamping, local deploy stamping and release tagging
 * read this module instead of keeping their own plugin lists, so a newly
 * added plugin workspace is covered without editing those scripts.
 *
 * Every workspace is a plugin unless NON_PLUGIN_WORKSPACES names it. A plugin
 * must have exactly one top-level PHP file with a `Plugin Name:` header (the
 * file WordPress loads; its name need not match the workspace), a `Version:`
 * header in that file and a `Stable tag:` in `readme.txt`. Anything missing
 * fails discovery with the workspace and path, rather than silently dropping
 * the plugin from stamping or tagging.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Workspaces that are not WordPress plugins, with the reason. They are never
 * stamped, tagged or validated as plugins.
 */
export const NON_PLUGIN_WORKSPACES = {
	'fair-events-shared':
		'shared PHP/JS library bundled into plugins; private, never tagged or published',
};

// WordPress reads plugin headers with the same leading-comment allowance
// (get_file_data()): optional `<?php`, then spaces, `*`, `/`, `#` or `@`.
const PLUGIN_NAME_RE = /^(?:[ \t]*<\?php)?[ \t/*#@]*Plugin Name:(.*)$/im;

/**
 * Matches the plugin header `Version:` value; group 2 is the version. Only the
 * label is captured: text before it (` * `) is left in place by the replace.
 */
export const VERSION_HEADER_RE =
	/(Version:\s*)([0-9]+\.[0-9]+\.[0-9]+[^\s*]*)/gi;

/** Matches the readme `Stable tag:` value; group 2 is the version. */
export const STABLE_TAG_RE = /(Stable tag:\s*)([0-9]+\.[0-9]+\.[0-9]+[^\s]*)/gi;

/**
 * Raised when one or more workspaces can't be resolved to a plugin.
 */
export class PluginDiscoveryError extends Error {
	/**
	 * @param {string[]} problems One line per problem, naming the workspace.
	 */
	constructor(problems) {
		super(
			[
				'Plugin workspace discovery failed:',
				...problems.map((problem) => `  - ${problem}`),
				'Fix the workspace, or add it to NON_PLUGIN_WORKSPACES in scripts/plugin-workspaces.mjs if it is not a WordPress plugin.',
			].join('\n')
		);
		this.name = 'PluginDiscoveryError';
		this.problems = problems;
	}
}

function hasMatch(regex, content) {
	return new RegExp(regex.source, regex.flags.replace('g', '')).test(content);
}

function findPluginFiles(directory) {
	return readdirSync(directory)
		.filter((name) => name.endsWith('.php'))
		.filter((name) => statSync(join(directory, name)).isFile())
		.filter((name) =>
			PLUGIN_NAME_RE.test(readFileSync(join(directory, name), 'utf8'))
		)
		.sort();
}

/**
 * Discover every plugin workspace, in root workspace order.
 *
 * @param {string} rootDir Repository root.
 * @return {Array<{name: string, phpFile: string, readmeFile: string, packageVersion: string}>}
 *   Paths are relative to rootDir.
 * @throws {PluginDiscoveryError} When a workspace isn't a resolvable plugin.
 */
export function discoverPlugins(rootDir) {
	const { workspaces = [] } = JSON.parse(
		readFileSync(join(rootDir, 'package.json'), 'utf8')
	);
	const plugins = [];
	const problems = [];

	for (const workspace of workspaces) {
		if (Object.hasOwn(NON_PLUGIN_WORKSPACES, workspace)) {
			continue;
		}
		const directory = join(rootDir, workspace);
		if (!existsSync(join(directory, 'package.json'))) {
			problems.push(`${workspace}: ${workspace}/package.json not found`);
			continue;
		}

		const pluginFiles = findPluginFiles(directory);
		if (pluginFiles.length !== 1) {
			problems.push(
				pluginFiles.length === 0
					? `${workspace}: no top-level PHP file with a "Plugin Name:" header`
					: `${workspace}: several PHP files with a "Plugin Name:" header (${pluginFiles
							.map((file) => `${workspace}/${file}`)
							.join(', ')})`
			);
			continue;
		}

		const phpFile = `${workspace}/${pluginFiles[0]}`;
		const readmeFile = `${workspace}/readme.txt`;
		if (
			!hasMatch(
				VERSION_HEADER_RE,
				readFileSync(join(rootDir, phpFile), 'utf8')
			)
		) {
			problems.push(`${workspace}: no "Version:" header in ${phpFile}`);
		}
		if (!existsSync(join(rootDir, readmeFile))) {
			problems.push(`${workspace}: ${readmeFile} not found`);
		} else if (
			!hasMatch(
				STABLE_TAG_RE,
				readFileSync(join(rootDir, readmeFile), 'utf8')
			)
		) {
			problems.push(`${workspace}: no "Stable tag:" in ${readmeFile}`);
		}

		const { version } = JSON.parse(
			readFileSync(join(directory, 'package.json'), 'utf8')
		);
		plugins.push({
			name: workspace,
			phpFile,
			readmeFile,
			packageVersion: version,
		});
	}

	if (problems.length) {
		throw new PluginDiscoveryError(problems);
	}
	return plugins;
}
