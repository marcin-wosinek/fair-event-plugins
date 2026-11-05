import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
	formatTimings,
	parseArguments,
	resolveTestsPort,
	runApiTests,
} from '../api-test-runner.mjs';
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
			'npm run test:api --workspace=fair-events',
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

test('startup failure is returned and cleans up a partial start', async () => {
	const executor = createExecutor({
		...stoppedStatus(),
		'npx wp-env start': { code: 19 },
	});
	assert.equal(await run(executor), 19);
	assert.deepEqual(
		executor.calls
			.slice(-2)
			.map((call) => [call.command, ...call.args].join(' ')),
		['npx wp-env start', 'npx wp-env stop']
	);
});

test('startup failure keeps its status when cleanup also fails', async () => {
	const executor = createExecutor({
		...stoppedStatus(),
		'npx wp-env start': { code: 19 },
		'npx wp-env stop': { code: 31 },
	});
	assert.equal(await run(executor), 19);
	assert.equal(executor.calls.at(-1).args.join(' '), 'wp-env stop');
});

test('interrupted startup cleans up and returns signal status', async () => {
	const signalSource = new EventEmitter();
	const executor = createExecutor(
		{
			...stoppedStatus(),
			'npx wp-env start': { code: 130 },
		},
		(call) => {
			if (call.args.join(' ') === 'wp-env start') {
				signalSource.emit('SIGINT');
			}
		}
	);
	assert.equal(await run(executor, makeOptions(), signalSource), 130);
	assert.deepEqual(executor.terminations, ['SIGINT']);
	assert.deepEqual(
		executor.calls
			.slice(-2)
			.map((call) => [call.command, ...call.args].join(' ')),
		['npx wp-env start', 'npx wp-env stop']
	);
});

test('interrupt between steps starts no further steps', async () => {
	const signalSource = new EventEmitter();
	// The build exits cleanly, as if the signal arrived just after it.
	const executor = createExecutor(stoppedStatus(), (call) => {
		if (call.args.join(' ') === 'run build') {
			signalSource.emit('SIGTERM');
		}
	});
	assert.equal(await run(executor, makeOptions(), signalSource), 143);
	assert.deepEqual(
		executor.calls.map((call) => [call.command, ...call.args].join(' ')),
		['npx wp-env status --json', 'npm run build']
	);
});

