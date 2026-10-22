import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
	EVENTS_LIST_SCALING,
	EVENT_FIXTURES,
	aggregateSamples,
	buildComparisonMatrix,
	compareToBaseline,
	countRenderedEntries,
	expectedRenderedCount,
	findEventsListSeedProblems,
	findSeedProblems,
	formatJsonReport,
	formatMarkdownReport,
	formatScalingReport,
	growingQueryGroups,
	median,
	normalizeQuery,
	parseArguments,
	parseEventsListSeedOutput,
	parsePluginHeader,
	parseProfileComment,
	parseSeedOutput,
	queryCaller,
	runEventsListScaling,
	sweepSizes,
	runPerformanceAudit,
	scenarioMeasuresEventPages,
	summarizeProfile,
} from '../performance-runner.mjs';

test('parseArguments defaults and flags', () => {
	assert.deepEqual(parseArguments([]), {
		reuse: false,
		samples: 5,
		scenario: undefined,
		outFile: undefined,
		jsonOut: undefined,
		eventsListScaling: false,
		sizes: undefined,
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
			eventsListScaling: false,
			sizes: undefined,
		}
	);
});

test('parseArguments reads the events list scaling mode and its sizes', () => {
	assert.equal(
		parseArguments(['--events-list-scaling']).eventsListScaling,
		true
	);
	assert.deepEqual(
		parseArguments(['--events-list-scaling', '--sizes=0,2,30']).sizes,
		[0, 2, 30]
	);
	for (const sizes of ['', '0,1', '10,5', '0,a', '-2,4', '3,3']) {
		assert.throws(
			() => parseArguments(['--events-list-scaling', `--sizes=${sizes}`]),
			undefined,
			`rejects --sizes=${sizes}`
		);
	}
	assert.throws(() => parseArguments(['--sizes=0,10']));
	assert.throws(() =>
		parseArguments(['--events-list-scaling', '--scenario=fair-events'])
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
		skipped: [],
	});
});

test('EVENT_FIXTURES fixes the fixture sizes and the measured pages', () => {
	assert.equal(EVENT_FIXTURES.requiredPlugin, 'fair-events');
	assert.deepEqual(EVENT_FIXTURES.config, {
		occurrences: 48,
		measuredOccurrence: 24,
		options: 16,
	});
	assert.deepEqual(EVENT_FIXTURES.pages, [
		'recurring-master',
		'recurring-occurrence',
		'event-options',
		'listings',
	]);
});

test('scenarioMeasuresEventPages accepts only scenarios with fair-events active', () => {
	const eligible = buildComparisonMatrix(PLUGINS)
		.filter((scenario) =>
			scenarioMeasuresEventPages(scenario, EVENT_FIXTURES)
		)
		.map((scenario) => scenario.name);
	assert.deepEqual(eligible, [
		'fair-events',
		'fair-events-experimental+deps',
		'production-stack',
		'production-stack+experimental',
	]);
});

const SEED = {
	pages: {
		'recurring-master': '/fair-events/recurring/',
		'recurring-occurrence': '/fair-events/recurring/?event_date=2027-03-26',
		'event-options': '/fair-events/options/',
		listings:
			'/listings/?calendar_month=10&calendar_year=2026&week_view=2026-W42',
	},
	upcomingOccurrences: 48,
	offeredOptions: 16,
};

test('parseSeedOutput reads the PERF_SEED line among other output', () => {
	assert.deepEqual(
		parseSeedOutput(`Notice: noise\nPERF_SEED:${JSON.stringify(SEED)}\n`),
		SEED
	);
	assert.equal(parseSeedOutput('Success: nothing useful\n'), null);
	assert.equal(parseSeedOutput('PERF_SEED:{not json\n'), null);
});

test('findSeedProblems accepts a complete seed and names every shortfall', () => {
	assert.deepEqual(findSeedProblems(SEED, EVENT_FIXTURES), []);
	assert.deepEqual(findSeedProblems(null, EVENT_FIXTURES), [
		'the seed script printed no PERF_SEED result',
	]);
	assert.deepEqual(
		findSeedProblems(
			{
				pages: { ...SEED.pages, listings: undefined },
				upcomingOccurrences: 47,
				offeredOptions: 0,
			},
			EVENT_FIXTURES
		),
		[
			'expected 48 upcoming occurrences, got 47',
			'expected 16 offered options, got 0',
			'no URL for the listings page',
		]
	);
});

