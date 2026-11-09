import assert from 'node:assert/strict';
import test from 'node:test';

import {
	aggregateSamples,
	fileSamples,
	formatReport,
	latestShardFolders,
	median,
	parseOptions,
	runFigures,
} from '../shard-timings.mjs';

const at = (seconds) =>
	new Date(Date.UTC(2026, 10, 9, 10, 0, seconds)).toISOString();

function result(startSecond, durationSeconds, retry = 0) {
	return {
		startTime: at(startSecond),
		duration: durationSeconds * 1000,
		retry,
	};
}

const report = {
	config: {
		configFile: '/ci/repo/playwright.config.js',
		rootDir: '/ci/repo/e2e',
	},
	stats: { duration: 120000, flaky: 1, unexpected: 0 },
	suites: [
		{
			file: 'clean.spec.js',
			specs: [
				{ tests: [{ status: 'expected', results: [result(0, 4)] }] },
			],
			suites: [
				{
					specs: [
						{
							tests: [
								{ status: 'skipped', results: [result(5, 0)] },
								{ status: 'expected', results: [result(6, 4)] },
							],
						},
					],
				},
			],
		},
		{
			file: 'flaky.spec.js',
			specs: [
				{
					tests: [
						{
							status: 'flaky',
							results: [result(20, 5), result(30, 5, 1)],
						},
					],
				},
			],
		},
		{
			file: 'unrun.spec.js',
			specs: [{ tests: [{ status: 'skipped', results: [] }] }],
		},
	],
};

test('a clean file spans its first test start to its last test end', () => {
	const [clean, flaky, unrun] = fileSamples(report);
	assert.deepEqual(clean, {
		id: 'e2e/clean.spec.js',
		seconds: 10,
		clean: true,
		retries: 0,
		failures: 0,
	});
	// Retries and failures are kept visible instead of counting as timings.
	assert.equal(flaky.clean, false);
	assert.equal(flaky.retries, 1);
	assert.equal(flaky.failures, 1);
	assert.equal(unrun.clean, false);
});

test('API samples are named by workspace', () => {
	const apiReport = {
		config: {
			configFile: '/ci/repo/fair-form/playwright.config.js',
			rootDir: '/ci/repo/fair-form',
		},
		suites: [
			{
				file: 'src/API/__tests__/A.api.spec.js',
				specs: [
					{
						tests: [
							{ status: 'expected', results: [result(0, 2)] },
						],
					},
				],
			},
		],
	};
	assert.equal(
		fileSamples(apiReport, 'fair-form')[0].id,
		'fair-form/src/API/__tests__/A.api.spec.js'
	);
});

test('timings are the median of clean samples; excluded ones stay counted', () => {
	const sample = (id, seconds, clean = true) => ({ id, seconds, clean });
	const files = aggregateSamples([
		[sample('b', 10), sample('a', 30, false)],
		[sample('b', 14), sample('a', 50, false)],
		[sample('b', 99, false), sample('a', 40, false)],
	]);
	assert.deepEqual(Object.keys(files), ['a', 'b']);
	assert.deepEqual(files.b, { seconds: 12, samples: 2, excluded: 1 });
	// Never clean: keeps its observed cost, marked with samples: 0.
	assert.deepEqual(files.a, { seconds: 40, samples: 0, excluded: 3 });
	assert.equal(median([]), undefined);
});

test('only the latest attempt of each shard artifact is read', () => {
	assert.deepEqual(
		[
			...latestShardFolders(
				[
					'api-report-shard-2-of-4-attempt-1',
					'api-report-shard-1-of-4-attempt-2',
					'api-report-shard-1-of-4-attempt-1',
					'api-inventory-attempt-1',
				],
				'api'
			),
		],
		[
			[1, 'api-report-shard-1-of-4-attempt-2'],
			[2, 'api-report-shard-2-of-4-attempt-1'],
		]
	);
	assert.deepEqual(
		[
			...latestShardFolders(
				['playwright-report-shard-3-of-4-attempt-1'],
				'e2e'
			),
		],
		[[3, 'playwright-report-shard-3-of-4-attempt-1']]
	);
});

test('run figures exclude queue time and use per-shard test time', () => {
	const metadata = {
		conclusion: 'success',
		attempt: 1,
		jobs: [
			{ startedAt: at(0), completedAt: at(60) },
			{ startedAt: at(60), completedAt: at(660) },
			{ startedAt: at(60), completedAt: at(360) },
			{ startedAt: null, completedAt: null },
		],
	};
	const apiShards = [
		{
			reports: [{ report: { stats: { flaky: 2, unexpected: 1 } } }],
			timings: {
				phases: [
					{ name: 'Build', seconds: 600 },
					{ name: 'API tests: a', seconds: 240 },
					{ name: 'API tests: b', seconds: 120 },
				],
			},
		},
		{
			reports: [],
			timings: { phases: [{ name: 'API tests: a', seconds: 60 }] },
		},
	];
	const figures = runFigures(metadata, apiShards, 'api');
	assert.equal(figures.elapsed, 11);
	assert.equal(figures.runnerMinutes, 16);
	assert.deepEqual(figures.shardMinutes, [6, 1]);
	assert.equal(figures.gap, 5);
	assert.equal(figures.flaky, 2);
	assert.equal(figures.failed, 1);

	const e2e = runFigures(metadata, [{ reports: [{ report }] }], 'e2e');
	assert.deepEqual(e2e.shardMinutes, [2]);

	const markdown = formatReport('After', [
		{ run: '1', figures },
		{ run: '2', figures: { ...figures, attempt: 2 } },
	]);
	assert.match(
		markdown,
		/\| 2 \| success \(attempt 2\) \| 11\.0 \| 6\.0 \| 1\.0 \|/
	);
	assert.match(
		markdown,
		/\| Slowest shard, test time \| 6\.0 \(6\.0–6\.0\) \|/
	);
});

test('options name a command, a suite and at least one run', () => {
	assert.deepEqual(
		parseOptions([
			'report',
			'--suite=api',
			'--run=1',
			'--run=2',
			'--label=Before',
		]),
		{ command: 'report', suite: 'api', runs: ['1', '2'], label: 'Before' }
	);
	for (const args of [
		[],
		['refresh', '--suite=unit', '--run=1'],
		['refresh', '--suite=e2e'],
		['refresh', '--suite=e2e', '--run=abc'],
	]) {
		assert.throws(() => parseOptions(args), undefined, args.join(' '));
	}
});
