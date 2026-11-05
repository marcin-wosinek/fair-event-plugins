import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectResults,
	latestArtifacts,
	parseOptions,
	planInventory,
	verifyExecution,
	workspaceKeys,
} from '../check-api-shards.mjs';

test('options select planning or verification and validate their inputs', () => {
	assert.deepEqual(parseOptions(['--total=4', '--output=inv.json']), {
		mode: 'plan',
		total: 4,
		output: 'inv.json',
	});
	assert.deepEqual(parseOptions(['--verify', '--results=out']), {
		mode: 'verify',
		results: 'out',
	});
	assert.throws(() => parseOptions(['--total=0']));
	assert.throws(() => parseOptions([]));
	assert.throws(() => parseOptions(['--verify']));
});

test('after re-running failed jobs, the latest attempt of each artifact wins', () => {
	const { inventory, shards } = latestArtifacts([
		'api-inventory-attempt-1',
		'api-report-shard-1-of-4-attempt-1',
		'api-report-shard-2-of-4-attempt-1',
		'api-report-shard-2-of-4-attempt-2',
		'api-report-shard-3-of-4-attempt-10',
		'api-report-shard-3-of-4-attempt-9',
		'unrelated',
	]);
	assert.equal(inventory, 'api-inventory-attempt-1');
	assert.deepEqual(
		[...shards].map(([key, value]) => [key, value.folder]),
		[
			['1/4', 'api-report-shard-1-of-4-attempt-1'],
			['2/4', 'api-report-shard-2-of-4-attempt-2'],
			['3/4', 'api-report-shard-3-of-4-attempt-10'],
		]
	);
});

test('workspace identity keeps equal test paths in two workspaces distinct', () => {
	assert.deepEqual(
		workspaceKeys('fair-events', ['a.spec.js › t [chromium]']),
		['fair-events: a.spec.js › t [chromium]']
	);
	const { problems, inventory } = planInventory(
		{
			'fair-events': { full: ['a › t'], shards: [['a › t'], []] },
			'fair-form': { full: ['a › t'], shards: [[], ['a › t']] },
		},
		2
	);
	assert.deepEqual(problems, []);
	assert.deepEqual(inventory.shards, [
		['fair-events: a › t'],
		['fair-form: a › t'],
	]);
	assert.equal(inventory.tests, 2);
});

test('empty workspace shards are fine, an empty suite is not', () => {
	const small = planInventory(
		{ 'fair-form': { full: ['a › t'], shards: [['a › t'], [], []] } },
		3
	);
	assert.deepEqual(small.problems, []);
	assert.deepEqual(
		small.inventory.workspaces['fair-form'].perShard,
		[1, 0, 0]
	);

	const empty = planInventory(
		{ 'fair-form': { full: [], shards: [[], []] } },
		2
	);
	assert.deepEqual(empty.problems, [
		'No API tests were listed in any workspace.',
	]);
});

test('missing, duplicated and unexpected planned tests are reported', () => {
	const { problems } = planInventory(
		{
			w: {
				full: ['a', 'b', 'c'],
				shards: [
					['a', 'b'],
					['b', 'x'],
				],
			},
		},
		2
	);
	assert.deepEqual(problems, [
		'Runs in shards 1, 2: w: b',
		'Missing from every shard: w: c',
		'Listed by shard 2 but not by the unsharded run: w: x',
	]);
});

const resultsReport = {
	suites: [
		{
			title: 'a.api.spec.js',
			specs: [
				{
					title: 'passes',
					tests: [
						{
							projectName: 'chromium',
							status: 'expected',
							results: [{ status: 'passed' }],
						},
					],
				},
				{
					title: 'skipped on purpose',
					tests: [
						{
							projectName: 'chromium',
							status: 'skipped',
							results: [{ status: 'skipped' }],
						},
					],
				},
				{
					title: 'flaky',
					tests: [
						{
							projectName: 'chromium',
							status: 'flaky',
							results: [
								{ status: 'failed' },
								{ status: 'passed' },
							],
						},
					],
				},
				{
					title: 'never started',
					tests: [
						{
							projectName: 'chromium',
							status: 'skipped',
							results: [],
						},
					],
				},
			],
		},
	],
};

test('results count skips as run and a test without results as not run', () => {
	assert.deepEqual(
		collectResults('w', resultsReport).map((entry) => [
			entry.key,
			entry.ran,
			entry.attempts,
		]),
		[
			['w: a.api.spec.js › passes [chromium]', true, 1],
			['w: a.api.spec.js › skipped on purpose [chromium]', true, 1],
			['w: a.api.spec.js › flaky [chromium]', true, 2],
			['w: a.api.spec.js › never started [chromium]', false, 0],
		]
	);
});

test('verification flags unrun, unplanned and missing-shard tests, and reports retries and failures', () => {
	const entries = collectResults('w', resultsReport);
	const inventory = {
		total: 3,
		shards: [
			[
				'w: a.api.spec.js › passes [chromium]',
				'w: a.api.spec.js › skipped on purpose [chromium]',
				'w: a.api.spec.js › never started [chromium]',
				'w: a.api.spec.js › lost [chromium]',
			],
			[],
			['w: b.api.spec.js › other [chromium]'],
		],
	};
	const failing = {
		key: 'w: c.api.spec.js › breaks [chromium]',
		ran: true,
		status: 'unexpected',
		attempts: 3,
	};
	const { problems, retried, failed } = verifyExecution(inventory, [
		entries,
		[failing],
		undefined,
	]);
	assert.deepEqual(problems, [
		'Did not run in shard 1/3: w: a.api.spec.js › never started [chromium]',
		'Did not run in shard 1/3: w: a.api.spec.js › lost [chromium]',
		'Ran in shard 1/3 but was not planned there: w: a.api.spec.js › flaky [chromium]',
		'Ran in shard 2/3 but was not planned there: w: c.api.spec.js › breaks [chromium]',
		'Shard 3/3 left no results; its 1 planned tests are unaccounted for.',
	]);
	assert.deepEqual(retried, [
		'w: a.api.spec.js › flaky [chromium] (shard 1/3, 2 attempts)',
	]);
	assert.deepEqual(failed, [
		'w: c.api.spec.js › breaks [chromium] (shard 2/3)',
	]);
});

test('a complete run passes verification, and a shard with no plan needs no results', () => {
	const entries = collectResults('w', resultsReport).filter(
		(entry) => entry.ran
	);
	const inventory = {
		total: 2,
		shards: [entries.map((entry) => entry.key), []],
	};
	const { problems, retried } = verifyExecution(inventory, [
		entries,
		undefined,
	]);
	assert.deepEqual(problems, []);
	assert.equal(retried.length, 1);
});
