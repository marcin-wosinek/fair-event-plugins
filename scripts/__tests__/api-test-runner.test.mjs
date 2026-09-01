import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { parseArguments, runApiTests } from '../api-test-runner.mjs';
import { playwrightArguments } from '../workspace-e2e-runner.mjs';

const workspaceConfig = {
	workspaces: ['fair-events', 'fair-timetable', 'fair-events-shared'],
	suiteWorkspaces: {
		api: ['fair-events'],
		e2e: ['fair-events', 'fair-timetable'],
	},
};

function createExecutor(responses = {}, onRun) {
	const calls = [];
	const terminations = [];
	return {
		calls,
		terminations,
		async run(command, args, options) {
			const call = { command, args, options };
			calls.push(call);
			onRun?.(call);
			const key = `${command} ${args.join(' ')}`;
			return responses[key] ?? { code: 0, stdout: '' };
		},
		terminate(signal) {
			terminations.push(signal);
		},
	};
}

function makeOptions(overrides = {}) {
	return {
		reuse: false,
		suite: 'api',
		workspace: undefined,
		forwarded: [],
		...overrides,
	};
}

function stoppedStatus() {
	return {
		'npx wp-env status --json': {
			code: 0,
			stdout: JSON.stringify({ status: 'stopped' }),
		},
	};
}

async function run(
	executor,
	runOptions = makeOptions(),
	signalSource = new EventEmitter(),
	browserValidator = async () => {}
) {
	return runApiTests({
		options: runOptions,
		executor,
		workspaceConfig,
		logger() {},
		signalSource,
		browserValidator,
	});
}

test('owned success prepares, starts, waits, tests all workspaces, and stops', async () => {
	const executor = createExecutor(stoppedStatus());
	assert.equal(await run(executor), 0);
	assert.deepEqual(
		executor.calls.map((call) => [call.command, ...call.args].join(' ')),
		[
			'npx wp-env status --json',
			'npm run build',
			'npm run composer:install:prod',
			'npx wp-env start',
			'npx wp-env run tests-cli wp rewrite structure /%postname%/ --hard',
			'npx wp-env run tests-cli wp core is-installed',
			'npm run test:api',
			'npx wp-env stop',
		]
	);
});

test('readiness failure remains non-zero and cleans up an owned environment', async () => {
	const executor = createExecutor({
		...stoppedStatus(),
		'npx wp-env run tests-cli wp core is-installed': { code: 17 },
	});
	assert.equal(await run(executor), 17);
	assert.equal(executor.calls.at(-1).args.join(' '), 'wp-env stop');
});

test('startup failure is returned without claiming ownership or cleanup', async () => {
	const executor = createExecutor({
		...stoppedStatus(),
		'npx wp-env start': { code: 19 },
	});
	assert.equal(await run(executor), 19);
	assert.equal(
		executor.calls.some((call) => call.args.join(' ') === 'wp-env stop'),
		false
	);
});

test('API failure remains the final status and still cleans up', async () => {
	const executor = createExecutor({
		...stoppedStatus(),
		'npm run test:api': { code: 23 },
	});
	assert.equal(await run(executor), 23);
	assert.equal(executor.calls.at(-1).args.join(' '), 'wp-env stop');
});

test('interrupt terminates the active child, cleans up, and returns signal status', async () => {
	for (const [signal, exitCode] of [
		['SIGINT', 130],
		['SIGTERM', 143],
	]) {
		const signalSource = new EventEmitter();
		let emitted = false;
		const executor = createExecutor(
			{
				...stoppedStatus(),
				'npx wp-env stop': { code: 31 },
			},
			(call) => {
				if (call.args.join(' ') === 'run test:api' && !emitted) {
					emitted = true;
					signalSource.emit(signal);
				}
			}
		);
		assert.equal(
			await run(executor, makeOptions(), signalSource),
			exitCode
		);
		assert.deepEqual(executor.terminations, [signal]);
		assert.equal(executor.calls.at(-1).args.join(' '), 'wp-env stop');
	}
});

test('pre-existing environment is rejected and never stopped', async () => {
	const executor = createExecutor({
		'npx wp-env status --json': {
			code: 0,
			stdout: JSON.stringify({ status: 'running' }),
		},
	});
	assert.equal(await run(executor), 2);
	assert.equal(executor.calls.length, 1);
});

