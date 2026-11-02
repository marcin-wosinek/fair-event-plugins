import assert from 'node:assert/strict';
import test from 'node:test';

import {
	aptFacts,
	imageVersion,
	installSection,
	observedState,
	parseArgs,
	parseAttempts,
	preparationSeconds,
	stats,
	summarise,
} from '../e2e-deps-benchmark.mjs';

const LOG = [
	'2026-11-02T12:13:32.0Z ##[group]Runner Image',
	'2026-11-02T12:13:32.0Z Image: ubuntu-26.04',
	'2026-11-02T12:13:32.0Z Version: 20261025.179.1',
	'2026-11-02T12:13:50.0Z ##[group]Run actions/cache@v6',
	'2026-11-02T12:13:50.0Z Need to get 9 MB of archives.',
	'2026-11-02T12:13:53.0Z ##[group]Run node scripts/e2e-system-deps.mjs install',
	'2026-11-02T12:13:53.1Z Need to get 0 B/21.9 MB of archives.',
	'2026-11-02T12:13:53.2Z Err:3 http://azure.archive.ubuntu.com/ubuntu resolute InRelease',
	'2026-11-02T12:14:09.0Z ##[group]Run echo done',
	'2026-11-02T12:14:09.0Z Fetched 1 MB in 1s (1 MB/s)',
].join('\n');

test('parseAttempts expands ranges and lists', () => {
	assert.deepEqual(parseAttempts('1-3', 9), [1, 2, 3]);
	assert.deepEqual(parseAttempts('1,4', 9), [1, 4]);
	assert.deepEqual(parseAttempts('2', 9), [2]);
	assert.deepEqual(parseAttempts(undefined, 3), [1, 2, 3]);
});

test('parseArgs reads labelled runs', () => {
	assert.deepEqual(
		parseArgs(['baseline=123:1-5', 'candidate=456', '--json']),
		{
			groups: [
				{ label: 'baseline', run: '123', attempts: '1-5' },
				{ label: 'candidate', run: '456', attempts: undefined },
			],
			json: true,
		}
	);
	assert.throws(() => parseArgs(['nope']), /Unrecognised/);
});

test('preparationSeconds sums only preparation steps', () => {
	const step = (name, start, end) => ({
		name,
		started_at: `2026-11-02T12:00:${start}Z`,
		completed_at: `2026-11-02T12:00:${end}Z`,
	});
	assert.equal(
		preparationSeconds({
			steps: [
				step('Install Playwright browser', '00', '05'),
				step('Restore system dependency archives', '05', '06'),
				step('Install Playwright system dependencies', '06', '16'),
				step('Prepare environment and run E2E tests', '16', '59'),
			],
		}),
		16
	);
});

test('installSection and aptFacts read only the install step', () => {
	const section = installSection(LOG);
	assert.match(
		section,
		/^##\[group\]Run node scripts\/e2e-system-deps\.mjs install/
	);
	assert.deepEqual(aptFacts(section), {
		needToGet: 'Need to get 0 B/21.9 MB of archives.',
		fetched: null,
		problems: 1,
		attempts: 1,
	});
	assert.equal(imageVersion(LOG), 'ubuntu-26.04 20261025.179.1');
});

test('observedState distinguishes fresh, reuse, partial and recovered', () => {
	const facts = (needToGet, attempts = 1) => ({ needToGet, attempts });
	assert.equal(
		observedState(facts('Need to get 21.9 MB of archives.')),
		'fresh'
	);
	assert.equal(
		observedState(facts('Need to get 0 B/21.9 MB of archives.')),
		'reuse'
	);
	assert.equal(
		observedState(facts('Need to get 917 kB/21.9 MB of archives.')),
		'partial-reuse'
	);
	assert.equal(
		observedState(facts('Need to get 1 MB of archives.', 2)),
		'recovered'
	);
	assert.equal(observedState(facts(null)), 'unknown');
});

test('stats reports median and range', () => {
	assert.deepEqual(stats([5, 1, 3]), { n: 3, median: 3, min: 1, max: 5 });
	assert.deepEqual(stats([4, 1, 3, 2]), {
		n: 4,
		median: 2.5,
		min: 1,
		max: 4,
	});
	assert.deepEqual(stats([]), { n: 0, median: null, min: null, max: null });
});

test('summarise groups by label and state and keeps failures visible', () => {
	const summary = summarise([
		{
			label: 'b',
			state: 'fresh',
			preparationSeconds: 10,
			jobSeconds: 600,
			problems: 1,
			attempts: 1,
			conclusion: 'success',
		},
		{
			label: 'b',
			state: 'fresh',
			preparationSeconds: 20,
			jobSeconds: 1200,
			problems: 0,
			attempts: 1,
			conclusion: 'failure',
		},
		{
			label: 'c',
			state: 'reuse',
			preparationSeconds: 5,
			jobSeconds: 600,
			problems: 0,
			attempts: 1,
			conclusion: 'success',
		},
	]);
	assert.deepEqual(
		summary.map((s) => [
			s.group,
			s.preparation.median,
			s.runnerMinutes,
			s.problems,
			s.failed,
		]),
		[
			['b/fresh', 15, 30, 1, 1],
			['c/reuse', 5, 10, 0, 0],
		]
	);
});
