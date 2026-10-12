import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	CATEGORY,
	CONCURRENCY,
	UsageError,
	branchApiUrl,
	collectStatus,
	exitCodeFor,
	formatText,
	loadPublishedPlugins,
	matchesLocale,
	parseTranslationSets,
	projectApiUrl,
	selectPlugins,
	validateRegistry,
} from '../translation/lib/wporg-status.js';
import { parseArgs, run } from '../translation/wporg-status.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../..');

const EVENTS = { name: 'fair-events', slug: 'fair-events' };
const TIMETABLE = { name: 'fair-timetable', slug: 'fair-timetable' };

/** A translation set shaped like the GlotPress branch API returns it. */
function remoteSet(overrides = {}) {
	return {
		name: 'Spanish (Spain)',
		slug: 'default',
		locale: 'es',
		wp_locale: 'es_ES',
		current_count: 936,
		waiting_count: 4,
		fuzzy_count: 1,
		untranslated_count: 378,
		all_count: 1314,
		percent_translated: 71,
		...overrides,
	};
}

const GERMAN = remoteSet({
	name: 'German',
	locale: 'de',
	wp_locale: 'de_DE',
});
const GERMAN_FORMAL = remoteSet({
	name: 'German (Formal)',
	slug: 'formal',
	locale: 'de',
	wp_locale: 'de_DE_formal',
});
const AFRIKAANS = remoteSet({
	name: 'Afrikaans',
	locale: 'af',
	wp_locale: 'af',
	current_count: 0,
	waiting_count: 0,
	fuzzy_count: 0,
	untranslated_count: 1314,
	percent_translated: 0,
});

function jsonResponse(data, status = 200, headers = {}) {
	return {
		status,
		headers: { get: (name) => headers[name.toLowerCase()] ?? null },
		text: async () =>
			typeof data === 'string' ? data : JSON.stringify(data),
	};
}

const sets = (...translationSets) =>
	jsonResponse({ translation_sets: translationSets, sub_projects: [] });
const notFound = () =>
	jsonResponse({ success: false, error: 'Not Found' }, 404);
const parentProject = () =>
	jsonResponse({ translation_sets: [], sub_projects: [{ slug: 'stable' }] });

/**
 * Fake fetch. Each route is a response, a thrown Error, or an array of
 * those consumed one per call (the last one repeats).
 */
function fakeFetch(routes) {
	const calls = [];
	const fetchImpl = async (url) => {
		calls.push(url);
		if (!(url in routes)) {
			throw new Error(`unexpected request: ${url}`);
		}
		const route = routes[url];
		const step = Array.isArray(route)
			? route.length > 1
				? route.shift()
				: route[0]
			: route;
		if (step instanceof Error) {
			throw step;
		}
		return step;
	};
	return { fetchImpl, calls };
}

function collect(routes, options = {}) {
	const { fetchImpl, calls } = fakeFetch(routes);
	const sleeps = [];
	return collectStatus({
		plugins: [EVENTS],
		branches: ['stable'],
		fetchImpl,
		sleep: async (ms) => {
			sleeps.push(ms);
		},
		now: () => new Date('2026-10-12T06:00:00.000Z'),
		...options,
	}).then((report) => ({ report, calls, sleeps }));
}

const stableUrl = branchApiUrl('fair-events', 'stable');
const devUrl = branchApiUrl('fair-events', 'dev');

test('validateRegistry accepts published plugin workspaces', () => {
	const problems = validateRegistry(
		{ plugins: { 'fair-events': 'fair-events' } },
		{ workspaces: ['fair-events'], hasMainFile: () => true }
	);
	assert.deepEqual(problems, []);
});

test('validateRegistry reports entries that are not publishable plugins', () => {
	const problems = validateRegistry(
		{
			plugins: {
				'fair-events-shared': 'fair-events-shared',
				'fair-gone': 'fair-gone',
				'fair-nomain': 'fair-nomain',
				'fair-badslug': 'Fair Bad',
				'fair-events': 'fair-events',
				'fair-copy': 'fair-events',
			},
		},
		{
			workspaces: [
				'fair-events-shared',
				'fair-nomain',
				'fair-badslug',
				'fair-events',
				'fair-copy',
			],
			hasMainFile: (workspace) => workspace !== 'fair-nomain',
		}
	);
	assert.equal(problems.length, 5);
	assert.match(problems[0], /fair-events-shared is not a plugin workspace/);
	assert.match(problems[1], /fair-gone is not a workspace/);
	assert.match(problems[2], /fair-nomain has no plugin main file/);
	assert.match(problems[3], /fair-badslug has an invalid/);
	assert.match(problems[4], /fair-copy and fair-events share/);
	assert.deepEqual(
		validateRegistry([], { workspaces: [], hasMainFile: () => true }),
		['registry must be an object with a "plugins" map']
	);
});

