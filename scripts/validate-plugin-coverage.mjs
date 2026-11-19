#!/usr/bin/env node

/**
 * Check that release configuration covers every plugin workspace.
 *
 * Stamping and tagging derive their plugins from discoverPlugins()
 * (scripts/plugin-workspaces.mjs). Two release scripts keep explicit
 * configuration because it carries per-plugin policy:
 *
 * - scripts/sync-wp-versions.js: header/readme paths and the optional PHP
 *   version constant. Every plugin needs an entry.
 * - scripts/sync-changelog.js: every plugin is either configured or listed in
 *   CHANGELOG_EXCLUSIONS with a reason (linked or hand-maintained changelog).
 *
 * Each problem names the plugin and the script that needs attention.
 *
 * Usage: npm run validate:plugin-coverage
 */

import { fileURLToPath } from 'node:url';

import { discoverPlugins } from './plugin-workspaces.mjs';

const VERSION_SCRIPT = 'scripts/sync-wp-versions.js';
const CHANGELOG_SCRIPT = 'scripts/sync-changelog.js';

/**
 * @param {object} options
 * @param {Array}  options.plugins             From discoverPlugins().
 * @param {Array}  options.versionSync         sync-wp-versions.js `plugins`.
 * @param {Array}  options.changelogSync       sync-changelog.js `plugins`.
 * @param {Object} options.changelogExclusions sync-changelog.js CHANGELOG_EXCLUSIONS.
 * @return {string[]} Problems; empty when covered.
 */
export function findCoverageProblems({
	plugins,
	versionSync,
	changelogSync,
	changelogExclusions,
}) {
	const problems = [];
	const known = new Set(plugins.map((plugin) => plugin.name));
	const versionEntries = new Map(
		versionSync.map((entry) => [entry.name, entry])
	);
	const changelogEntries = new Map(
		changelogSync.map((entry) => [entry.name, entry])
	);

	for (const plugin of plugins) {
		const versionEntry = versionEntries.get(plugin.name);
		if (!versionEntry) {
			problems.push(
				`${plugin.name}: missing from ${VERSION_SCRIPT} \`plugins\``
			);
		} else {
			if (versionEntry.packagePath !== `${plugin.name}/package.json`) {
				problems.push(
					`${plugin.name}: ${VERSION_SCRIPT} packagePath should be ${plugin.name}/package.json`
				);
			}
			if (!versionEntry.phpFiles?.includes(plugin.phpFile)) {
				problems.push(
					`${plugin.name}: ${VERSION_SCRIPT} phpFiles must include ${plugin.phpFile}`
				);
			}
			if (!versionEntry.readmeFiles?.includes(plugin.readmeFile)) {
				problems.push(
					`${plugin.name}: ${VERSION_SCRIPT} readmeFiles must include ${plugin.readmeFile}`
				);
			}
		}

		const changelogEntry = changelogEntries.get(plugin.name);
		const excluded = Object.hasOwn(changelogExclusions, plugin.name);
		if (!changelogEntry && !excluded) {
			problems.push(
				`${plugin.name}: missing from ${CHANGELOG_SCRIPT} \`plugins\`; add it, or add it to CHANGELOG_EXCLUSIONS with a reason`
			);
		} else if (changelogEntry && excluded) {
			problems.push(
				`${plugin.name}: both configured and excluded in ${CHANGELOG_SCRIPT}`
			);
		} else if (
			changelogEntry &&
			!changelogEntry.readmeFiles?.includes(plugin.readmeFile)
		) {
			problems.push(
				`${plugin.name}: ${CHANGELOG_SCRIPT} readmeFiles must include ${plugin.readmeFile}`
			);
		}
	}

	const unknown = (names, script) => {
		for (const name of names) {
			if (!known.has(name)) {
				problems.push(
					`${name}: listed in ${script} but is not a plugin workspace`
				);
			}
		}
	};
	unknown(versionEntries.keys(), VERSION_SCRIPT);
	unknown(changelogEntries.keys(), CHANGELOG_SCRIPT);
	unknown(Object.keys(changelogExclusions), CHANGELOG_SCRIPT);

	return problems;
}

async function main() {
	const rootDir = fileURLToPath(new URL('..', import.meta.url));
	const { plugins: versionSync } = await import('./sync-wp-versions.js');
	const { plugins: changelogSync, CHANGELOG_EXCLUSIONS } =
		await import('./sync-changelog.js');

	let plugins;
	try {
		plugins = discoverPlugins(rootDir);
	} catch (error) {
		console.error(error.message);
		process.exit(1);
	}

	const problems = findCoverageProblems({
		plugins,
		versionSync,
		changelogSync,
		changelogExclusions: CHANGELOG_EXCLUSIONS,
	});
	if (problems.length) {
		console.error('Release configuration does not cover every plugin:');
		for (const problem of problems) {
			console.error(`  - ${problem}`);
		}
		process.exit(1);
	}
	console.log(
		`Release configuration covers all ${plugins.length} plugin workspaces.`
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
