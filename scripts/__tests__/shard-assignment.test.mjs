import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
	assignShards,
	describeAssignment,
	fallbackWeight,
	listCommand,
	parseShard,
	planSuite,
	reportFiles,
	testListContent,
	writeTestLists,
} from '../shard-assignment.mjs';

const execFileAsync = promisify(execFile);
const fixture = join(
	dirname(fileURLToPath(import.meta.url)),
	'fixtures',
	'test-list'
);

const files = (...ids) => ids.map((id) => ({ id, listPath: id }));
const ids = (shards) => shards.map((shard) => shard.map((file) => file.id));

test('longest files go first, each to the currently lightest shard', () => {
	const weights = {
		a: { seconds: 10 },
		b: { seconds: 70 },
		c: { seconds: 30 },
		d: { seconds: 40 },
		e: { seconds: 20 },
	};
	const result = assignShards(files('a', 'b', 'c', 'd', 'e'), weights, 2);
	// b(70) → 1; d(40) → 2; c(30) → 2 (70); e(20) → 1 (90); a(10) → 2 (80).
	// Inside a shard the files keep discovery order.
	assert.deepEqual(ids(result.shards), [
		['b', 'e'],
		['a', 'c', 'd'],
	]);
	assert.deepEqual(result.loads, [90, 80]);
});

test('ties keep discovery order and go to the lowest-numbered shard', () => {
	const weights = Object.fromEntries(
		['a', 'b', 'c', 'd', 'e'].map((id) => [id, { seconds: 5 }])
	);
	const result = assignShards(files('a', 'b', 'c', 'd', 'e'), weights, 3);
	assert.deepEqual(ids(result.shards), [['a', 'd'], ['b', 'e'], ['c']]);
});

test('the same inventory and timings always give the same assignment', () => {
	const weights = { a: { seconds: 3 }, b: { seconds: 3 }, c: { seconds: 9 } };
	const first = assignShards(files('a', 'b', 'c', 'x'), weights, 2);
	const second = assignShards(files('a', 'b', 'c', 'x'), { ...weights }, 2);
	assert.deepEqual(ids(first.shards), ids(second.shards));
});

test('a file without timing data weighs the median and is reported', () => {
	const weights = {
		a: { seconds: 10 },
		b: { seconds: 20 },
		c: { seconds: 60 },
	};
	assert.equal(fallbackWeight(weights), 20);
	assert.equal(fallbackWeight({ a: { seconds: 1 }, b: { seconds: 3 } }), 2);
	assert.equal(fallbackWeight({}), 1);
	const result = assignShards(files('a', 'new', 'b', 'c'), weights, 2);
	assert.deepEqual(result.fallback, ['new']);
	assert.deepEqual(result.loads, [60, 50]);
	assert.ok(result.shards.flat().some((file) => file.id === 'new'));
});

test('stale timing entries are reported but never exclude a listed file', () => {
	const result = assignShards(
		files('a', 'b'),
		{
			a: { seconds: 1 },
			gone: { seconds: 99 },
			'also-gone': { seconds: 1 },
		},
		2
	);
	assert.deepEqual(result.stale, ['also-gone', 'gone']);
	assert.deepEqual(ids(result.shards).flat().sort(), ['a', 'b']);
	assert.match(describeAssignment(result).at(-1), /Stale timing entries/);
});

test('every file lands in exactly one shard, and a shard may be empty', () => {
	const result = assignShards(files('a', 'b'), {}, 4);
	assert.deepEqual(ids(result.shards), [['a'], ['b'], [], []]);
	assert.throws(() => assignShards(files('a', 'a'), {}, 2), /listed twice/);
});

test('API files of all workspaces are balanced together', () => {
	const api = [
		{ id: 'big/one.api.spec.js', workspace: 'big' },
		{ id: 'small/a.api.spec.js', workspace: 'small' },
		{ id: 'small/b.api.spec.js', workspace: 'small' },
		{ id: 'small/c.api.spec.js', workspace: 'small' },
	];
	const weights = {
		'big/one.api.spec.js': { seconds: 300 },
		'small/a.api.spec.js': { seconds: 100 },
		'small/b.api.spec.js': { seconds: 100 },
		'small/c.api.spec.js': { seconds: 100 },
	};
	const result = assignShards(api, weights, 2);
	assert.deepEqual(ids(result.shards), [
		['big/one.api.spec.js'],
		['small/a.api.spec.js', 'small/b.api.spec.js', 'small/c.api.spec.js'],
	]);
});