test('the committed registry is valid and excludes unpublished workspaces', async () => {
	const { plugins, workspaces } = await loadPublishedPlugins(rootDir);
	const names = plugins.map((plugin) => plugin.name);

	assert.ok(names.includes('fair-events'));
	assert.ok(!names.includes('fair-events-shared'));
	assert.ok(names.every((name) => workspaces.includes(name)));
	assert.ok(names.length < workspaces.length);
});

test('selectPlugins never broadens a plugin filter', () => {
	const plugins = [EVENTS, TIMETABLE];
	const workspaces = ['fair-events', 'fair-timetable', 'fair-audience'];

	assert.deepEqual(selectPlugins(plugins, workspaces, null), plugins);
	assert.deepEqual(selectPlugins(plugins, workspaces, 'fair-timetable'), [
		TIMETABLE,
	]);
	assert.throws(
		() => selectPlugins(plugins, workspaces, 'fair-audience'),
		(error) =>
			error instanceof UsageError &&
			/not in the published-plugin registry/.test(error.message)
	);
	assert.throws(
		() => selectPlugins(plugins, workspaces, 'fair-nope'),
		(error) =>
			error instanceof UsageError &&
			/Unknown plugin: fair-nope/.test(error.message)
	);
});

test('parseTranslationSets keeps zeros and marks absent metrics as null', () => {
	const [zero, absent] = parseTranslationSets({
		translation_sets: [
			AFRIKAANS,
			{ slug: 'default', locale: 'xx', waiting_count: null },
		],
	});

	assert.equal(zero.approved, 0);
	assert.equal(zero.waiting, 0);
	assert.equal(zero.percentApproved, 0);
	assert.equal(zero.untranslated, 1314);
	assert.deepEqual(absent, {
		locale: 'xx',
		wpLocale: null,
		variant: 'default',
		name: null,
		approved: null,
		waiting: null,
		fuzzy: null,
		untranslated: null,
		total: null,
		percentApproved: null,
	});
});

test('parseTranslationSets rejects malformed responses', () => {
	const malformed = [
		null,
		[],
		{ sub_projects: [] },
		{ translation_sets: {} },
		{ translation_sets: [null] },
		{ translation_sets: [remoteSet({ locale: undefined })] },
		{ translation_sets: [remoteSet({ slug: '' })] },
		{ translation_sets: [remoteSet({ wp_locale: 5 })] },
		{ translation_sets: [remoteSet({ current_count: '936' })] },
		{ translation_sets: [remoteSet({ waiting_count: -1 })] },
		{ translation_sets: [remoteSet({ fuzzy_count: 1.5 })] },
		{ translation_sets: [remoteSet({ percent_translated: '71' })] },
	];
	for (const data of malformed) {
		assert.throws(
			() => parseTranslationSets(data),
			(error) => error.category === CATEGORY.parse,
			JSON.stringify(data)
		);
	}
});

test('matchesLocale accepts GlotPress and WordPress locale identifiers', () => {
	const [german, formal] = parseTranslationSets({
		translation_sets: [GERMAN, GERMAN_FORMAL],
	});

	assert.equal(matchesLocale(german, null), true);
	assert.equal(matchesLocale(german, 'de'), true);
	assert.equal(matchesLocale(formal, 'de'), true);
	assert.equal(matchesLocale(german, 'de_DE'), true);
	assert.equal(matchesLocale(formal, 'de_DE'), false);
	assert.equal(matchesLocale(formal, 'de_de_formal'), true);
	assert.equal(matchesLocale(german, 'es'), false);
});

