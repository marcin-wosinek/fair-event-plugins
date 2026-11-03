import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectTests,
	compareInventories,
	parseTotal,
} from '../check-e2e-shards.mjs';

const report = {
	suites: [
		{
			title: 'a.spec.js',
			specs: [
				{
					title: 'top level',
					tests: [{ projectName: 'chromium' }],
				},
			],
			suites: [
				{
					title: 'group',
					specs: [
						{
							title: 'nested',
							tests: [{ projectName: 'chromium' }],
						},
					],
				},
			],
		},
	],
};

test('collects one key per test with its file, describe path and project', () => {
	assert.deepEqual(collectTests(report), [
		'a.spec.js › top level [chromium]',
		'a.spec.js › group › nested [chromium]',
	]);
});

test('a complete, disjoint split has no problems', () => {
	assert.deepEqual(
		compareInventories(['a', 'b', 'c'], [['a'], ['b', 'c']]),
		[]
	);
});

test('reports tests that no shard runs', () => {
	assert.deepEqual(compareInventories(['a', 'b'], [['a'], []]), [
		'Missing from every shard: b',
	]);
});

test('reports tests that run in more than one shard', () => {
	assert.deepEqual(compareInventories(['a', 'b'], [['a', 'b'], ['b']]), [
		'Runs in shards 1, 2: b',
	]);
});

test('reports shard tests the unsharded listing does not contain', () => {
	assert.deepEqual(compareInventories(['a'], [['a'], ['x']]), [
		'Listed by shard 2 but not by the unsharded run: x',
	]);
});

test('reports duplicate keys in the unsharded listing', () => {
	assert.equal(compareInventories(['a', 'a'], [['a']]).length, 1);
});

test('requires a positive integer shard count', () => {
	assert.equal(parseTotal(['--total=4']), 4);
	assert.throws(() => parseTotal([]));
	assert.throws(() => parseTotal(['--total=0']));
	assert.throws(() => parseTotal(['--total=two']));
});
