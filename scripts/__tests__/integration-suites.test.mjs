import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { selectSuites } from '../integration-suites.mjs';

const script = fileURLToPath(
	new URL('../integration-suites.mjs', import.meta.url)
);

test('a REST controller change runs both suites', () => {
	assert.deepEqual(
		selectSuites(['fair-events/src/API/EventsController.php']),
		{ api: true, e2e: true }
	);
});

test('an admin page change runs only E2E', () => {
	assert.deepEqual(
		selectSuites(['fair-audience/src/Admin/participants/index.js']),
		{ api: false, e2e: true }
	);
});

test('an API-only tooling change runs only API', () => {
	assert.deepEqual(selectSuites(['scripts/check-api-shards.mjs']), {
		api: true,
		e2e: false,
	});
});

test('lockfiles, build configuration and artifact tooling run both suites', () => {
	for (const file of [
		'package-lock.json',
		'fair-events/composer.lock',
		'fair-events/webpack.config.cjs',
		'scripts/integration-build.mjs',
		'scripts/prepared-outputs.mjs',
		'.github/workflows/integration-tests.yml',
	]) {
		assert.deepEqual(selectSuites([file]), { api: true, e2e: true }, file);
	}
});

test('shared PHP changes run the API suite', () => {
	assert.equal(
		selectSuites(['fair-events-shared/php/src/Links/Token.php']).api,
		true
	);
});

test('documentation-only changes run nothing', () => {
	assert.deepEqual(selectSuites(['TESTING.md', 'docs/notes.md']), {
		api: false,
		e2e: false,
	});
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
	assert.equal(await run(['--all'], ''), 'api=true\ne2e=true\n');
});