test('collectStatus reports every returned set and keeps branches separate', async () => {
	const { report, calls } = await collect(
		{
			[stableUrl]: sets(remoteSet(), GERMAN, GERMAN_FORMAL, AFRIKAANS),
			[devUrl]: sets(
				remoteSet({ current_count: 1439, percent_translated: 79 })
			),
		},
		{ branches: ['stable', 'dev'] }
	);

	assert.deepEqual(calls.sort(), [devUrl, stableUrl].sort());
	assert.equal(report.schemaVersion, 1);
	assert.equal(report.generatedAt, '2026-10-12T06:00:00.000Z');
	assert.deepEqual(report.errors, []);
	assert.deepEqual(
		report.results.map((row) => [row.branch, row.wpLocale, row.variant]),
		[
			['stable', 'es_ES', 'default'],
			['stable', 'de_DE', 'default'],
			['stable', 'de_DE_formal', 'formal'],
			['stable', 'af', 'default'],
			['dev', 'es_ES', 'default'],
		]
	);
	assert.deepEqual(report.results[0], {
		plugin: 'fair-events',
		slug: 'fair-events',
		branch: 'stable',
		locale: 'es',
		wpLocale: 'es_ES',
		variant: 'default',
		name: 'Spanish (Spain)',
		approved: 936,
		waiting: 4,
		fuzzy: 1,
		untranslated: 378,
		total: 1314,
		percentApproved: 71,
		url: 'https://translate.wordpress.org/projects/wp-plugins/fair-events/stable/es/default/',
		sourceUrl: stableUrl,
		retrievedAt: '2026-10-12T06:00:00.000Z',
	});
	assert.equal(report.results[4].approved, 1439);
	assert.equal(report.results[4].percentApproved, 79);
	assert.equal(report.results[2].url.endsWith('/stable/de/formal/'), true);
	assert.deepEqual(
		report.responses.map((response) => [
			response.branch,
			response.setCount,
		]),
		[
			['stable', 4],
			['dev', 1],
		]
	);
});

test('collectStatus filters by a locale that has no local catalog', async () => {
	const routes = {
		[stableUrl]: sets(remoteSet(), GERMAN, GERMAN_FORMAL, AFRIKAANS),
	};

	const byGlotPress = await collect(routes, { locale: 'af' });
	assert.deepEqual(
		byGlotPress.report.results.map((row) => row.wpLocale),
		['af']
	);
	assert.equal(byGlotPress.report.responses[0].matchedCount, 1);

	const byWpLocale = await collect(routes, { locale: 'de_DE_formal' });
	assert.deepEqual(
		byWpLocale.report.results.map((row) => row.variant),
		['formal']
	);
	assert.equal(exitCodeFor(byWpLocale.report), 0);
});

test('a requested locale without a set is missing, an empty response is not', async () => {
	const missing = await collect(
		{ [stableUrl]: sets(remoteSet()) },
		{ locale: 'pl_PL' }
	);
	assert.deepEqual(missing.report.results, []);
	assert.equal(missing.report.errors.length, 1);
	assert.equal(missing.report.errors[0].category, CATEGORY.missingLocale);
	assert.equal(missing.report.errors[0].locale, 'pl_PL');
	assert.equal(exitCodeFor(missing.report), 1);

	const empty = await collect({ [stableUrl]: sets() });
	assert.deepEqual(empty.report.errors, []);
	assert.deepEqual(empty.report.results, []);
	assert.equal(empty.report.responses[0].setCount, 0);
	assert.equal(exitCodeFor(empty.report), 0);
	assert.match(formatText(empty.report), /No translation sets returned/);
});

test('a branch 404 is a missing project when the parent is missing too', async () => {
	const { report, calls } = await collect(
		{
			[stableUrl]: notFound(),
			[devUrl]: notFound(),
			[projectApiUrl('fair-events')]: notFound(),
		},
		{ branches: ['stable', 'dev'] }
	);

	assert.deepEqual(
		report.errors.map((error) => error.category),
		[CATEGORY.missingProject, CATEGORY.missingProject]
	);
	assert.equal(report.errors[0].url, projectApiUrl('fair-events'));
	// The parent project is looked up once for both branches.
	assert.equal(
		calls.filter((url) => url === projectApiUrl('fair-events')).length,
		1
	);
	assert.equal(exitCodeFor(report), 1);
});

test('a branch 404 is a missing branch when the parent project exists', async () => {
	const { report } = await collect(
		{
			[stableUrl]: sets(remoteSet()),
			[devUrl]: notFound(),
			[projectApiUrl('fair-events')]: parentProject(),
		},
		{ branches: ['stable', 'dev'] }
	);

	assert.equal(report.results.length, 1);
	assert.equal(report.errors.length, 1);
	assert.equal(report.errors[0].category, CATEGORY.missingBranch);
	assert.equal(report.errors[0].branch, 'dev');
});