test('reports show unmeasured event pages as n/a and measured ones without deltas', () => {
	const metrics = { durationMs: 10, memoryBytes: 1024 * 1024, queryCount: 5 };
	const frontend = { requestCount: 2, transferBytes: 2048 };
	const results = [
		{ scenario: 'wordpress-only', page: 'plain', metrics, frontend },
		{ scenario: 'fair-events', page: 'plain', metrics, frontend },
		{ scenario: 'fair-events', page: 'listings', metrics, frontend },
	];
	const skipped = [
		{
			scenario: 'wordpress-only',
			page: 'listings',
			status: 'n/a',
			reason: 'not measured where fair-events is inactive.',
		},
	];
	const comparisons = compareToBaseline(results, 'wordpress-only');
	assert.deepEqual(
		comparisons.map((c) => c.page),
		['plain'],
		'a page with no WordPress-only measurement gets no comparison'
	);

	const report = formatMarkdownReport({
		results,
		comparisons,
		skipped,
		generatedAt: '2026-10-09T00:00:00.000Z',
	});
	const listings = report.slice(report.indexOf('## listings page'));
	assert.match(
		listings,
		/\| wordpress-only \| n\/a \| — \| n\/a \| — \| n\/a \| — \| n\/a \| — \| n\/a \| — \|/
	);
	assert.match(
		listings,
		/\| fair-events \| 10\.0 \| — \| 5 \| — \| 1\.00 \| — \| 2 \| — \| 2\.0 \| — \|/
	);
	assert.ok(
		listings.indexOf('| wordpress-only |') <
			listings.indexOf('| fair-events |'),
		'rows keep the scenario order of the matrix'
	);
	assert.match(
		listings,
		/n\/a: not measured where fair-events is inactive\./
	);

	const json = JSON.parse(
		formatJsonReport({ results, comparisons, skipped })
	);
	assert.deepEqual(json.skipped, skipped);
	assert.ok(json.results.every((result) => result.metrics));
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

const PLAIN_CREATE_KEY =
	'npx wp-env run tests-cli wp post create --post_type=page --post_status=publish --post_title=Plain --post_name=fair-performance-plain --post_content=<p/> --meta_input={"_fair_performance_fixture":"1"} --porcelain';
const CLEANUP_COMMAND =
	'wp-env run tests-cli wp eval-file wp-content/mu-plugins/scripts/cleanup-performance-fixtures.php';
const SEED_COMMAND = `wp-env run tests-cli wp eval-file wp-content/mu-plugins/scripts/seed-performance-fixtures.php ${JSON.stringify(
	EVENT_FIXTURES.config
)}`;

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
		[PLAIN_CREATE_KEY]: { code: 0, stdout: '42\n' },
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
		commands.indexOf(CLEANUP_COMMAND) <
			commands.findIndex((c) => c.includes('post create')),
		'removes leftovers of an earlier run before creating fixtures'
	);
	assert.ok(
		commands.lastIndexOf(CLEANUP_COMMAND) >
			commands.findIndex((c) => c.includes('post create')),
		'removes the fixtures it created'
	);
	assert.ok(
		commands.lastIndexOf(CLEANUP_COMMAND) <
			commands.lastIndexOf(
				'wp-env run tests-cli wp plugin activate fair-events fair-audience'
			),
		'removes fixtures before restoring the activation state'
	);
});

