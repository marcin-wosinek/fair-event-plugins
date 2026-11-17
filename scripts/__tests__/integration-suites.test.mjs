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

test('every workspace in the root package.json selects both suites', () => {
	const workspaces = JSON.parse(
		readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
	).workspaces;
	assert.deepEqual(WORKSPACES, workspaces);
	assert.ok(workspaces.includes('fair-payments-connector-experimental'));
	for (const workspace of workspaces) {
		for (const file of [
			`${workspace}/${workspace}.php`,
			`${workspace}/src/Services/Example.php`,
			`${workspace}/package.json`,
			`${workspace}/composer.json`,
			`${workspace}/composer.lock`,
			`${workspace}/webpack.config.cjs`,
			`${workspace}/README.md`,
		]) {
			assert.deepEqual(selectSuites([file]), BOTH, file);
		}
	}
});

test('backend logic outside src/API and shared code run both suites', () => {
	for (const file of [
		'fair-events/src/API/EventsController.php',
		'fair-events/src/Services/EventDateService.php',
		'fair-audience/src/Database/ParticipantRepository.php',
		'fair-form/src/Hooks/SubmissionHooks.php',
		'fair-audience/src/Admin/participants/index.js',
		'fair-events-shared/php/src/Links/Token.php',
		'fair-events-shared/src/components/ConfirmModal.js',
		'fair-events-shared/webpack.example.config.cjs',
		'fair-payments-connector-experimental/src/Core/Plugin.php',
	]) {
		assert.deepEqual(selectSuites([file]), BOTH, file);
	}
});

test('root manifests, lockfiles and the test environment run both suites', () => {
	for (const file of [
		'package.json',
		'package-lock.json',
		'composer.json',
		'composer.lock',
		'.wp-env.json',
		'e2e/mu-plugins/fair-test-helpers.php',
		'e2e/drop-ins/db.php',
		'e2e/support/event-timing.js',
	]) {
		assert.deepEqual(selectSuites([file]), BOTH, file);
	}
});

test('shared preparation and lifecycle tooling run both suites', () => {
	for (const file of [
		'scripts/api-test-runner.mjs',
		'scripts/prepared-outputs.mjs',
		'scripts/integration-build.mjs',
		'scripts/integration-suites.mjs',
		'scripts/block-docs.mjs',
		'scripts/php-diagnostics.mjs',
		'scripts/shard-assignment.mjs',
		'scripts/shard-timings.mjs',
		'scripts/shard-timings/api.json',
		'scripts/shard-timings/e2e.json',
		'scripts/check-e2e-shards.mjs',
		'scripts/__tests__/prepared-outputs.test.mjs',
		'scripts/__tests__/block-docs.test.mjs',
		'.github/workflows/integration-tests.yml',
	]) {
		assert.deepEqual(selectSuites([file]), BOTH, file);
	}
});

test('suite-specific test infrastructure runs only its suite', () => {
	for (const file of [
		'scripts/check-api-shards.mjs',
		'scripts/__tests__/check-api-shards.test.mjs',
		'.github/workflows/api-tests.yml',
	]) {
		assert.deepEqual(selectSuites([file]), { api: true, e2e: false }, file);
	}
	for (const file of [
		'e2e/smoke.spec.js',
		'playwright.config.js',
		'scripts/workspace-e2e-runner.mjs',
		'scripts/__tests__/check-e2e-shards.test.mjs',
		'.github/workflows/e2e.yml',
	]) {
		assert.deepEqual(selectSuites([file]), { api: false, e2e: true }, file);
	}
});

test('root documentation-only changes run nothing', () => {
	assert.deepEqual(
		selectSuites(['TESTING.md', 'README.md', 'docs/notes.md']),
		{ api: false, e2e: false }
	);
});

test('unrelated tooling runs nothing', () => {
	assert.deepEqual(
		selectSuites([
			'scripts/lint-docs.js',
			'.github/workflows/continuous-integration.yml',
		]),
		{ api: false, e2e: false }
	);
});

test('push and pull_request share these filters, with no event path filters', () => {
	const workflow = readFileSync(
		new URL('../../.github/workflows/integration-tests.yml', import.meta.url),
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
