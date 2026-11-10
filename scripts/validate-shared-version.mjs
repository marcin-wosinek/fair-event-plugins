#!/usr/bin/env node
/* eslint-disable no-console */

// Every Fair plugin bundles fair-events/shared, and the copy with the
// highest declared version wins at runtime (#2181). A shipped change without
// a version bump can therefore lose to an older copy carrying the same
// number, and a consumer whose lock still names an older version ships stale
// code. This check fails when:
//
// - shipped shared PHP (fair-events-shared/php, outside composer.lock and
//   vendor/) changed since the base branch but its version did not increase;
// - a workspace requiring fair-events/shared locks a different version.
//
// Usage: node scripts/validate-shared-version.mjs [--base=<ref>]
// The base defaults to origin/$GITHUB_BASE_REF, else origin/main.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..'
);
export const SHARED_DIR = 'fair-events-shared/php';

/**
 * Compare dotted numeric versions: negative, zero or positive.
 *
 * @param {string} a Version.
 * @param {string} b Version.
 * @return {number} Comparison.
 */
export function compareVersions(a, b) {
	const left = String(a).split('.').map(Number);
	const right = String(b).split('.').map(Number);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const diff = (left[i] || 0) - (right[i] || 0);
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
}

/**
 * Whether a changed path is shipped shared PHP.
 *
 * @param {string} file Repository-relative path.
 * @return {boolean} Shipped.
 */
export function isShippedSharedFile(file) {
	if (!file.startsWith(`${SHARED_DIR}/`)) {
		return false;
	}
	const rest = file.slice(SHARED_DIR.length + 1);
	return rest !== 'composer.lock' && !rest.startsWith('vendor/');
}

/**
 * Problems for a set of changed files and versions.
 *
 * @param {Object}   input
 * @param {string[]} input.changed     Changed paths since the base.
 * @param {string}   input.baseVersion Version on the base, or '' if new.
 * @param {string}   input.version     Current version.
 * @param {Object}   input.locks       Workspace => locked version (or null).
 * @return {string[]} Problems.
 */
export function findProblems({ changed, baseVersion, version, locks }) {
	const problems = [];
	const shipped = changed.filter(isShippedSharedFile);
	if (
		shipped.length > 0 &&
		baseVersion !== '' &&
		compareVersions(version, baseVersion) <= 0
	) {
		problems.push(
			`Shared PHP changed (${shipped.join(
				', '
			)}) but ${SHARED_DIR}/composer.json is still ${version} (base: ${baseVersion}). Bump the version and run \`npm run composer:update:shared\`.`
		);
	}
	for (const [workspace, locked] of Object.entries(locks)) {
		if (locked !== version) {
			problems.push(
				`${workspace}/composer.lock has fair-events/shared ${
					locked ?? '(missing)'
				}, expected ${version}. Run \`npm run composer:update:shared\`.`
			);
		}
	}
	return problems;
}

function git(args) {
	return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function workspacesRequiringShared() {
	const { workspaces } = JSON.parse(
		readFileSync(path.join(ROOT, 'package.json'), 'utf8')
	);
	return workspaces.filter((workspace) => {
		const file = path.join(ROOT, workspace, 'composer.json');
		if (!existsSync(file)) {
			return false;
		}
		const { require = {} } = JSON.parse(readFileSync(file, 'utf8'));
		return 'fair-events/shared' in require;
	});
}

function lockedVersion(workspace) {
	const file = path.join(ROOT, workspace, 'composer.lock');
	if (!existsSync(file)) {
		return null;
	}
	const { packages = [] } = JSON.parse(readFileSync(file, 'utf8'));
	const entry = packages.find(({ name }) => name === 'fair-events/shared');
	return entry ? entry.version : null;
}

function main(argv) {
	const baseArg = argv.find((arg) => arg.startsWith('--base='));
	const base = baseArg
		? baseArg.slice('--base='.length)
		: `origin/${process.env.GITHUB_BASE_REF || 'main'}`;
	const mergeBase = git(['merge-base', base, 'HEAD']);

	const changed = git(['diff', '--name-only', mergeBase, '--', SHARED_DIR])
		.split('\n')
		.filter(Boolean);
	let baseVersion = '';
	try {
		baseVersion = JSON.parse(
			git(['show', `${mergeBase}:${SHARED_DIR}/composer.json`])
		).version;
	} catch {
		baseVersion = '';
	}
	const { version } = JSON.parse(
		readFileSync(path.join(ROOT, SHARED_DIR, 'composer.json'), 'utf8')
	);

	const locks = {};
	for (const workspace of workspacesRequiringShared()) {
		// Untracked locks are local-only and never shipped from git.
		const tracked = git(['ls-files', `${workspace}/composer.lock`]);
		if (tracked) {
			locks[workspace] = lockedVersion(workspace);
		}
	}

	const problems = findProblems({ changed, baseVersion, version, locks });
	if (problems.length > 0) {
		for (const problem of problems) {
			console.error(`✗ ${problem}`);
		}
		process.exit(1);
	}
	console.log(
		`✓ fair-events/shared ${version}: version bumped where needed; ${
			Object.keys(locks).length
		} consumer locks match.`
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2));
}