test('API failure remains the final status and still cleans up', async () => {
	const executor = createExecutor({
		...stoppedStatus(),
		'npm run test:api --workspace=fair-events': { code: 23 },
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
				if (
					call.args.join(' ') ===
						'run test:api --workspace=fair-events' &&
					!emitted
				) {
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
		[
			'wp-env run tests-cli wp core is-installed',
			'run test:api --workspace=fair-events',
		]
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

test('owned root E2E mode forwards the CI shard selection to Playwright', async () => {
	const executor = createExecutor(stoppedStatus());
	const parsed = parseArguments(['--suite=e2e', '--', '--shard=2/4']);
	assert.equal(
		await run(executor, parsed, new EventEmitter(), async () => {}),
		0
	);
	assert.deepEqual(executor.calls.at(-2).args, [
		'run',
		'test:e2e',
		'--',
		'--shard=2/4',
	]);
	assert.deepEqual(executor.calls.at(-1).args, ['wp-env', 'stop']);
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

async function withConfig(files, callback) {
	const directory = await mkdtemp(join(tmpdir(), 'wp-env-port-'));
	try {
		for (const [name, config] of Object.entries(files)) {
			await writeFile(join(directory, name), JSON.stringify(config));
		}
		return await callback(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test('tests port defaults to 8889 without configuration', async () => {
	await withConfig({ '.wp-env.json': { plugins: [] } }, async (directory) => {
		assert.equal(await resolveTestsPort(directory, {}), 8889);
	});
});

test('tests port follows the override file over .wp-env.json', async () => {
	await withConfig(
		{
			'.wp-env.json': { testsPort: 8899 },
			'.wp-env.override.json': { port: 8890, testsPort: 8891 },
		},
		async (directory) => {
			assert.equal(await resolveTestsPort(directory, {}), 8891);
		}
	);
	await withConfig(
		{ '.wp-env.json': { testsPort: 8899 } },
		async (directory) => {
			assert.equal(await resolveTestsPort(directory, {}), 8899);
		}
	);
});

test('tests port accepts the env.tests.port form', async () => {
	await withConfig(
		{
			'.wp-env.json': { testsPort: 8899 },
			'.wp-env.override.json': { env: { tests: { port: 8893 } } },
		},
		async (directory) => {
			assert.equal(await resolveTestsPort(directory, {}), 8893);
		}
	);
	await withConfig(
		{
			'.wp-env.json': { env: { tests: { port: 8897 } } },
			'.wp-env.override.json': { testsPort: 8891 },
		},
		async (directory) => {
			assert.equal(await resolveTestsPort(directory, {}), 8897);
		}
	);
});

test('WP_ENV_TESTS_PORT wins over both files', async () => {
	await withConfig(
		{ '.wp-env.override.json': { testsPort: 8891 } },
		async (directory) => {
			assert.equal(
				await resolveTestsPort(directory, {
					WP_ENV_TESTS_PORT: '8895',
				}),
				8895
			);
		}
	);
});

const twoApiWorkspaces = {
	workspaces: ['fair-events', 'fair-audience', 'fair-events-shared'],
	suiteWorkspaces: {
		api: ['fair-events', 'fair-audience'],
		e2e: [],
	},
};

async function runTwo(executor, runOptions, extra = {}) {
	return runApiTests({
		options: runOptions,
		executor,
		workspaceConfig: twoApiWorkspaces,
		logger() {},
		signalSource: new EventEmitter(),
		...extra,
	});
}

function testCalls(executor) {
	return executor.calls
		.filter((call) => call.args[1] === 'test:api')
		.map((call) => call.args.join(' '));
}

test('every API workspace runs explicitly, and a failure does not stop the next', async () => {
	const executor = createExecutor({
		...stoppedStatus(),
		'npm run test:api --workspace=fair-events': { code: 23 },
		'npm run test:api --workspace=fair-audience': { code: 5 },
	});
	assert.equal(await runTwo(executor, makeOptions()), 23);
	assert.deepEqual(testCalls(executor), [
		'run test:api --workspace=fair-events',
		'run test:api --workspace=fair-audience',
	]);
	assert.equal(executor.calls.at(-1).args.join(' '), 'wp-env stop');
});

test('an API shard selection reaches every workspace and allows empty shards', async () => {
	const executor = createExecutor();
	const parsed = parseArguments(['--reuse', '--shard=2/4', '--grep', 'x']);
	assert.deepEqual(parsed.shard, { current: 2, total: 4 });
	assert.deepEqual(parsed.forwarded, ['--grep', 'x']);
	assert.equal(await runTwo(executor, parsed), 0);
	assert.deepEqual(testCalls(executor), [
		'run test:api --workspace=fair-events -- --shard=2/4 --pass-with-no-tests --grep x',
		'run test:api --workspace=fair-audience -- --shard=2/4 --pass-with-no-tests --grep x',
	]);
});

test('a shard after the workspace separator is still owned by the runner', () => {
	const parsed = parseArguments([
		'--workspace=fair-events',
		'--',
		'--shard=1/2',
	]);
	assert.deepEqual(parsed.shard, { current: 1, total: 2 });
	assert.deepEqual(parsed.forwarded, []);
});

test('E2E keeps forwarding --shard to Playwright untouched', () => {
	const parsed = parseArguments(['--suite=e2e', '--shard=3/4']);
	assert.equal(parsed.shard, undefined);
	assert.deepEqual(parsed.forwarded, ['--shard=3/4']);
});

test('invalid shard and results options are rejected', () => {
	for (const args of [
		['--shard=0/4'],
		['--shard=5/4'],
		['--shard=1'],
		['--shard=a/b'],
		['--shard=1/2', '--shard=2/2'],
		['--results-dir='],
		['--suite=e2e', '--results-dir=out'],
	]) {
		assert.throws(() => parseArguments(args), undefined, args.join(' '));
	}
});

test('a results directory adds a JSON report per workspace without dropping annotations', async () => {
	const executor = createExecutor();
	const parsed = parseArguments([
		'--reuse',
		'--shard=1/4',
		'--results-dir=/tmp/api-results',
	]);
	assert.equal(await runTwo(executor, parsed), 0);
	const calls = executor.calls.filter((call) => call.args[1] === 'test:api');
	assert.deepEqual(
		calls.map((call) => call.args.slice(3)),
		[
			[
				'--',
				'--shard=1/4',
				'--pass-with-no-tests',
				'--reporter=github,html,json',
			],
			[
				'--',
				'--shard=1/4',
				'--pass-with-no-tests',
				'--reporter=github,html,json',
			],
		]
	);
	assert.deepEqual(
		calls.map((call) => call.options.env.PLAYWRIGHT_JSON_OUTPUT_FILE),
		[
			'/tmp/api-results/fair-events.json',
			'/tmp/api-results/fair-audience.json',
		]
	);
});

test('phase timings are recorded for preparation, each workspace and cleanup', async () => {
	let now = 0;
	const executor = createExecutor(stoppedStatus(), () => {
		now += 1500;
	});
	const written = [];
	const parsed = makeOptions({ shard: { current: 1, total: 4 } });
	assert.equal(
		await runTwo(executor, parsed, {
			clock: () => now,
			writeTimings: async (timings) => written.push(timings),
		}),
		0
	);
	assert.equal(written.length, 1);
	assert.deepEqual(written[0].shard, { current: 1, total: 4 });
	assert.deepEqual(
		written[0].phases.map((entry) => [entry.name, entry.seconds]),
		[
			['Build', 1.5],
			['Composer install', 1.5],
			['wp-env start', 1.5],
			['WordPress readiness', 3],
			['API tests: fair-events', 1.5],
			['API tests: fair-audience', 1.5],
			['wp-env stop', 1.5],
		]
	);
	const summary = formatTimings(written[0]);
	assert.match(summary, /### API shard 1\/4 timings/);
	assert.match(summary, /\| API tests: fair-events \| 1\.5 s \| ok \|/);
});

test('timings are still written when a workspace fails', async () => {
	const executor = createExecutor({
		'npm run test:api --workspace=fair-audience': { code: 1 },
	});
	const written = [];
	assert.equal(
		await runTwo(executor, makeOptions({ reuse: true }), {
			writeTimings: async (timings) => written.push(timings),
		}),
		1
	);
	assert.deepEqual(
		written[0].phases.map((entry) => entry.code),
		[0, 0, 1]
	);
	assert.match(formatTimings(written[0]), /fair-audience \| .* \| exit 1 \|/);
});

test('an interrupt during one workspace starts no further workspaces', async () => {
	const signalSource = new EventEmitter();
	const executor = createExecutor(stoppedStatus(), (call) => {
		if (call.args.join(' ') === 'run test:api --workspace=fair-events') {
			signalSource.emit('SIGINT');
		}
	});
	assert.equal(await runTwo(executor, makeOptions(), { signalSource }), 130);
	assert.deepEqual(testCalls(executor), [
		'run test:api --workspace=fair-events',
	]);
	assert.equal(executor.calls.at(-1).args.join(' '), 'wp-env stop');
});