test('cleanup behavior: a mid-run failure still restores plugin state and removes fixtures', async () => {
	const executor = createExecutor({
		[PLUGIN_LIST_KEY]: { code: 0, stdout: 'fair-events\n' },
		[PLAIN_CREATE_KEY]: { code: 0, stdout: '7\n' },
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
	assert.equal(
		commands.filter((c) => c === CLEANUP_COMMAND).length,
		2,
		'removes the fixtures even after a thrown error'
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
		[PLAIN_CREATE_KEY]: { code: 0, stdout: '1\n' },
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

test('a failed owned start is returned and cleans up the partial start', async () => {
	const executor = createExecutor({
		...stoppedStatus(),
		'npx wp-env start': { code: 19 },
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
	assert.equal(outcome.code, 19);
	const commands = executor.calls.map((c) =>
		[c.command, ...c.args].join(' ')
	);
	assert.deepEqual(commands.slice(-2), [
		'npx wp-env start',
		'npx wp-env stop',
	]);
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
		[PLAIN_CREATE_KEY]: { code: 0, stdout: '1\n' },
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
	assert.equal(
		commands.filter((c) => c === CLEANUP_COMMAND).length,
		2,
		'still removes fixtures created before the scenario check failed'
	);
});

const EVENT_PLUGINS = [
	{ slug: 'fair-events', requiresPlugins: [], experimental: false },
	{ slug: 'fair-audience', requiresPlugins: [], experimental: false },
];
const EVENT_MATRIX = buildComparisonMatrix(EVENT_PLUGINS);
const BASE_URL = 'http://localhost:8889';

/**
 * Run an audit with event fixtures against a fake executor, recording the
 * WP-CLI commands and the measured URLs on one timeline.
 */
async function runEventAudit({
	responses = {},
	options = {},
	measureBackend,
	signalSource = new EventEmitter(),
} = {}) {
	const timeline = [];
	const executor = createExecutor(
		{
			[PLUGIN_LIST_KEY]: { code: 0, stdout: 'fair-audience\n' },
			[PLAIN_CREATE_KEY]: { code: 0, stdout: '42\n' },
			[`npx ${SEED_COMMAND}`]: {
				code: 0,
				stdout: `PERF_SEED:${JSON.stringify(SEED)}\n`,
			},
			...responses,
		},
		(call) => timeline.push(call.args.join(' '))
	);
	const run = runPerformanceAudit({
		options: baseOptions(options),
		executor,
		plugins: EVENT_PLUGINS,
		matrix: EVENT_MATRIX,
		fixtures: TEST_FIXTURES,
		eventFixtures: EVENT_FIXTURES,
		baseUrl: BASE_URL,
		measureBackend: async (url) => {
			timeline.push(`measure ${url}`);
			await measureBackend?.(url);
			return { durationMs: 1, memoryBytes: 1, queryCount: 1 };
		},
		measureFrontend: async () => ({ requestCount: 1, transferBytes: 1 }),
		logger() {},
		signalSource,
	});
	return { run, timeline };
}

const EVENT_URLS = EVENT_FIXTURES.pages.map(
	(page) => `${BASE_URL}${SEED.pages[page]}`
);

test('event pages are seeded and measured only after the empty-site pages, in fair-events scenarios', async () => {
	const { run, timeline } = await runEventAudit();
	const outcome = await run;
	assert.equal(outcome.code, 0);

	const seedAt = timeline.indexOf(SEED_COMMAND);
	const plainMeasures = timeline
		.map((entry, index) => (entry.endsWith('/?p=42') ? index : -1))
		.filter((index) => index >= 0);
	assert.equal(plainMeasures.length, EVENT_MATRIX.length * 2);
	assert.ok(
		plainMeasures.every((index) => index < seedAt),
		'every existing page is measured before any event is seeded'
	);
	assert.equal(
		timeline[seedAt - 1],
		'wp-env run tests-cli wp plugin activate fair-events',
		'seeds with only the plugin that owns the fixtures active'
	);

	const eventMeasures = timeline
		.filter((entry) => entry.startsWith('measure '))
		.slice(plainMeasures.length)
		.map((entry) => entry.slice('measure '.length));
	assert.deepEqual(
		[...new Set(eventMeasures)],
		EVENT_URLS,
		'measures the seeded URLs, in fixture order'
	);

	const eventResults = outcome.results.filter((r) =>
		EVENT_FIXTURES.pages.includes(r.page)
	);
	assert.deepEqual(
		[...new Set(eventResults.map((r) => r.scenario))],
		['fair-events', 'production-stack', 'production-stack+experimental']
	);
	assert.deepEqual(
		outcome.skipped.map((s) => [s.scenario, s.page, s.status]),
		[
			...EVENT_FIXTURES.pages.map((page) => [
				'wordpress-only',
				page,
				'n/a',
			]),
			...EVENT_FIXTURES.pages.map((page) => [
				'fair-audience',
				page,
				'n/a',
			]),
		]
	);
	assert.ok(outcome.skipped.every((s) => s.reason.includes('fair-events')));
	assert.ok(
		outcome.comparisons.every((c) => c.page === 'plain'),
		'event pages have no WordPress-only baseline to compare with'
	);

	assert.ok(
		timeline.lastIndexOf(CLEANUP_COMMAND) >
			timeline.lastIndexOf(`measure ${EVENT_URLS.at(-1)}`)
	);
	assert.ok(
		timeline.lastIndexOf(CLEANUP_COMMAND) <
			timeline.lastIndexOf(
				'wp-env run tests-cli wp plugin activate fair-audience'
			),
		'removes event fixtures before restoring the activation state'
	);
});

test('a focused scenario without fair-events seeds nothing and reports the event pages as skipped', async () => {
	const { run, timeline } = await runEventAudit({
		options: { scenario: 'fair-audience' },
	});
	const outcome = await run;
	assert.equal(outcome.code, 0);
	assert.ok(!timeline.includes(SEED_COMMAND));
	assert.deepEqual(
		outcome.results.map((r) => r.page),
		['plain']
	);
	assert.deepEqual(
		outcome.skipped.map((s) => s.page),
		EVENT_FIXTURES.pages
	);
});

test('cleanup behavior: a seed that fails part-way still has its fixtures removed', async () => {
	const { run, timeline } = await runEventAudit({
		responses: { [`npx ${SEED_COMMAND}`]: { code: 1, stdout: '' } },
	});
	const outcome = await run;
	assert.equal(outcome.code, 1);
	assert.ok(!timeline.some((entry) => EVENT_URLS.includes(entry.slice(8))));
	assert.ok(
		timeline.lastIndexOf(CLEANUP_COMMAND) > timeline.indexOf(SEED_COMMAND)
	);
});

test('an incomplete seed fails the run instead of measuring a smaller fixture', async () => {
	const { run, timeline } = await runEventAudit({
		responses: {
			[`npx ${SEED_COMMAND}`]: {
				code: 0,
				stdout: `PERF_SEED:${JSON.stringify({
					...SEED,
					upcomingOccurrences: 47,
				})}\n`,
			},
		},
	});
	const outcome = await run;
	assert.equal(outcome.code, 1);
	assert.equal(outcome.results, undefined);
	assert.ok(!timeline.some((entry) => EVENT_URLS.includes(entry.slice(8))));
	assert.ok(
		timeline.lastIndexOf(CLEANUP_COMMAND) > timeline.indexOf(SEED_COMMAND)
	);
});

test('cleanup behavior: a failure while measuring an event page removes fixtures and restores plugins', async () => {
	const { run, timeline } = await runEventAudit({
		measureBackend: async (url) => {
			if (url === EVENT_URLS[1]) {
				throw new Error('boom');
			}
		},
	});
	await assert.rejects(run, /boom/);
	const failedAt = timeline.indexOf(`measure ${EVENT_URLS[1]}`);
	assert.ok(timeline.lastIndexOf(CLEANUP_COMMAND) > failedAt);
	assert.equal(
		timeline.at(-1),
		'wp-env run tests-cli wp plugin activate fair-audience'
	);
});

test('cleanup behavior: a signal during event measurement stops the sweep and cleans up', async () => {
	const signalSource = new EventEmitter();
	const { run, timeline } = await runEventAudit({
		signalSource,
		measureBackend: async (url) => {
			if (url === EVENT_URLS[0]) {
				signalSource.emit('SIGTERM');
			}
		},
	});
	const outcome = await run;
	assert.equal(outcome.code, 143);
	assert.equal(
		timeline.filter((entry) =>
			entry.startsWith('wp-env run tests-cli wp plugin activate')
		).length,
		// Four existing-page scenarios with plugins, the seed, the first
		// event scenario, and the restore — no further event scenario.
		7
	);
	assert.ok(
		timeline.lastIndexOf(CLEANUP_COMMAND) >
			timeline.lastIndexOf(`measure ${EVENT_URLS.at(-1)}`)
	);
	assert.equal(signalSource.listenerCount('SIGTERM'), 0);
});

test('cleanup behavior: a failed fixture removal fails an otherwise successful run', async () => {
	let cleanupCalls = 0;
	const timeline = [];
	const executor = {
		async run(command, args) {
			const key = args.join(' ');
			timeline.push(key);
			if (key === CLEANUP_COMMAND) {
				cleanupCalls++;
				return { code: cleanupCalls === 1 ? 0 : 1, stdout: '' };
			}
			if (`${command} ${key}` === PLUGIN_LIST_KEY) {
				return { code: 0, stdout: 'fair-events\n' };
			}
			return { code: 0, stdout: '42\n' };
		},
	};
	const messages = [];
	const outcome = await runPerformanceAudit({
		options: baseOptions(),
		executor,
		plugins: TEST_PLUGINS,
		matrix: TEST_MATRIX,
		fixtures: TEST_FIXTURES,
		baseUrl: BASE_URL,
		measureBackend: async () => ({
			durationMs: 1,
			memoryBytes: 1,
			queryCount: 1,
		}),
		measureFrontend: async () => ({ requestCount: 1, transferBytes: 1 }),
		logger: (message) => messages.push(message),
		signalSource: new EventEmitter(),
	});

	assert.equal(outcome.code, 1);
	assert.ok(outcome.results.length, 'keeps the measurements it took');
	assert.ok(messages.includes('Cleanup failed while removing the fixtures.'));
	assert.equal(
		timeline.at(-1),
		'wp-env run tests-cli wp plugin activate fair-events',
		'still restores the activation state after the failed removal'
	);
});

test('cleanup behavior: a cleanup failure never replaces an earlier failure status', async () => {
	const { run } = await runEventAudit({
		options: { scenario: 'does-not-exist' },
		responses: {
			'npx wp-env run tests-cli wp plugin deactivate fair-events fair-audience':
				{ code: 1, stdout: '' },
		},
	});
	assert.equal((await run).code, 2);
});

test('expectedRenderedCount follows each page and sweep', () => {
	const expected = (sweep, page, size) =>
		expectedRenderedCount(sweep, page, size, EVENTS_LIST_SCALING);
	assert.equal(expected('events', 'control', 50), 0);
	assert.equal(expected('events', 'bundled-query-loop', 0), 0);
	assert.equal(expected('events', 'bundled-query-loop', 50), 10);
	assert.equal(expected('events', 'bundled-query-loop', 5), 5);
	assert.equal(expected('events', 'scaled-query-loop', 200), 200);
	assert.equal(expected('events', 'per-event', 200), 200);
	assert.equal(expected('recurring', 'per-event', 200), 1);
	assert.equal(expected('recurring', 'scaled-query-loop', 0), 0);
});

test('countRenderedEntries counts Query Loop posts and per-event entries', () => {
	const queryLoop =
		'<ul class="wp-block-post-template"><li class="wp-block-post post-1 fair_event"></li><li class="wp-block-post post-2"></li></ul>';
	assert.equal(countRenderedEntries(queryLoop), 2);
	assert.equal(
		countRenderedEntries(
			'<div class="event-list-item is-wordpress"></div><div class="event-list-item is-standalone"></div><div class="event-list-items"></div>'
		),
		2
	);
	assert.equal(
		countRenderedEntries('<p class="no-events">No events found.</p>'),
		0
	);
});

const SCALING_PAGES = Object.fromEntries(
	EVENTS_LIST_SCALING.pages.map((page) => [page, `/${page}/`])
);

function scalingSeed(sweep, size, overrides = {}) {
	return {
		sweep,
		size,
		pages: SCALING_PAGES,
		storedEvents: sweep === 'events' ? size : Math.min(size, 1),
		storedSeries: sweep === 'recurring' ? Math.min(size, 1) : 0,
		upcomingOccurrences: size,
		foreignOccurrences: 0,
		...overrides,
	};
}

test('findEventsListSeedProblems accepts an exact seed and names every mismatch', () => {
	for (const [sweep, size] of [
		['events', 0],
		['events', 50],
		['recurring', 0],
		['recurring', 50],
	]) {
		assert.deepEqual(
			findEventsListSeedProblems(
				scalingSeed(sweep, size),
				sweep,
				size,
				EVENTS_LIST_SCALING
			),
			[]
		);
	}

	assert.deepEqual(
		findEventsListSeedProblems(null, 'events', 10, EVENTS_LIST_SCALING),
		['the seed script printed no PERF_EVENTS_LIST result']
	);

	const problems = findEventsListSeedProblems(
		scalingSeed('events', 10, {
			upcomingOccurrences: 9,
			foreignOccurrences: 16,
			pages: { control: '/control/' },
		}),
		'events',
		10,
		EVENTS_LIST_SCALING
	);
	assert.ok(problems.includes('expected upcomingOccurrences 10, got 9'));
	assert.ok(
		problems.some((problem) =>
			problem.startsWith('the site holds 16 upcoming occurrences')
		)
	);
	assert.ok(problems.includes('no URL for the per-event page'));
	assert.equal(
		parseEventsListSeedOutput(
			`noise\nPERF_EVENTS_LIST:${JSON.stringify({ size: 3 })}\n`
		).size,
		3
	);
	assert.equal(parseEventsListSeedOutput('PERF_EVENTS_LIST:{oops'), null);
});

test('profiling groups queries by caller and query shape', () => {
	assert.equal(
		normalizeQuery(
			"SELECT * FROM `wp_fair_event_dates`\n\tWHERE id = 42 AND title = 'It\\'s' AND x IN (1, 2, 3)"
		),
		'SELECT * FROM `wp_fair_event_dates` WHERE id = ? AND title = ? AND x IN (…)'
	);
	assert.equal(
		queryCaller(
			"require('wp-blog-header.php'), render_block, A::outer, B::inner"
		),
		'A::outer → B::inner'
	);

	const summary = summarizeProfile([
		{ sql: 'SELECT 1 FROM t WHERE id = 1', caller: 'x, A::get' },
		{ sql: 'SELECT 1 FROM t WHERE id = 2', caller: 'x, A::get' },
		{ sql: 'SELECT 1 FROM t WHERE id = 3', caller: 'y, B::get' },
	]);
	assert.deepEqual(summary, [
		{
			caller: 'x → A::get',
			shape: 'SELECT ? FROM t WHERE id = ?',
			count: 2,
		},
		{
			caller: 'y → B::get',
			shape: 'SELECT ? FROM t WHERE id = ?',
			count: 1,
		},
	]);

	assert.deepEqual(
		parseProfileComment(
			'<html></html>\n<!-- FAIR_PERF_PROFILE:[{"sql":"SELECT \\u002d\\u002d","caller":"a"}] -->'
		),
		[{ sql: 'SELECT --', caller: 'a' }]
	);
	assert.equal(parseProfileComment('<html></html>'), null);
});

test('growingQueryGroups leaves out queries that only appear once a list is non-empty', () => {
	const profile = (perRow, size) => [
		{ caller: 'fixed', shape: 'SELECT fixed', count: size ? 1 : 0 },
		{ caller: 'row', shape: 'SELECT row', count: perRow * size },
	];
	const results = [0, 10, 50].map((size) => ({
		sweep: 'events',
		page: 'per-event',
		size,
		profile: profile(2, size).filter((group) => group.count),
	}));
	assert.deepEqual(
		growingQueryGroups(results, 'events', 'per-event', [0, 10, 50]),
		[
			{
				caller: 'row',
				shape: 'SELECT row',
				counts: { 0: 0, 10: 20, 50: 100 },
			},
		]
	);
	assert.equal(
		growingQueryGroups(results.slice(0, 2), 'events', 'per-event', [0, 10])
			.length,
		2,
		'with one non-empty size every change counts'
	);
});

const SCALING_PLUGINS = [
	{ slug: 'fair-events', requiresPlugins: [], experimental: false },
	{ slug: 'fair-audience', requiresPlugins: [], experimental: false },
];
const SCALING = { ...EVENTS_LIST_SCALING, sizes: [0, 10] };
const scalingSeedCommand = (sweep, size) =>
	`wp-env run tests-cli wp eval-file wp-content/mu-plugins/scripts/seed-events-list-fixtures.php ${JSON.stringify(
		{ sweep, size }
	)}`;

/**
 * Run the scaling sweep against a fake executor and a fake backend that
 * renders what each page should, unless `render` says otherwise.
 */
function runScaling({
	seeds = {},
	render,
	measureBackend,
	options = {},
	signalSource = new EventEmitter(),
} = {}) {
	const timeline = [];
	const responses = {
		[PLUGIN_LIST_KEY]: { code: 0, stdout: 'fair-audience\n' },
	};
	for (const sweep of SCALING.sweeps) {
		for (const size of SCALING.sizes) {
			const seed = seeds[`${sweep}:${size}`] ?? scalingSeed(sweep, size);
			responses[`npx ${scalingSeedCommand(sweep, size)}`] = {
				code: 0,
				stdout: `PERF_EVENTS_LIST:${JSON.stringify({
					...seed,
					pages: Object.fromEntries(
						Object.entries(seed.pages).map(([page, path]) => [
							page,
							`/${sweep}-${size}${path}`,
						])
					),
				})}\n`,
			};
		}
	}
	const executor = createExecutor(responses, (call) =>
		timeline.push(call.args.join(' '))
	);
	const run = runEventsListScaling({
		options: baseOptions({ samples: 2, ...options }),
		executor,
		plugins: SCALING_PLUGINS,
		scaling: SCALING,
		baseUrl: BASE_URL,
		measureBackend: async (url, { profile = false } = {}) => {
			timeline.push(`${profile ? 'profile' : 'measure'} ${url}`);
			await measureBackend?.(url);
			const [, sweep, size, page] = /\/(\w+)-(\d+)\/([\w-]+)\/$/.exec(
				url
			);
			const entries =
				render?.(sweep, Number(size), page) ??
				expectedRenderedCount(sweep, page, Number(size), SCALING);
			return {
				durationMs: 2,
				memoryBytes: 8 * 1024 * 1024,
				queryCount: 30 + entries,
				list: {
					count: page === 'control' ? 0 : 1,
					queryCount: entries,
					durationMs: 1,
				},
				environment: { wordpress: '7.1', php: '8.3' },
				body: '<div class="event-list-item"></div>'.repeat(entries),
				recorded: profile
					? Array.from({ length: entries }, (_, id) => ({
							sql: `SELECT * FROM t WHERE id = ${id}`,
							caller: 'x, EventsListSeries::row',
						}))
					: undefined,
			};
		},
		logger() {},
		signalSource,
	});
	return { run, timeline };
}

test('the scaling sweep seeds each size after removing the last one, with fair-events alone', async () => {
	const { run, timeline } = runScaling();
	const outcome = await run;
	assert.equal(outcome.code, 0);

	const seeds = SCALING.sweeps.flatMap((sweep) =>
		SCALING.sizes.map((size) => scalingSeedCommand(sweep, size))
	);
	const seedIndexes = seeds.map((command) => timeline.indexOf(command));
	assert.ok(
		seedIndexes.every((index, i) => index > (seedIndexes[i - 1] ?? -1))
	);
	for (const index of seedIndexes) {
		assert.equal(
			timeline[index - 1],
			CLEANUP_COMMAND,
			'removes the previous size before seeding the next'
		);
	}
	assert.ok(
		timeline.indexOf(
			'wp-env run tests-cli wp plugin activate fair-events'
		) < seedIndexes[0]
	);

	assert.equal(outcome.scaling.length, 4 * SCALING.pages.length);
	assert.deepEqual(outcome.sizes, { events: [0, 10], recurring: [0, 10] });
	assert.deepEqual(outcome.environment, { wordpress: '7.1', php: '8.3' });

	const measuresPerPage = timeline.filter(
		(entry) => entry === `measure ${BASE_URL}/events-10/per-event/`
	).length;
	assert.equal(measuresPerPage, 3, 'one warm-up plus the samples');
	assert.ok(
		!timeline.includes(`profile ${BASE_URL}/events-10/control/`),
		'the control page is not profiled'
	);

	const perEvent = outcome.scaling.find(
		(r) => r.sweep === 'events' && r.size === 10 && r.page === 'per-event'
	);
	assert.equal(perEvent.rendered, 10);
	assert.equal(perEvent.list.queryCount, 10);
	assert.deepEqual(perEvent.profile, [
		{
			caller: 'x → EventsListSeries::row',
			shape: 'SELECT * FROM t WHERE id = ?',
			count: 10,
		},
	]);

	assert.ok(
		timeline.lastIndexOf(CLEANUP_COMMAND) <
			timeline.lastIndexOf(
				'wp-env run tests-cli wp plugin activate fair-audience'
			),
		'removes the fixtures, then restores the activation state'
	);

	const report = formatScalingReport({
		scaling: outcome.scaling,
		environment: outcome.environment,
		sizes: outcome.sizes,
		samples: 2,
		generatedAt: 'now',
	});
	assert.match(report, /## events sweep: distinct events, one date each/);
	assert.match(
		report,
		/\| 10 \| per-event \| 10 \| 0 \| 10 \| 10 \| 40 \| 10 \|/
	);
	assert.match(report, /### events sweep, per-event: queries that grow/);
	assert.match(
		report,
		/\| `x → EventsListSeries::row` \| `SELECT \* FROM t WHERE id = \?` \| 0 \| 10 \|/
	);
	assert.match(report, /WordPress 7\.1, PHP 8\.3/);
});

test('the scaling sweep fails on a rendered count that does not match the fixture, and cleans up', async () => {
	const { run, timeline } = runScaling({
		render: (sweep, size, page) =>
			page === 'bundled-query-loop' && size === 10 ? 9 : undefined,
	});
	const outcome = await run;
	assert.equal(outcome.code, 1);
	assert.equal(outcome.scaling, undefined);
	assert.ok(!timeline.includes(scalingSeedCommand('recurring', 0)));
	assert.equal(
		timeline.at(-1),
		'wp-env run tests-cli wp plugin activate fair-audience'
	);
});

test('the scaling sweep refuses a site with foreign events, and cleans up', async () => {
	const { run, timeline } = runScaling({
		seeds: {
			'events:0': scalingSeed('events', 0, { foreignOccurrences: 3 }),
		},
	});
	assert.equal((await run).code, 1);
	assert.ok(!timeline.some((entry) => entry.startsWith('measure ')));
	assert.equal(
		timeline.at(-3),
		CLEANUP_COMMAND,
		'removes the fixtures, then deactivates and restores the plugins'
	);
});

test('the scaling sweep cleans up after a failed request and after a signal', async () => {
	const failing = runScaling({
		measureBackend: async () => {
			throw new Error('HTTP 500');
		},
	});
	await assert.rejects(failing.run, /HTTP 500/);
	assert.equal(
		failing.timeline.at(-1),
		'wp-env run tests-cli wp plugin activate fair-audience'
	);

	const signalSource = new EventEmitter();
	const interrupted = runScaling({
		signalSource,
		measureBackend: async () => signalSource.emit('SIGTERM'),
	});
	const outcome = await interrupted.run;
	assert.equal(outcome.code, 143);
	assert.ok(
		!interrupted.timeline.includes(scalingSeedCommand('events', 10)),
		'stops before seeding the next size'
	);
	assert.equal(interrupted.timeline.at(-3), CLEANUP_COMMAND);
});

test('sweepSizes caps the recurring sweep at the occurrences one series can hold', () => {
	assert.deepEqual(
		sweepSizes('events', [0, 10, 50, 200], EVENTS_LIST_SCALING),
		[0, 10, 50, 200]
	);
	assert.deepEqual(
		sweepSizes('recurring', [0, 10, 50, 200], EVENTS_LIST_SCALING),
		[0, 10, 50, 100]
	);
	assert.deepEqual(
		sweepSizes('recurring', [0, 150, 200], EVENTS_LIST_SCALING),
		[0, 100]
	);
});
