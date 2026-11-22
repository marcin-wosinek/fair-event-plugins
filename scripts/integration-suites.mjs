/**
 * Decide which integration suites a change needs, for the integration-tests
 * workflow (#2326). The workflow runs on every push to main and every pull
 * request, then this script applies the path filters that api-tests.yml and
 * e2e.yml used to carry themselves.
 *
 *   git diff --name-only <base> <head> | node scripts/integration-suites.mjs
 *   node scripts/integration-suites.mjs --all
 *
 * Prints `api=true|false` and `e2e=true|false` lines for $GITHUB_OUTPUT. With
 * `--all`, or when the changed-file list could not be computed (pass
 * `--all` then), both suites run.
 */

import { readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every workspace in the root package.json, matched in full (#2327). Business
 * logic, hooks, bootstrap files, shared PHP and JavaScript, manifests,
 * lockfiles, build configuration and the workspace's own docs can all change
 * what a suite exercises, so a workspace is covered as soon as it is listed.
 */
export const WORKSPACES = JSON.parse(
	readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).workspaces;

// Shared by both suites: every workspace, the root manifests and lockfiles,
// the test environment (wp-env config, mu-plugins, the db.php drop-in and the
// support helpers API specs import too), and the coordinator, preparation and
// lifecycle tooling with the local scripts they import or the builds run.
const SHARED = [
	...WORKSPACES.map((workspace) => `${workspace}/**`),
	'package.json',
	'package-lock.json',
	'composer.json',
	'composer.lock',
	'.wp-env.json',
	'e2e/mu-plugins/**',
	'e2e/drop-ins/**',
	'e2e/support/**',
	'scripts/api-test-runner.mjs',
	'scripts/__tests__/api-test-runner.test.mjs',
	'scripts/prepared-outputs.mjs',
	'scripts/__tests__/prepared-outputs.test.mjs',
	'scripts/integration-build.mjs',
	'scripts/__tests__/integration-build.test.mjs',
	'scripts/integration-suites.mjs',
	'scripts/__tests__/integration-suites.test.mjs',
	'scripts/wp-env-images.mjs',
	'scripts/wp-env-image-adapter.cjs',
	'scripts/__tests__/wp-env-images.test.mjs',
	'scripts/wp-env-pinned-core.cjs',
	'scripts/__tests__/wp-env-pinned-core.test.mjs',
	'.github/actions/prepare-wp-env/**',
	'scripts/php-diagnostics.mjs',
	'scripts/__tests__/php-diagnostics.test.mjs',
	'scripts/block-docs.mjs',
	'scripts/__tests__/block-docs.test.mjs',
	'scripts/shard-assignment.mjs',
	'scripts/shard-timings.mjs',
	'scripts/shard-timings/**',
	'scripts/__tests__/shard-assignment.test.mjs',
	'scripts/__tests__/shard-timings.test.mjs',
	'scripts/__tests__/fixtures/test-list/**',
	// check-api-shards.mjs imports the E2E inventory helpers.
	'scripts/check-e2e-shards.mjs',
	'.github/workflows/integration-tests.yml',
];

export const SUITE_PATHS = {
	api: [
		...SHARED,
		'scripts/check-api-shards.mjs',
		'scripts/__tests__/check-api-shards.test.mjs',
		'.github/workflows/api-tests.yml',
	],
	e2e: [
		...SHARED,
		'e2e/**',
		'playwright.config.js',
		'scripts/workspace-e2e-runner.mjs',
		'scripts/__tests__/check-e2e-shards.test.mjs',
		'.github/workflows/e2e.yml',
	],
};

/**
 * @param {string[]} files Changed repository-relative paths.
 * @return {{api: boolean, e2e: boolean}} Suites to run.
 */
export function selectSuites(files) {
	const matches = (patterns) =>
		files.some((file) =>
			patterns.some((pattern) => matchesGlob(file, pattern))
		);
	return { api: matches(SUITE_PATHS.api), e2e: matches(SUITE_PATHS.e2e) };
}

async function readStdin() {
	let text = '';
	for await (const chunk of process.stdin) {
		text += chunk;
	}
	return text;
}

async function main() {
	const suites = process.argv.includes('--all')
		? { api: true, e2e: true }
		: selectSuites(
				(await readStdin())
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
			);
	console.log(`api=${suites.api}`);
	console.log(`e2e=${suites.e2e}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
