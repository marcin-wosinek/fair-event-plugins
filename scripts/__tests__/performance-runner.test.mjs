import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
	aggregateSamples,
	buildComparisonMatrix,
	compareToBaseline,
	formatJsonReport,
	formatMarkdownReport,
	median,
	parseArguments,
	parsePluginHeader,
	runPerformanceAudit,
} from '../performance-runner.mjs';

test('parseArguments defaults and flags', () => {
	assert.deepEqual(parseArguments([]), {
		reuse: false,
		samples: 5,
		scenario: undefined,
		outFile: undefined,
		jsonOut: undefined,
	});
	assert.deepEqual(
		parseArguments([
			'--reuse',
			'--samples=3',
			'--scenario=fair-events',
			'--out=report.md',
			'--json-out=report.json',
		]),
		{
			reuse: true,
			samples: 3,
			scenario: 'fair-events',
			outFile: 'report.md',
			jsonOut: 'report.json',
		}
	);
});

test('parseArguments rejects an invalid --samples value', () => {
	assert.throws(() => parseArguments(['--samples=0']));
	assert.throws(() => parseArguments(['--samples=abc']));
});

test('parseArguments rejects an unknown argument', () => {
	assert.throws(() => parseArguments(['--bogus']));
});

test('parsePluginHeader reads name and Requires Plugins', () => {
	const contents = `<?php
/**
 * Plugin Name: Fair Events Experimental
 * Description: Advanced feature bundles. Requires fair-events.
 * Version: 1.8.0
 * Requires Plugins: fair-events
 */
`;
	assert.deepEqual(parsePluginHeader(contents), {
		name: 'Fair Events Experimental',
		requiresPlugins: ['fair-events'],
	});
});

test('parsePluginHeader tolerates a missing Requires Plugins header', () => {
	const contents = `<?php
/**
 * Plugin Name: Fair Events
 * Version: 1.18.0
 */
`;
	assert.deepEqual(parsePluginHeader(contents), {
		name: 'Fair Events',
		requiresPlugins: [],
	});
});

const PLUGINS = [
	{ slug: 'fair-events', requiresPlugins: [], experimental: false },
	{ slug: 'fair-audience', requiresPlugins: [], experimental: false },
	{
		slug: 'fair-events-experimental',
		requiresPlugins: ['fair-events'],
		experimental: true,
	},
	{
		slug: 'fair-payments-connector-experimental',
		requiresPlugins: [],
		experimental: true,
	},
];

test('buildComparisonMatrix covers baseline, standalone, dependency-bound, and stacks', () => {
	const matrix = buildComparisonMatrix(PLUGINS);
	assert.deepEqual(
		matrix.map((s) => s.name),
		[
			'wordpress-only',
			'fair-events',
			'fair-audience',
			'fair-payments-connector-experimental',
			'fair-events-experimental+deps',
			'production-stack',
			'production-stack+experimental',
		]
	);
	assert.deepEqual(matrix[0].plugins, []);
	assert.deepEqual(matrix[1].plugins, ['fair-events']);
	assert.deepEqual(
		matrix.find((s) => s.name === 'fair-events-experimental+deps').plugins,
		['fair-events', 'fair-events-experimental']
	);
	assert.deepEqual(
		matrix.find((s) => s.name === 'production-stack').plugins,
		['fair-events', 'fair-audience']
	);
	assert.deepEqual(
		matrix.find((s) => s.name === 'production-stack+experimental').plugins,
		[
			'fair-events',
			'fair-audience',
			'fair-events-experimental',
			'fair-payments-connector-experimental',
		]
	);
});

test('median handles odd, even, and empty inputs', () => {
	assert.equal(median([3, 1, 2]), 2);
	assert.equal(median([1, 2, 3, 4]), 2.5);
	assert.equal(median([]), null);
});

