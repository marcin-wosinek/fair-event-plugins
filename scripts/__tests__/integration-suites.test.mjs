import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { selectSuites, WORKSPACES } from '../integration-suites.mjs';

const script = fileURLToPath(
	new URL('../integration-suites.mjs', import.meta.url)
);

const BOTH = { api: true, e2e: true };
const API = { api: true, e2e: false };
const E2E = { api: false, e2e: true };
const NONE = { api: false, e2e: false };

// Representative changes and the suites each must select on its own. Paths
// are whitespace-separated so the table stays one literal per scenario.
const SCENARIOS = [
	[
		'backend logic outside src/API and shared code run both suites',
		BOTH,
		`fair-events/src/API/EventsController.php
		fair-events/src/Services/EventDateService.php
		fair-audience/src/Database/ParticipantRepository.php
		fair-form/src/Hooks/SubmissionHooks.php
		fair-audience/src/Admin/participants/index.js
		fair-events-shared/php/src/Links/Token.php
		fair-events-shared/src/components/ConfirmModal.js
		fair-events-shared/webpack.example.config.cjs
		fair-payments-connector-experimental/src/Core/Plugin.php`,
	],
	[
		'root manifests, lockfiles and the test environment run both suites',
		BOTH,
		`package.json package-lock.json composer.json composer.lock
		.wp-env.json
		e2e/mu-plugins/fair-test-helpers.php
		e2e/drop-ins/db.php
		e2e/support/event-timing.js`,
	],
	[
		'shared preparation and lifecycle tooling run both suites',
		BOTH,
		`scripts/api-test-runner.mjs
		scripts/prepared-outputs.mjs
		scripts/integration-build.mjs
		scripts/integration-suites.mjs
		scripts/block-docs.mjs
		scripts/php-diagnostics.mjs
		scripts/shard-assignment.mjs
		scripts/shard-timings.mjs
		scripts/shard-timings/api.json
		scripts/shard-timings/e2e.json
		scripts/check-e2e-shards.mjs
		scripts/__tests__/prepared-outputs.test.mjs
		scripts/__tests__/block-docs.test.mjs
		.github/workflows/integration-tests.yml`,
	],
	[
		'API test infrastructure runs only API',
		API,
		`scripts/check-api-shards.mjs
		scripts/__tests__/check-api-shards.test.mjs
		.github/workflows/api-tests.yml`,
	],
	[
		'E2E test infrastructure runs only E2E',
		E2E,
		`e2e/smoke.spec.js
		playwright.config.js
		scripts/workspace-e2e-runner.mjs
		scripts/__tests__/check-e2e-shards.test.mjs
		.github/workflows/e2e.yml`,
	],
	[
		'root documentation and unrelated tooling run nothing',
		NONE,
		`TESTING.md README.md docs/notes.md
		scripts/lint-docs.js
		.github/workflows/continuous-integration.yml`,
	],
];

const paths = (list) => list.trim().split(/\s+/);

function assertEachSelects(files, expected) {
	for (const file of files) {
		assert.deepEqual(selectSuites([file]), expected, file);
	}
}

test('every workspace in the root package.json selects both suites', () => {
	const workspaces = JSON.parse(
		readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
	).workspaces;
	assert.deepEqual(WORKSPACES, workspaces);
	assert.ok(workspaces.includes('fair-payments-connector-experimental'));
	const files = paths(
		`plugin.php src/Services/Example.php package.json composer.json
		composer.lock webpack.config.cjs README.md`
	);
	for (const workspace of workspaces) {
		assertEachSelects(
			files.map((file) => `${workspace}/${file}`),
			BOTH
		);
	}
});

for (const [name, expected, list] of SCENARIOS) {
	test(name, () => assertEachSelects(paths(list), expected));
}

test('a documentation-only change set runs nothing', () => {
	assert.deepEqual(
		selectSuites(['TESTING.md', 'README.md', 'docs/notes.md']),
		NONE
	);
});

test('push and pull_request share these filters, with no event path filters', () => {
	const workflow = readFileSync(
		new URL(
			'../../.github/workflows/integration-tests.yml',
			import.meta.url
		),
		'utf8'
	);
	const triggers = workflow.slice(
		workflow.indexOf('\non:\n'),
		workflow.indexOf('\njobs:\n')
	);
	assert.match(triggers, /\n {4}push:\n {8}branches: \[main\]\n/);
	assert.match(triggers, /\n {4}pull_request:\n {8}branches: \[main\]\n/);
	assert.doesNotMatch(triggers, /paths(-ignore)?:/);
	assert.match(
		workflow,
		/\| node scripts\/integration-suites\.mjs \| tee -a "\$GITHUB_OUTPUT"/
	);
});

function run(args, input) {
	return new Promise((resolve, reject) => {
		const child = execFile(
			process.execPath,
			[script, ...args],
			(error, stdout) => (error ? reject(error) : resolve(stdout))
		);
		child.stdin.end(input);
	});
}

test('the CLI prints GitHub outputs from stdin or --all', async () => {
	assert.equal(await run([], 'README.md\n'), 'api=false\ne2e=false\n');
	assert.equal(await run([], 'e2e/smoke.spec.js\n'), 'api=false\ne2e=true\n');
	assert.equal(
		await run([], 'fair-events/src/Services/Example.php\n'),
		'api=true\ne2e=true\n'
	);
	assert.equal(await run(['--all'], ''), 'api=true\ne2e=true\n');
});