test('a failed missing-project diagnosis stays a failure, not an absence', async () => {
	const network = await collect({
		[stableUrl]: notFound(),
		[projectApiUrl('fair-events')]: new Error('socket hang up'),
	});
	assert.equal(network.report.errors[0].category, CATEGORY.network);
	assert.match(network.report.errors[0].message, /Could not tell/);

	const parse = await collect({
		[stableUrl]: notFound(),
		[projectApiUrl('fair-events')]: jsonResponse({ unexpected: true }),
	});
	assert.equal(parse.report.errors[0].category, CATEGORY.parse);
});

test('transient failures are retried at most twice with bounded backoff', async () => {
	const recovered = await collect({
		[stableUrl]: [
			jsonResponse('busy', 503),
			jsonResponse('slow down', 429, { 'retry-after': '3600' }),
			sets(remoteSet()),
		],
	});
	assert.equal(recovered.calls.length, 3);
	assert.deepEqual(recovered.sleeps, [500, 8000]);
	assert.deepEqual(recovered.report.errors, []);
	assert.equal(recovered.report.results.length, 1);

	const exhausted = await collect({ [stableUrl]: jsonResponse('down', 500) });
	assert.equal(exhausted.calls.length, 3);
	assert.equal(exhausted.report.errors[0].category, CATEGORY.http);
	assert.equal(exhausted.report.errors[0].httpStatus, 500);
	assert.equal(exhausted.report.errors[0].attempts, 3);

	const offline = await collect({ [stableUrl]: new Error('ENOTFOUND') });
	assert.equal(offline.calls.length, 3);
	assert.equal(offline.report.errors[0].category, CATEGORY.network);

	const timeout = new Error('aborted');
	timeout.name = 'TimeoutError';
	const timedOut = await collect({ [stableUrl]: timeout });
	assert.match(timedOut.report.errors[0].message, /Timed out after 20s/);
});

test('permanent failures and malformed responses are not retried', async () => {
	const forbidden = await collect({ [stableUrl]: jsonResponse('no', 403) });
	assert.equal(forbidden.calls.length, 1);
	assert.equal(forbidden.report.errors[0].category, CATEGORY.http);

	const html = await collect({ [stableUrl]: jsonResponse('<html>') });
	assert.equal(html.calls.length, 1);
	assert.equal(html.report.errors[0].category, CATEGORY.parse);

	const wrongShape = await collect({
		[stableUrl]: sets(remoteSet({ current_count: 'many' })),
	});
	assert.equal(wrongShape.report.errors[0].category, CATEGORY.parse);
	assert.deepEqual(wrongShape.report.results, []);
});

test('partial failures keep successful rows and exit nonzero', async () => {
	const { report } = await collect(
		{
			[stableUrl]: sets(remoteSet(), AFRIKAANS),
			[branchApiUrl('fair-timetable', 'stable')]: new Error('ECONNRESET'),
		},
		{ plugins: [EVENTS, TIMETABLE] }
	);

	assert.equal(report.results.length, 2);
	assert.equal(report.errors.length, 1);
	assert.deepEqual(
		{
			category: report.errors[0].category,
			plugin: report.errors[0].plugin,
			branch: report.errors[0].branch,
			url: report.errors[0].url,
		},
		{
			category: CATEGORY.network,
			plugin: 'fair-timetable',
			branch: 'stable',
			url: branchApiUrl('fair-timetable', 'stable'),
		}
	);
	assert.equal(exitCodeFor(report), 1);

	const text = formatText(report);
	assert.match(text, /Failed requests \(1\)/);
	assert.match(text, /\[network\] fair-timetable stable/);
});

test('requests share one bounded concurrency limit', async () => {
	const plugins = ['a', 'b', 'c', 'd'].map((letter) => ({
		name: `fair-${letter}`,
		slug: `fair-${letter}`,
	}));
	let active = 0;
	let peak = 0;
	const report = await collectStatus({
		plugins,
		branches: ['stable', 'dev'],
		fetchImpl: async () => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active--;
			return sets(remoteSet());
		},
	});

	assert.equal(report.results.length, 8);
	assert.equal(peak, CONCURRENCY);
});