test('aggregateSamples discards the warm-up sample before taking medians', () => {
	const samples = [
		{ durationMs: 999, memoryBytes: 999, queryCount: 999 },
		{ durationMs: 10, memoryBytes: 100, queryCount: 5 },
		{ durationMs: 20, memoryBytes: 200, queryCount: 7 },
		{ durationMs: 30, memoryBytes: 300, queryCount: 9 },
	];
	assert.deepEqual(aggregateSamples(samples), {
		durationMs: 20,
		memoryBytes: 200,
		queryCount: 7,
		sampleCount: 3,
	});
});

test('aggregateSamples rejects an all-warm-up input', () => {
	assert.throws(() =>
		aggregateSamples([{ durationMs: 1, memoryBytes: 1, queryCount: 1 }])
	);
});

test('compareToBaseline computes per-page deltas against the baseline scenario', () => {
	const results = [
		{
			scenario: 'wordpress-only',
			page: 'plain',
			metrics: { durationMs: 10, memoryBytes: 1000, queryCount: 5 },
			frontend: { requestCount: 2, transferBytes: 200 },
		},
		{
			scenario: 'fair-events',
			page: 'plain',
			metrics: { durationMs: 15, memoryBytes: 1200, queryCount: 8 },
			frontend: { requestCount: 4, transferBytes: 500 },
		},
	];
	assert.deepEqual(compareToBaseline(results, 'wordpress-only'), [
		{
			scenario: 'fair-events',
			page: 'plain',
			deltaDurationMs: 5,
			deltaQueryCount: 3,
			deltaMemoryBytes: 200,
			deltaRequestCount: 2,
			deltaTransferBytes: 300,
		},
	]);
});

test('compareToBaseline skips a scenario with no matching baseline page', () => {
	const results = [
		{
			scenario: 'wordpress-only',
			page: 'plain',
			metrics: { durationMs: 10, memoryBytes: 1000, queryCount: 5 },
			frontend: { requestCount: 2, transferBytes: 200 },
		},
		{
			scenario: 'fair-events',
			page: 'feature',
			metrics: { durationMs: 15, memoryBytes: 1200, queryCount: 8 },
			frontend: { requestCount: 4, transferBytes: 500 },
		},
	];
	assert.deepEqual(compareToBaseline(results, 'wordpress-only'), []);
});