test('reuse skips status, build, startup, and teardown', async () => {
	const executor = createExecutor();
	assert.equal(await run(executor, makeOptions({ reuse: true })), 0);
	assert.deepEqual(
		executor.calls.map((call) => call.args.join(' ')),
		['wp-env run tests-cli wp core is-installed', 'run test:api']
	);
});

test('workspace and remaining Playwright arguments are forwarded', async () => {
	const executor = createExecutor();
	const parsed = parseArguments([
		'--reuse',
		'--workspace=fair-events',
		'--',
		'GetTickets.api.spec.js',
		'--grep',
		'happy path',
	]);
	assert.equal(await run(executor, parsed), 0);
	assert.deepEqual(executor.calls.at(-1).args, [
		'run',
		'test:api',
		'--workspace=fair-events',
		'--',
		'GetTickets.api.spec.js',
		'--grep',
		'happy path',
	]);
});

test('invalid and non-API workspaces fail before provisioning', async () => {
	for (const workspace of ['missing', 'fair-events-shared']) {
		const executor = createExecutor();
		assert.equal(await run(executor, makeOptions({ workspace })), 2);
		assert.equal(executor.calls.length, 0);
	}
});

test('owned root E2E mode validates Chromium and runs only the root suite', async () => {
	const executor = createExecutor(stoppedStatus());
	let browserChecks = 0;
	assert.equal(
		await run(
			executor,
			makeOptions({ suite: 'e2e' }),
			new EventEmitter(),
			async () => {
				browserChecks++;
			}
		),
		0
	);
	assert.equal(browserChecks, 1);
	assert.equal(
		executor.calls.filter((call) => call.args[1] === 'test:e2e').length,
		1
	);
	assert.deepEqual(executor.calls.at(-2).args, ['run', 'test:e2e']);
});

test('workspace E2E mode forwards specs and Playwright options unchanged', async () => {
	const executor = createExecutor();
	const parsed = parseArguments([
		'--suite=e2e',
		'--reuse',
		'--workspace=fair-events',
		'--',
		'e2e/example.spec.js',
		'--headed',
		'--grep',
		'checkout',
	]);
	assert.equal(await run(executor, parsed), 0);
	assert.deepEqual(executor.calls.at(-1).args, [
		'run',
		'test:e2e',
		'--workspace=fair-events',
		'--',
		'e2e/example.spec.js',
		'--headed',
		'--grep',
		'checkout',
	]);
});

test('workspace E2E defaults to e2e discovery but a spec replaces that filter', () => {
	assert.deepEqual(playwrightArguments(['--headed']), [
		'test',
		'e2e/',
		'--headed',
	]);
	assert.deepEqual(
		playwrightArguments(['e2e/example.spec.js', '--grep', 'checkout']),
		['test', 'e2e/example.spec.js', '--grep', 'checkout']
	);
});

test('missing Chromium fails before environment inspection or startup', async () => {
	const executor = createExecutor(stoppedStatus());
	assert.equal(
		await run(
			executor,
			makeOptions({ suite: 'e2e' }),
			new EventEmitter(),
			async () => {
				throw new Error('missing');
			}
		),
		2
	);
	assert.equal(executor.calls.length, 0);
});

test('invalid E2E workspace fails before browser validation and provisioning', async () => {
	const executor = createExecutor();
	let browserChecks = 0;
	assert.equal(
		await run(
			executor,
			makeOptions({ suite: 'e2e', workspace: 'fair-events-shared' }),
			new EventEmitter(),
			async () => {
				browserChecks++;
			}
		),
		2
	);
	assert.equal(browserChecks, 0);
	assert.equal(executor.calls.length, 0);
});

test('cleanup failure wins only after a successful E2E run', async () => {
	const success = createExecutor({
		...stoppedStatus(),
		'npx wp-env stop': { code: 31 },
	});
	assert.equal(await run(success, makeOptions({ suite: 'e2e' })), 31);

	const failure = createExecutor({
		...stoppedStatus(),
		'npm run test:e2e': { code: 29 },
		'npx wp-env stop': { code: 31 },
	});
	assert.equal(await run(failure, makeOptions({ suite: 'e2e' })), 29);
});