test('formatText marks unavailable metrics and keeps real zeros', async () => {
	const { report } = await collect({
		[stableUrl]: sets(
			AFRIKAANS,
			remoteSet({
				percent_translated: undefined,
				waiting_count: undefined,
			})
		),
	});
	const lines = formatText(report).split('\n');
	const afrikaans = lines.find((line) => line.startsWith('af'));
	const spanish = lines.find((line) => line.startsWith('es'));

	assert.match(afrikaans, /^af\s+af\s+default\s+0%\s+0\s+0\s+0\s+1314$/);
	assert.match(
		spanish,
		/^es\s+es_ES\s+default\s+unavailable\s+936\s+unavailable\s+1\s+378$/
	);
	assert.match(
		formatText(report),
		/translate\.wordpress\.org\/projects\/wp-plugins\/fair-events\/stable\//
	);
});

test('parseArgs reads the supported options and rejects the rest', () => {
	assert.deepEqual(parseArgs([]), {
		plugin: null,
		locale: null,
		set: 'both',
		json: false,
		output: null,
	});
	assert.deepEqual(
		parseArgs([
			'--plugin=fair-events',
			'--locale=es_ES',
			'--set=dev',
			'--json',
			'--output=report.json',
		]),
		{
			plugin: 'fair-events',
			locale: 'es_ES',
			set: 'dev',
			json: true,
			output: 'report.json',
		}
	);
	assert.throws(() => parseArgs(['--set=trunk']), UsageError);
	assert.throws(() => parseArgs(['--plugin=']), UsageError);
	assert.throws(() => parseArgs(['--bogus']), UsageError);
});

/** Collects what the CLI writes to a stream. */
function sink() {
	const chunks = [];
	return {
		write: (chunk) => chunks.push(chunk),
		text: () => chunks.join(''),
	};
}

/** Content hashes of every file in every workspace's languages directory. */
async function catalogSnapshot() {
	const { workspaces } = JSON.parse(
		await readFile(join(rootDir, 'package.json'), 'utf8')
	);
	const snapshot = {};
	for (const workspace of workspaces) {
		const dir = join(rootDir, workspace, 'languages');
		const entries = await readdir(dir, {
			recursive: true,
			withFileTypes: true,
		}).catch(() => []);
		for (const entry of entries.filter((item) => item.isFile())) {
			const file = join(entry.parentPath, entry.name);
			snapshot[file] = createHash('sha1')
				.update(await readFile(file))
				.digest('hex');
		}
	}
	return snapshot;
}

test('the CLI emits JSON on stdout and leaves catalogs unchanged', async () => {
	const before = await catalogSnapshot();
	assert.ok(Object.keys(before).length > 0);

	const outputDir = await mkdtemp(join(tmpdir(), 'wporg-status-'));
	const outputFile = join(outputDir, 'report.json');
	const stdout = sink();
	const stderr = sink();
	const { fetchImpl, calls } = fakeFetch({
		[stableUrl]: sets(remoteSet(), AFRIKAANS),
		[devUrl]: new Error('ECONNRESET'),
	});

	try {
		const code = await run(
			['--plugin=fair-events', '--json', `--output=${outputFile}`],
			{ stdout, stderr, fetchImpl, sleep: async () => {} }
		);
		const report = JSON.parse(stdout.text());

		assert.equal(code, 1);
		assert.equal(calls.filter((url) => url === devUrl).length, 3);
		assert.deepEqual(report.filters, {
			plugins: ['fair-events'],
			branches: ['stable', 'dev'],
			locale: null,
		});
		assert.equal(report.results.length, 2);
		assert.ok(!Number.isNaN(Date.parse(report.generatedAt)));
		assert.ok(!Number.isNaN(Date.parse(report.results[0].retrievedAt)));
		assert.match(
			report.results[0].url,
			/^https:\/\/translate\.wordpress\.org\/projects\//
		);
		assert.equal(report.results[0].sourceUrl, stableUrl);
		assert.equal(report.errors[0].category, CATEGORY.network);
		assert.match(stderr.text(), /\[network\] fair-events dev/);
		assert.deepEqual(
			JSON.parse(await readFile(outputFile, 'utf8')),
			report
		);
	} finally {
		await rm(outputDir, { recursive: true, force: true });
	}

	assert.deepEqual(await catalogSnapshot(), before);
});

test('the CLI rejects bad filters before making any request', async () => {
	for (const args of [
		['--plugin=fair-audience'],
		['--plugin=fair-nope'],
		['--set=trunk'],
	]) {
		const stderr = sink();
		const { fetchImpl, calls } = fakeFetch({});
		const code = await run(args, { stdout: sink(), stderr, fetchImpl });

		assert.equal(code, 2, args.join(' '));
		assert.deepEqual(calls, []);
		assert.match(stderr.text(), /Error:/);
	}
});