test('report files are named from the repository root, listed from rootDir', () => {
	const root = {
		config: {
			configFile: '/ci/repo/playwright.config.js',
			rootDir: '/ci/repo/e2e',
		},
		suites: [{ file: 'smoke.spec.js' }, { file: 'user-flows/a.spec.js' }],
	};
	assert.deepEqual(reportFiles(root), [
		{
			id: 'e2e/smoke.spec.js',
			listPath: 'smoke.spec.js',
			workspace: undefined,
		},
		{
			id: 'e2e/user-flows/a.spec.js',
			listPath: 'user-flows/a.spec.js',
			workspace: undefined,
		},
	]);
	const workspace = {
		config: {
			configFile: '/elsewhere/fair-events/playwright.config.js',
			rootDir: '/elsewhere/fair-events',
		},
		suites: [{ file: 'src/API/__tests__/A.api.spec.js' }],
	};
	assert.deepEqual(reportFiles(workspace, 'fair-events'), [
		{
			id: 'fair-events/src/API/__tests__/A.api.spec.js',
			listPath: 'src/API/__tests__/A.api.spec.js',
			workspace: 'fair-events',
		},
	]);
});

test('listing uses the root config for E2E and each workspace script for API', () => {
	assert.deepEqual(listCommand('e2e', undefined, ['--test-list=x']), [
		'npx',
		[
			'playwright',
			'test',
			'--config=playwright.config.js',
			'--list',
			'--reporter=json',
			'--test-list=x',
		],
	]);
	assert.deepEqual(listCommand('api', 'fair-form'), [
		'npm',
		[
			'run',
			'test:api',
			'--silent',
			'--workspace=fair-form',
			'--',
			'--list',
			'--reporter=json',
		],
	]);
});

test('planning lists every API workspace in order and assigns globally', async () => {
	const listed = [];
	const report = (workspace, names) => ({
		config: {
			configFile: `/r/${workspace}/playwright.config.js`,
			rootDir: `/r/${workspace}`,
		},
		suites: names.map((file) => ({ file })),
	});
	const { files: all, assignment } = await planSuite({
		rootDirectory: '/r',
		suite: 'api',
		workspaces: ['one', 'two'],
		total: 2,
		// one/a.js has no entry and weighs the median, 30.
		weights: { 'two/b.js': { seconds: 50 }, gone: { seconds: 10 } },
		list: async (root, suite, workspace) => {
			listed.push([root, suite, workspace]);
			return report(workspace, workspace === 'one' ? ['a.js'] : ['b.js']);
		},
	});
	assert.deepEqual(listed, [
		['/r', 'api', 'one'],
		['/r', 'api', 'two'],
	]);
	assert.deepEqual(
		all.map((file) => file.id),
		['one/a.js', 'two/b.js']
	);
	assert.deepEqual(ids(assignment.shards), [['two/b.js'], ['one/a.js']]);
});

test('test lists are written per workspace, with no entry for an empty one', async () => {
	const lists = await writeTestLists([
		{ workspace: 'one', listPath: 'src/a.js' },
		{ workspace: 'two', listPath: 'src/b.js' },
		{ workspace: 'one', listPath: 'src/c.js' },
	]);
	try {
		assert.deepEqual([...lists.keys()], ['one', 'two']);
		assert.equal(
			await readFile(lists.get('one'), 'utf8'),
			'src/a.js\nsrc/c.js\n'
		);
		assert.equal(testListContent([]), '');
	} finally {
		await rm(dirname(lists.get('one')), { recursive: true, force: true });
	}
});

test('a test list selects exactly the named files, not look-alike paths', async () => {
	const lists = await writeTestLists([
		{ workspace: undefined, listPath: 'a.spec.mjs' },
	]);
	try {
		const { stdout } = await execFileAsync(
			'npx',
			[
				'playwright',
				'test',
				`--config=${join(fixture, 'playwright.config.mjs')}`,
				'--list',
				'--reporter=json',
				`--test-list=${lists.get(undefined)}`,
			],
			{ cwd: fixture }
		);
		const report = JSON.parse(stdout);
		assert.deepEqual(
			report.suites.map((suite) => suite.file),
			['a.spec.mjs']
		);
	} finally {
		await rm(dirname(lists.get(undefined)), {
			recursive: true,
			force: true,
		});
	}
});

test('shard notation is validated', () => {
	assert.deepEqual(parseShard('2/4'), { current: 2, total: 4 });
	for (const value of ['0/4', '5/4', '1', 'a/b', undefined]) {
		assert.throws(() => parseShard(value), /--shard/);
	}
});