test('formatMarkdownReport renders one table per page with deltas', () => {
	const results = [
		{
			scenario: 'wordpress-only',
			page: 'plain',
			metrics: {
				durationMs: 10,
				memoryBytes: 1024 * 1024,
				queryCount: 5,
			},
			frontend: { requestCount: 2, transferBytes: 2048 },
		},
		{
			scenario: 'fair-events',
			page: 'plain',
			metrics: {
				durationMs: 15,
				memoryBytes: 2 * 1024 * 1024,
				queryCount: 8,
			},
			frontend: { requestCount: 4, transferBytes: 4096 },
		},
	];
	const comparisons = compareToBaseline(results, 'wordpress-only');
	const report = formatMarkdownReport({
		results,
		comparisons,
		generatedAt: '2026-09-22T00:00:00.000Z',
	});
	assert.match(report, /## plain page/);
	assert.match(report, /\| wordpress-only \|/);
	assert.match(report, /\| fair-events \| 15\.0 \| \+5\.0 ms \|/);
	assert.match(report, /Generated: 2026-09-22T00:00:00\.000Z/);
});

test('formatJsonReport serializes results, comparisons, and the timestamp', () => {
	const results = [
		{
			scenario: 'wordpress-only',
			page: 'plain',
			metrics: { durationMs: 10, memoryBytes: 1024, queryCount: 5 },
			frontend: { requestCount: 2, transferBytes: 200 },
		},
		{
			scenario: 'fair-events',
			page: 'plain',
			metrics: { durationMs: 15, memoryBytes: 1200, queryCount: 8 },
			frontend: { requestCount: 4, transferBytes: 500 },
		},
	];
	const comparisons = compareToBaseline(results, 'wordpress-only');
	const json = formatJsonReport({
		results,
		comparisons,
		generatedAt: '2026-09-22T00:00:00.000Z',
	});
	assert.deepEqual(JSON.parse(json), {
		generatedAt: '2026-09-22T00:00:00.000Z',
		results,
		comparisons,
	});
});

function createExecutor(responses = {}, onRun) {
	const calls = [];
	return {
		calls,
		async run(command, args, options) {
			const call = { command, args, options };
			calls.push(call);
			onRun?.(call);
			const key = `${command} ${args.join(' ')}`;
			return responses[key] ?? { code: 0, stdout: '' };
		},
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

const PLUGIN_LIST_KEY =
	'npx wp-env run tests-cli wp plugin list --status=active --field=name';

const TEST_PLUGINS = [
	{ slug: 'fair-events', requiresPlugins: [], experimental: false },
];
const TEST_MATRIX = buildComparisonMatrix(TEST_PLUGINS);
const TEST_FIXTURES = {
	plain: { title: 'Plain', slug: 'fair-performance-plain', content: '<p/>' },
};

function baseOptions(overrides = {}) {
	return {
		reuse: true,
		samples: 1,
		scenario: undefined,
		outFile: undefined,
		...overrides,
	};
}

test('cleanup behavior: plugin state is restored and fixtures removed after a successful run', async () => {
	const executor = createExecutor({
		[PLUGIN_LIST_KEY]: { code: 0, stdout: 'fair-events\nfair-audience\n' },
		'npx wp-env run tests-cli wp post create --post_type=page --post_status=publish --post_title=Plain --post_name=fair-performance-plain --post_content=<p/> --porcelain':
			{ code: 0, stdout: '42\n' },
	});
	const outcome = await runPerformanceAudit({
		options: baseOptions(),
		executor,
		plugins: TEST_PLUGINS,
		matrix: TEST_MATRIX,
		fixtures: TEST_FIXTURES,
		baseUrl: 'http://localhost:8889',
		measureBackend: async () => ({
			durationMs: 1,
			memoryBytes: 1,
			queryCount: 1,
		}),
		measureFrontend: async () => ({ requestCount: 1, transferBytes: 1 }),
		logger() {},
		signalSource: new EventEmitter(),
	});

	assert.equal(outcome.code, 0);
	const commands = executor.calls.map((c) => c.args.join(' '));
	assert.ok(
		commands.includes(
			'wp-env run tests-cli wp plugin activate fair-events fair-audience'
		),
		'restores originally active plugins'
	);
	assert.ok(
		commands.includes('wp-env run tests-cli wp post delete 42 --force'),
		'removes the fixture page it created'
	);
});

test('cleanup behavior: a mid-run failure still restores plugin state and removes fixtures', async () => {
	const executor = createExecutor({
		[PLUGIN_LIST_KEY]: { code: 0, stdout: 'fair-events\n' },
		'npx wp-env run tests-cli wp post create --post_type=page --post_status=publish --post_title=Plain --post_name=fair-performance-plain --post_content=<p/> --porcelain':
			{ code: 0, stdout: '7\n' },
	});
	await assert.rejects(
		runPerformanceAudit({
			options: baseOptions(),
			executor,
			plugins: TEST_PLUGINS,
			matrix: TEST_MATRIX,
			fixtures: TEST_FIXTURES,
			baseUrl: 'http://localhost:8889',
			measureBackend: async () => {
				throw new Error('boom');
			},
			measureFrontend: async () => ({
				requestCount: 0,
				transferBytes: 0,
			}),
			logger() {},
			signalSource: new EventEmitter(),
		})
	);

	const commands = executor.calls.map((c) => c.args.join(' '));
	assert.ok(
		commands.includes(
			'wp-env run tests-cli wp plugin activate fair-events'
		),
		'restores plugin state even after a thrown error'
	);
	assert.ok(
		commands.includes('wp-env run tests-cli wp post delete 7 --force'),
		'removes the fixture page even after a thrown error'
	);
});

test('cleanup behavior: a failure before state capture never touches plugin activation', async () => {
	const executor = createExecutor({
		[PLUGIN_LIST_KEY]: { code: 1, stdout: '' },
	});
	const outcome = await runPerformanceAudit({
		options: baseOptions(),
		executor,
		plugins: TEST_PLUGINS,
		matrix: TEST_MATRIX,
		fixtures: TEST_FIXTURES,
		baseUrl: 'http://localhost:8889',
		measureBackend: async () => ({
			durationMs: 1,
			memoryBytes: 1,
			queryCount: 1,
		}),
		measureFrontend: async () => ({ requestCount: 1, transferBytes: 1 }),
		logger() {},
		signalSource: new EventEmitter(),
	});

	assert.equal(outcome.code, 1);
	const commands = executor.calls.map((c) => c.args.join(' '));
	assert.ok(
		!commands.some((c) => c.includes('plugin deactivate')),
		'never deactivates plugins when the state snapshot itself failed'
	);
});

test('owned run builds, starts, provisions, and stops the environment', async () => {
	const executor = createExecutor({
		...stoppedStatus(),
		[PLUGIN_LIST_KEY]: { code: 0, stdout: '' },
		'npx wp-env run tests-cli wp post create --post_type=page --post_status=publish --post_title=Plain --post_name=fair-performance-plain --post_content=<p/> --porcelain':
			{ code: 0, stdout: '1\n' },
	});
	const outcome = await runPerformanceAudit({
		options: baseOptions({ reuse: false }),
		executor,
		plugins: TEST_PLUGINS,
		matrix: TEST_MATRIX,
		fixtures: TEST_FIXTURES,
		baseUrl: 'http://localhost:8889',
		measureBackend: async () => ({
			durationMs: 1,
			memoryBytes: 1,
			queryCount: 1,
		}),
		measureFrontend: async () => ({ requestCount: 1, transferBytes: 1 }),
		logger() {},
		signalSource: new EventEmitter(),
	});

	assert.equal(outcome.code, 0);
	const commands = executor.calls.map((c) =>
		[c.command, ...c.args].join(' ')
	);
	assert.deepEqual(commands.slice(0, 4), [
		'npx wp-env status --json',
		'npm run build',
		'npm run composer:install:prod',
		'npx wp-env start',
	]);
	assert.ok(commands.at(-1) === 'npx wp-env stop');
});

test('an already-running environment is refused when not reusing', async () => {
	const executor = createExecutor({
		'npx wp-env status --json': {
			code: 0,
			stdout: JSON.stringify({ status: 'running' }),
		},
	});
	const outcome = await runPerformanceAudit({
		options: baseOptions({ reuse: false }),
		executor,
		plugins: TEST_PLUGINS,
		matrix: TEST_MATRIX,
		fixtures: TEST_FIXTURES,
		baseUrl: 'http://localhost:8889',
		measureBackend: async () => ({
			durationMs: 1,
			memoryBytes: 1,
			queryCount: 1,
		}),
		measureFrontend: async () => ({ requestCount: 0, transferBytes: 0 }),
		logger() {},
		signalSource: new EventEmitter(),
	});
	assert.equal(outcome.code, 2);
});

test('an unknown --scenario is rejected after fixtures are ready', async () => {
	const executor = createExecutor({
		[PLUGIN_LIST_KEY]: { code: 0, stdout: '' },
		'npx wp-env run tests-cli wp post create --post_type=page --post_status=publish --post_title=Plain --post_name=fair-performance-plain --post_content=<p/> --porcelain':
			{ code: 0, stdout: '1\n' },
	});
	const outcome = await runPerformanceAudit({
		options: baseOptions({ scenario: 'does-not-exist' }),
		executor,
		plugins: TEST_PLUGINS,
		matrix: TEST_MATRIX,
		fixtures: TEST_FIXTURES,
		baseUrl: 'http://localhost:8889',
		measureBackend: async () => ({
			durationMs: 1,
			memoryBytes: 1,
			queryCount: 1,
		}),
		measureFrontend: async () => ({ requestCount: 1, transferBytes: 1 }),
		logger() {},
		signalSource: new EventEmitter(),
	});
	assert.equal(outcome.code, 2);
	const commands = executor.calls.map((c) => c.args.join(' '));
	assert.ok(
		commands.includes('wp-env run tests-cli wp post delete 1 --force'),
		'still removes fixtures created before the scenario check failed'
	);
});
