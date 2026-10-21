#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Performance measurement harness for scripts/__tests__/performance-runner.test.mjs
 * and `npm run performance`. Follows the lifecycle and process-management
 * patterns of scripts/api-test-runner.mjs: it owns the isolated wp-env
 * `tests` instance (build, start, provision, stop) unless `--reuse` is
 * passed, and always restores the plugin activation state it found and
 * removes its synthetic fixtures, even on failure or interruption.
 *
 * See PERFORMANCE.md for the environment, fixtures, activation matrix, and
 * how to read the report.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { createProcessExecutor, resolveTestsPort } from './api-test-runner.mjs';

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

export function parseArguments(args) {
	let reuse = false;
	let samples = 5;
	let scenario;
	let outFile;
	let jsonOut;
	let eventsListScaling = false;
	let sizes;

	for (const argument of args) {
		if (argument === '--reuse') {
			reuse = true;
		} else if (argument.startsWith('--samples=')) {
			samples = Number(argument.slice('--samples='.length));
		} else if (argument.startsWith('--scenario=')) {
			scenario = argument.slice('--scenario='.length);
		} else if (argument.startsWith('--out=')) {
			outFile = argument.slice('--out='.length);
		} else if (argument.startsWith('--json-out=')) {
			jsonOut = argument.slice('--json-out='.length);
		} else if (argument === '--events-list-scaling') {
			eventsListScaling = true;
		} else if (argument.startsWith('--sizes=')) {
			sizes = argument
				.slice('--sizes='.length)
				.split(',')
				.map((size) => (size.trim() === '' ? NaN : Number(size)));
		} else {
			throw new Error(`Unknown argument "${argument}".`);
		}
	}

	if (!Number.isInteger(samples) || samples < 1) {
		throw new Error('The --samples option must be a positive integer.');
	}

	if (sizes !== undefined) {
		if (!eventsListScaling) {
			throw new Error(
				'The --sizes option applies only with --events-list-scaling.'
			);
		}
		const valid =
			sizes.length > 0 &&
			sizes.every(
				(size, index) =>
					Number.isInteger(size) &&
					size >= 0 &&
					size !== 1 &&
					(index === 0 || size > sizes[index - 1])
			);
		if (!valid) {
			throw new Error(
				'The --sizes option must list increasing integers of 0 or 2 and more, e.g. --sizes=0,10,50,200.'
			);
		}
	}

	if (eventsListScaling && scenario) {
		throw new Error(
			'The --scenario option does not apply with --events-list-scaling, which measures fair-events alone.'
		);
	}

	return {
		reuse,
		samples,
		scenario,
		outFile,
		jsonOut,
		eventsListScaling,
		sizes,
	};
}

/** Parse the docblock header of a WordPress plugin entry file. */
export function parsePluginHeader(contents) {
	const nameMatch = /Plugin Name:\s*(.+)/.exec(contents);
	const requiresMatch = /Requires Plugins:\s*(.+)/.exec(contents);

	return {
		name: nameMatch ? nameMatch[1].trim() : null,
		requiresPlugins: requiresMatch
			? requiresMatch[1]
					.split(',')
					.map((slug) => slug.trim())
					.filter(Boolean)
			: [],
	};
}

/**
 * Discover deployable Fair Event plugins from the authoritative root
 * workspace list. A workspace without a `<workspace>/<workspace>.php` entry
 * file (e.g. fair-events-shared) is not a plugin and is skipped.
 */
export async function loadPluginCatalog(
	rootDirectory,
	{ readFile: read = readFile } = {}
) {
	const rootPackage = JSON.parse(
		await read(`${rootDirectory}/package.json`, 'utf8')
	);
	const plugins = [];

	for (const workspace of rootPackage.workspaces) {
		let contents;
		try {
			contents = await read(
				`${rootDirectory}/${workspace}/${workspace}.php`,
				'utf8'
			);
		} catch {
			continue;
		}
		const header = parsePluginHeader(contents);
		plugins.push({
			slug: workspace,
			name: header.name ?? workspace,
			requiresPlugins: header.requiresPlugins,
			experimental: workspace.endsWith('-experimental'),
		});
	}

	return plugins;
}

/**
 * Build the comparison matrix described in PERFORMANCE.md: a WordPress-only
 * baseline, every standalone plugin alone, every dependency-bound plugin
 * together with its required base plugin, the production stack, and the
 * production stack plus experimental plugins.
 */
export function buildComparisonMatrix(plugins) {
	const standalone = plugins.filter((p) => p.requiresPlugins.length === 0);
	const dependent = plugins.filter((p) => p.requiresPlugins.length > 0);
	const production = plugins.filter((p) => !p.experimental);
	const experimental = plugins.filter((p) => p.experimental);

	const matrix = [{ name: 'wordpress-only', plugins: [] }];

	for (const plugin of standalone) {
		matrix.push({ name: plugin.slug, plugins: [plugin.slug] });
	}

	for (const plugin of dependent) {
		matrix.push({
			name: `${plugin.slug}+deps`,
			plugins: [...new Set([...plugin.requiresPlugins, plugin.slug])],
		});
	}

	matrix.push({
		name: 'production-stack',
		plugins: production.map((p) => p.slug),
	});

	matrix.push({
		name: 'production-stack+experimental',
		plugins: [...production, ...experimental].map((p) => p.slug),
	});

	return matrix;
}

export function median(values) {
	if (!values.length) {
		return null;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[mid - 1] + sorted[mid]) / 2
		: sorted[mid];
}

/** Discard warm-up samples (JIT/opcache warm-up) and report medians. */
export function aggregateSamples(samples, { warmup = 1 } = {}) {
	const warm = samples.slice(warmup);
	if (!warm.length) {
		throw new Error(
			'aggregateSamples requires at least one sample after warm-up.'
		);
	}
	return {
		durationMs: median(warm.map((s) => s.durationMs)),
		memoryBytes: median(warm.map((s) => s.memoryBytes)),
		queryCount: median(warm.map((s) => s.queryCount)),
		sampleCount: warm.length,
	};
}

/** Compare every non-baseline scenario's result to the baseline scenario, per page. */
export function compareToBaseline(results, baselineScenario) {
	const comparisons = [];

	for (const result of results) {
		if (result.scenario === baselineScenario) {
			continue;
		}
		const baseline = results.find(
			(r) => r.scenario === baselineScenario && r.page === result.page
		);
		if (!baseline) {
			continue;
		}
		comparisons.push({
			scenario: result.scenario,
			page: result.page,
			deltaDurationMs:
				result.metrics.durationMs - baseline.metrics.durationMs,
			deltaQueryCount:
				result.metrics.queryCount - baseline.metrics.queryCount,
			deltaMemoryBytes:
				result.metrics.memoryBytes - baseline.metrics.memoryBytes,
			deltaRequestCount:
				result.frontend.requestCount - baseline.frontend.requestCount,
			deltaTransferBytes:
				result.frontend.transferBytes - baseline.frontend.transferBytes,
		});
	}

	return comparisons;
}

function formatDelta(value, unit = '') {
	const sign = value > 0 ? '+' : '';
	const rounded = unit ? value.toFixed(1) : Math.round(value);
	return `${sign}${rounded}${unit ? ` ${unit}` : ''}`;
}

/**
 * Render the measured results and their baseline deltas as a markdown report.
 * A scenario/page pair listed in `skipped` gets an `n/a` row, with the reason
 * under the table, so a page that was deliberately not measured never reads
 * as a missing or cheap result.
 */
export function formatMarkdownReport({
	results,
	comparisons,
	skipped = [],
	generatedAt = new Date().toISOString(),
}) {
	const rows = [...results, ...skipped];
	const pages = [...new Set(rows.map((r) => r.page))];
	const scenarios = [...new Set(rows.map((r) => r.scenario))];
	const lines = [
		'# Performance audit results',
		'',
		`Generated: ${generatedAt}`,
		'',
	];

	for (const page of pages) {
		lines.push(`## ${page} page`, '');
		lines.push(
			'| Scenario | Duration (ms) | Δ Duration | Queries | Δ Queries | Peak memory (MB) | Δ Memory (KB) | Requests | Δ Requests | Transfer (KB) | Δ Transfer (KB) |'
		);
		lines.push(
			'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
		);
		const reasons = new Set();
		for (const scenario of scenarios) {
			const result = results.find(
				(r) => r.page === page && r.scenario === scenario
			);
			if (!result) {
				const skip = skipped.find(
					(s) => s.page === page && s.scenario === scenario
				);
				if (skip) {
					reasons.add(skip.reason);
					lines.push(
						`| ${scenario} | n/a | — | n/a | — | n/a | — | n/a | — | n/a | — |`
					);
				}
				continue;
			}
			const comparison = comparisons.find(
				(c) => c.page === page && c.scenario === scenario
			);
			lines.push(
				`| ${scenario} | ${result.metrics.durationMs.toFixed(1)} | ${
					comparison
						? formatDelta(comparison.deltaDurationMs, 'ms')
						: '—'
				} | ${result.metrics.queryCount} | ${
					comparison ? formatDelta(comparison.deltaQueryCount) : '—'
				} | ${(result.metrics.memoryBytes / (1024 * 1024)).toFixed(
					2
				)} | ${
					comparison
						? formatDelta(comparison.deltaMemoryBytes / 1024, 'KB')
						: '—'
				} | ${result.frontend.requestCount} | ${
					comparison ? formatDelta(comparison.deltaRequestCount) : '—'
				} | ${(result.frontend.transferBytes / 1024).toFixed(1)} | ${
					comparison
						? formatDelta(
								comparison.deltaTransferBytes / 1024,
								'KB'
							)
						: '—'
				} |`
			);
		}
		lines.push('');
		for (const reason of reasons) {
			lines.push(`n/a: ${reason}`, '');
		}
	}

	return lines.join('\n');
}

/**
 * Render the measured results and their baseline deltas as JSON, for
 * scripts/performance-history.mjs and any future comparison tooling — the
 * markdown report is for reading, this is for parsing. `results` holds only
 * measured pages; scenario/page pairs that were not measured are listed in
 * `skipped` with their reason.
 */
export function formatJsonReport({
	results,
	comparisons,
	skipped = [],
	generatedAt = new Date().toISOString(),
}) {
	return JSON.stringify(
		{ generatedAt, results, comparisons, skipped },
		null,
		2
	);
}

const SEED_SCRIPT =
	'wp-content/mu-plugins/scripts/seed-performance-fixtures.php';
const CLEANUP_SCRIPT =
	'wp-content/mu-plugins/scripts/cleanup-performance-fixtures.php';

/**
 * Post meta marking a post as owned by the audit. Written in the same insert
 * as the post, so cleanup-performance-fixtures.php finds every fixture even
 * when the run that created it never reached its own cleanup.
 */
export const FIXTURE_MARKER_META = '_fair_performance_fixture';

/**
 * Event fixtures, seeded by seed-performance-fixtures.php. The counts are
 * fixed so runs stay comparable over time; `measuredOccurrence` is the
 * 1-based position in the series (the master is 1) of the generated
 * occurrence whose page is measured.
 */
export const EVENT_FIXTURES = {
	requiredPlugin: 'fair-events',
	config: { occurrences: 48, measuredOccurrence: 24, options: 16 },
	pages: [
		'recurring-master',
		'recurring-occurrence',
		'event-options',
		'listings',
	],
};

/** Event pages are measured only where the plugin that renders them is active. */
export function scenarioMeasuresEventPages(scenario, eventFixtures) {
	return scenario.plugins.includes(eventFixtures.requiredPlugin);
}

/** Read the `PERF_SEED:{json}` line seed-performance-fixtures.php prints. */
export function parseSeedOutput(stdout) {
	const line = stdout
		.split('\n')
		.find((candidate) => candidate.startsWith('PERF_SEED:'));
	if (!line) {
		return null;
	}
	try {
		return JSON.parse(line.slice('PERF_SEED:'.length));
	} catch {
		return null;
	}
}

/**
 * Check that seeding produced what the audit claims to measure. A series
 * with fewer upcoming occurrences, or options that are not on offer, would
 * otherwise show up only as a misleadingly cheap page.
 */
export function findSeedProblems(seed, eventFixtures) {
	if (!seed) {
		return ['the seed script printed no PERF_SEED result'];
	}
	const problems = [];
	const { occurrences, options } = eventFixtures.config;
	if (seed.upcomingOccurrences !== occurrences) {
		problems.push(
			`expected ${occurrences} upcoming occurrences, got ${seed.upcomingOccurrences}`
		);
	}
	if (seed.offeredOptions !== options) {
		problems.push(
			`expected ${options} offered options, got ${seed.offeredOptions}`
		);
	}
	for (const page of eventFixtures.pages) {
		if (!seed.pages?.[page]) {
			problems.push(`no URL for the ${page} page`);
		}
	}
	return problems;
}

const EVENTS_LIST_SEED_SCRIPT =
	'wp-content/mu-plugins/scripts/seed-events-list-fixtures.php';

/**
 * The events list scaling sweep (`--events-list-scaling`), seeded size by
 * size by seed-events-list-fixtures.php. See PERFORMANCE.md § Events list
 * scaling. A recurring series needs at least two occurrences, so no size is
 * 1, and holds at most RecurrenceService::MAX_OCCURRENCES, which caps the
 * recurring sweep's sizes (see sweepSizes()).
 */
export const EVENTS_LIST_SCALING = {
	requiredPlugin: 'fair-events',
	sizes: [0, 10, 50, 200],
	maxSeriesOccurrences: 100,
	sweeps: ['events', 'recurring'],
	pages: ['control', 'bundled-query-loop', 'scaled-query-loop', 'per-event'],
	bundledLimit: 10,
};

/** The sizes one sweep measures: the recurring sweep stops at the series cap. */
export function sweepSizes(sweep, sizes, scaling) {
	if (sweep !== 'recurring') {
		return sizes;
	}
	return [
		...new Set(
			sizes.map((size) => Math.min(size, scaling.maxSeriesOccurrences))
		),
	];
}

/**
 * How many entries a page must render: none on the control page; in the
 * events sweep every event, except that the bundled pattern stops at its
 * limit; in the recurring sweep the one series, which the Upcoming view
 * groups into a single entry.
 */
export function expectedRenderedCount(sweep, page, size, scaling) {
	if (page === 'control' || size === 0) {
		return 0;
	}
	if (sweep === 'recurring') {
		return 1;
	}
	return page === 'bundled-query-loop'
		? Math.min(size, scaling.bundledLimit)
		: size;
}

/**
 * Count the entries an events list rendered in a page's HTML: Query Loop
 * posts (`li.wp-block-post`) and per-event entries (`.event-list-item`).
 * The fixture pages hold at most one list and the theme's page template
 * renders no other post list, so the whole page can be counted.
 */
export function countRenderedEntries(html) {
	const queryLoop = html.match(/<li\b[^>]*\bclass="[^"]*\bwp-block-post\b/g);
	const perEvent = html.match(/\bclass="event-list-item\b/g);
	return (queryLoop?.length ?? 0) + (perEvent?.length ?? 0);
}

/** Read the `PERF_EVENTS_LIST:{json}` line seed-events-list-fixtures.php prints. */
export function parseEventsListSeedOutput(stdout) {
	const line = stdout
		.split('\n')
		.find((candidate) => candidate.startsWith('PERF_EVENTS_LIST:'));
	if (!line) {
		return null;
	}
	try {
		return JSON.parse(line.slice('PERF_EVENTS_LIST:'.length));
	} catch {
		return null;
	}
}

/**
 * Check that a sweep's seed holds exactly what it claims to measure, and
 * that no other event shares the site: leftover events from other runs
 * would add to every list and to the stored counts.
 */
export function findEventsListSeedProblems(seed, sweep, size, scaling) {
	if (!seed) {
		return ['the seed script printed no PERF_EVENTS_LIST result'];
	}
	const problems = [];
	const expected = {
		storedEvents: sweep === 'events' ? size : Math.min(size, 1),
		storedSeries: sweep === 'recurring' ? Math.min(size, 1) : 0,
		upcomingOccurrences: size,
	};
	for (const [key, value] of Object.entries(expected)) {
		if (seed[key] !== value) {
			problems.push(`expected ${key} ${value}, got ${seed[key]}`);
		}
	}
	if (seed.foreignOccurrences !== 0) {
		problems.push(
			`the site holds ${seed.foreignOccurrences} upcoming occurrences that are not fixtures; measure on a freshly reset tests database`
		);
	}
	for (const page of scaling.pages) {
		if (!seed.pages?.[page]) {
			problems.push(`no URL for the ${page} page`);
		}
	}
	return problems;
}

/**
 * Reduce one recorded query to its shape, so the same lookup made for
 * different rows groups together: literals become `?`, IN lists `(…)`.
 */
export function normalizeQuery(sql) {
	return sql
		.replace(/'(?:[^'\\]|\\.)*'/g, '?')
		.replace(/\b\d+(?:\.\d+)?\b/g, '?')
		.replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, '(…)')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * The code that issued a recorded query: the last two frames of the call
 * stack wpdb records (wpdb's own frames are already left out), so a shared
 * model lookup is told apart by its caller.
 */
export function queryCaller(callstack) {
	const frames = String(callstack)
		.split(', ')
		.map((frame) => frame.trim())
		.filter(Boolean);
	return frames.slice(-2).join(' → ');
}

/**
 * Group a list render's recorded queries by caller and query shape, with a
 * count for each group.
 */
export function summarizeProfile(recorded) {
	const groups = new Map();
	for (const query of recorded) {
		const caller = queryCaller(query.caller);
		const shape = normalizeQuery(query.sql);
		const key = `${caller}\n${shape}`;
		const group = groups.get(key) ?? { caller, shape, count: 0 };
		group.count++;
		groups.set(key, group);
	}
	return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Read the `FAIR_PERF_PROFILE` comment the instrumentation appends on a profile request. */
export function parseProfileComment(html) {
	const match = /<!-- FAIR_PERF_PROFILE:(.*?) -->\s*$/s.exec(html);
	if (!match) {
		return null;
	}
	try {
		return JSON.parse(match[1]);
	} catch {
		return null;
	}
}

/**
 * Own the audit's environment around `run`: provision it (unless reused),
 * snapshot the plugin activation state, remove fixtures an earlier run left
 * behind, and afterwards always remove the fixtures, restore the activation
 * state and stop an owned environment — including on a thrown error or
 * SIGINT/SIGTERM.
 *
 * `run` receives `{ wpCli, activateOnly, phase, interrupted }` and returns
 * the outcome (`{ code, ... }`). `interrupted()` is the signal received so
 * far, if any; a run that sees one stops measuring and returns
 * `{ code: SIGNAL_EXIT_CODES[signal] }`.
 *
 * A cleanup step that fails turns an otherwise successful run into a failed
 * one.
 */
export async function withAuditEnvironment(
	{
		options,
		executor,
		plugins,
		logger = console.log,
		signalSource = process,
	},
	run
) {
	const allSlugs = plugins.map((p) => p.slug);
	let ownsEnvironment = false;
	let capturedState = false;
	let originalActivePlugins = [];
	let interruptedSignal;

	const onSignal = (signal) => {
		interruptedSignal ??= signal;
	};
	const onSigint = () => onSignal('SIGINT');
	const onSigterm = () => onSignal('SIGTERM');
	signalSource.on('SIGINT', onSigint);
	signalSource.on('SIGTERM', onSigterm);

	function phase(message) {
		logger(`\n==> ${message}`);
	}

	const wpCli = (args, runOptions) =>
		executor.run(
			'npx',
			['wp-env', 'run', 'tests-cli', 'wp', ...args],
			runOptions
		);

	/** Switch to exactly the given plugin set; returns a non-zero exit code on failure. */
	async function activateOnly(slugs) {
		const deactivate = await wpCli(['plugin', 'deactivate', ...allSlugs]);
		if (deactivate.code !== 0 || !slugs.length) {
			return deactivate.code;
		}
		const activate = await wpCli(['plugin', 'activate', ...slugs]);
		return activate.code;
	}

	async function prepare() {
		if (!options.reuse) {
			const status = await executor.run(
				'npx',
				['wp-env', 'status', '--json'],
				{ capture: true }
			);
			if (status.code !== 0) {
				return { code: status.code };
			}
			if (JSON.parse(status.stdout).status === 'running') {
				logger(
					'The isolated wp-env test instance is already running. Use --reuse to run against it explicitly, or stop it first.'
				);
				return { code: 2 };
			}

			phase('Preparing builds and production Composer dependencies');
			for (const args of [
				['run', 'build'],
				['run', 'composer:install:prod'],
			]) {
				const result = await executor.run('npm', args);
				if (result.code !== 0) {
					return { code: result.code };
				}
			}

			phase('Starting isolated WordPress test environment');
			const start = await executor.run('npx', ['wp-env', 'start']);
			if (start.code !== 0) {
				return { code: start.code };
			}
			ownsEnvironment = true;

			const rewrite = await wpCli([
				'rewrite',
				'structure',
				'/%postname%/',
				'--hard',
			]);
			if (rewrite.code !== 0) {
				return { code: rewrite.code };
			}
		} else {
			phase('Reusing explicitly managed WordPress test environment');
		}

		phase('Snapshotting current plugin activation state');
		const activeResult = await executor.run(
			'npx',
			[
				'wp-env',
				'run',
				'tests-cli',
				'wp',
				'plugin',
				'list',
				'--status=active',
				'--field=name',
			],
			{ capture: true }
		);
		if (activeResult.code !== 0) {
			return { code: activeResult.code };
		}
		originalActivePlugins = activeResult.stdout
			.split('\n')
			.map((s) => s.trim())
			.filter(Boolean);
		capturedState = true;

		// A run that was killed outright never reached its cleanup; whatever
		// it left would distort every page measured below.
		phase('Removing fixtures left by an earlier run');
		const recover = await wpCli(['eval-file', CLEANUP_SCRIPT]);
		if (recover.code !== 0) {
			return { code: recover.code };
		}

		return null;
	}

	/** Undo everything the run changed; returns a description of each step that failed. */
	async function cleanUp() {
		const failures = [];

		if (capturedState) {
			phase('Removing fixtures');
			const remove = await wpCli(['eval-file', CLEANUP_SCRIPT]);
			if (remove.code !== 0) {
				failures.push('removing the fixtures');
			}

			phase('Restoring original plugin activation state');
			if ((await activateOnly(originalActivePlugins)) !== 0) {
				failures.push('restoring the plugin activation state');
			}
		}

		if (ownsEnvironment) {
			phase('Stopping owned WordPress test environment');
			const stop = await executor.run('npx', ['wp-env', 'stop']);
			if (stop.code !== 0) {
				failures.push('stopping the WordPress test environment');
			}
		}

		return failures;
	}

	let outcome;
	let cleanupFailures;
	try {
		outcome =
			(await prepare()) ??
			(await run({
				wpCli,
				activateOnly,
				phase,
				interrupted: () => interruptedSignal,
			}));
	} finally {
		signalSource.off('SIGINT', onSigint);
		signalSource.off('SIGTERM', onSigterm);
		cleanupFailures = await cleanUp();
		for (const failure of cleanupFailures) {
			logger(`Cleanup failed while ${failure}.`);
		}
	}

	// A cleanup error becomes the run's status only when nothing failed earlier.
	if (cleanupFailures.length && outcome.code === 0) {
		return { ...outcome, code: 1 };
	}
	return outcome;
}

/**
 * Run the full audit within withAuditEnvironment(): create the fixture
 * pages and sweep the comparison matrix.
 *
 * Measurement has two phases. The fixture pages are measured first, in every
 * scenario, while the site holds no events, so their numbers stay comparable
 * with earlier runs. Only then are the event fixtures seeded and their pages
 * measured, in the scenarios `scenarioMeasuresEventPages()` accepts.
 */
export async function runPerformanceAudit({
	options,
	executor,
	plugins,
	matrix,
	fixtures,
	eventFixtures,
	baseUrl,
	measureBackend,
	measureFrontend,
	logger = console.log,
	signalSource = process,
}) {
	const results = [];
	const skipped = [];

	async function measurePage(scenario, pageKey, url) {
		const samples = [];
		for (let i = 0; i < options.samples + 1; i++) {
			samples.push(await measureBackend(url));
		}
		const metrics = aggregateSamples(samples);
		const frontend = await measureFrontend(url);
		results.push({
			scenario: scenario.name,
			page: pageKey,
			metrics,
			frontend,
		});
	}

	return withAuditEnvironment(
		{ options, executor, plugins, logger, signalSource },
		async ({ wpCli, activateOnly, phase, interrupted }) => {
			phase('Creating synthetic fixture pages');
			const createdPages = {};
			for (const [pageKey, fixture] of Object.entries(fixtures)) {
				const create = await wpCli(
					[
						'post',
						'create',
						'--post_type=page',
						'--post_status=publish',
						`--post_title=${fixture.title}`,
						`--post_name=${fixture.slug}`,
						`--post_content=${fixture.content}`,
						`--meta_input=${JSON.stringify({
							[FIXTURE_MARKER_META]: '1',
						})}`,
						'--porcelain',
					],
					{ capture: true }
				);
				if (create.code !== 0) {
					return { code: create.code };
				}
				createdPages[pageKey] = create.stdout.trim();
			}

			const scenarios = options.scenario
				? matrix.filter((s) => s.name === options.scenario)
				: matrix;
			if (options.scenario && scenarios.length === 0) {
				logger(`Unknown scenario "${options.scenario}".`);
				return { code: 2 };
			}

			for (const scenario of scenarios) {
				if (interrupted()) {
					break;
				}

				phase(`Measuring scenario: ${scenario.name}`);
				const code = await activateOnly(scenario.plugins);
				if (code !== 0) {
					return { code };
				}

				for (const [pageKey, pageId] of Object.entries(createdPages)) {
					await measurePage(
						scenario,
						pageKey,
						`${baseUrl}/?p=${pageId}`
					);
				}
			}

			const eventScenarios = eventFixtures
				? scenarios.filter((s) =>
						scenarioMeasuresEventPages(s, eventFixtures)
					)
				: [];

			if (eventFixtures) {
				for (const scenario of scenarios) {
					if (eventScenarios.includes(scenario)) {
						continue;
					}
					for (const page of eventFixtures.pages) {
						skipped.push({
							scenario: scenario.name,
							page,
							status: 'n/a',
							reason: `not measured where ${eventFixtures.requiredPlugin} is inactive — the page's blocks would render empty.`,
						});
					}
				}
			}

			if (eventScenarios.length && !interrupted()) {
				phase('Seeding event fixtures');
				const code = await activateOnly([eventFixtures.requiredPlugin]);
				if (code !== 0) {
					return { code };
				}
				const seedResult = await wpCli(
					[
						'eval-file',
						SEED_SCRIPT,
						JSON.stringify(eventFixtures.config),
					],
					{ capture: true }
				);
				if (seedResult.code !== 0) {
					return { code: seedResult.code };
				}
				const seed = parseSeedOutput(seedResult.stdout);
				const problems = findSeedProblems(seed, eventFixtures);
				if (problems.length) {
					logger(
						`Event fixtures are incomplete: ${problems.join('; ')}.`
					);
					return { code: 1 };
				}

				for (const scenario of eventScenarios) {
					if (interrupted()) {
						break;
					}

					phase(
						`Measuring event pages in scenario: ${scenario.name}`
					);
					const activateCode = await activateOnly(scenario.plugins);
					if (activateCode !== 0) {
						return { code: activateCode };
					}

					for (const page of eventFixtures.pages) {
						await measurePage(
							scenario,
							page,
							`${baseUrl}${seed.pages[page]}`
						);
					}
				}
			}

			if (interrupted()) {
				return { code: SIGNAL_EXIT_CODES[interrupted()] };
			}

			const comparisons = compareToBaseline(results, matrix[0].name);
			return { code: 0, results, comparisons, skipped };
		}
	);
}

/**
 * Run the events list scaling sweep within withAuditEnvironment(): with
 * fair-events alone active, seed each sweep at each fixture size, measure
 * the control page and the three list pages, and profile each list page
 * once with query recording.
 *
 * Every measured response must render the expected number of entries
 * (expectedRenderedCount()) with exactly one events list on a list page;
 * a mismatch fails the run, since a fixture that rendered less would only
 * read as a cheaper list. Profile requests are separate and their timing is
 * never reported.
 */
export async function runEventsListScaling({
	options,
	executor,
	plugins,
	scaling = EVENTS_LIST_SCALING,
	baseUrl,
	measureBackend,
	logger = console.log,
	signalSource = process,
}) {
	const sizes = Object.fromEntries(
		scaling.sweeps.map((sweep) => [
			sweep,
			sweepSizes(sweep, options.sizes ?? scaling.sizes, scaling),
		])
	);
	const results = [];

	return withAuditEnvironment(
		{ options, executor, plugins, logger, signalSource },
		async ({ wpCli, activateOnly, phase, interrupted }) => {
			phase(`Activating ${scaling.requiredPlugin} alone`);
			const activateCode = await activateOnly([scaling.requiredPlugin]);
			if (activateCode !== 0) {
				return { code: activateCode };
			}

			let environment;

			for (const sweep of scaling.sweeps) {
				for (const size of sizes[sweep]) {
					if (interrupted()) {
						return { code: SIGNAL_EXIT_CODES[interrupted()] };
					}

					phase(`Seeding the ${sweep} sweep at size ${size}`);
					const clear = await wpCli(['eval-file', CLEANUP_SCRIPT]);
					if (clear.code !== 0) {
						return { code: clear.code };
					}
					const seedResult = await wpCli(
						[
							'eval-file',
							EVENTS_LIST_SEED_SCRIPT,
							JSON.stringify({ sweep, size }),
						],
						{ capture: true }
					);
					if (seedResult.code !== 0) {
						return { code: seedResult.code };
					}
					const seed = parseEventsListSeedOutput(seedResult.stdout);
					const problems = findEventsListSeedProblems(
						seed,
						sweep,
						size,
						scaling
					);
					if (problems.length) {
						logger(
							`Events list fixtures are wrong (${sweep} sweep, size ${size}): ${problems.join(
								'; '
							)}.`
						);
						return { code: 1 };
					}

					for (const page of scaling.pages) {
						const url = `${baseUrl}${seed.pages[page]}`;
						const expected = expectedRenderedCount(
							sweep,
							page,
							size,
							scaling
						);
						const expectedLists = page === 'control' ? 0 : 1;
						const samples = [];
						for (let i = 0; i < options.samples + 1; i++) {
							const sample = await measureBackend(url);
							const rendered = countRenderedEntries(sample.body);
							if (
								rendered !== expected ||
								sample.list.count !== expectedLists
							) {
								logger(
									`${url} rendered ${rendered} entries in ${sample.list.count} events lists; expected ${expected} in ${expectedLists} (${sweep} sweep, size ${size}).`
								);
								return { code: 1 };
							}
							samples.push(sample);
						}
						environment ??= samples[0].environment;

						const warm = samples.slice(1);
						const result = {
							sweep,
							size,
							page,
							storedEvents: seed.storedEvents,
							storedSeries: seed.storedSeries,
							upcomingOccurrences: seed.upcomingOccurrences,
							rendered: expected,
							metrics: aggregateSamples(samples),
							list: {
								queryCount: median(
									warm.map((sample) => sample.list.queryCount)
								),
								durationMs: median(
									warm.map((sample) => sample.list.durationMs)
								),
							},
						};

						if (page !== 'control') {
							const profiled = await measureBackend(url, {
								profile: true,
							});
							result.profile = summarizeProfile(
								profiled.recorded ?? []
							);
						}

						results.push(result);
					}
				}
			}

			return { code: 0, scaling: results, environment, sizes };
		}
	);
}

/**
 * Query groups of one sweep/page whose count changes across the non-empty
 * sizes, each with its count per size (0 where the group did not occur).
 * Comparing only non-empty sizes leaves out the one-off queries a list makes
 * as soon as it has anything to render; with fewer than two non-empty sizes
 * every change counts.
 */
export function growingQueryGroups(results, sweep, page, sizes) {
	const groups = new Map();
	for (const result of results) {
		if (result.sweep !== sweep || result.page !== page) {
			continue;
		}
		for (const group of result.profile ?? []) {
			const key = `${group.caller}\n${group.shape}`;
			const entry = groups.get(key) ?? {
				caller: group.caller,
				shape: group.shape,
				counts: Object.fromEntries(sizes.map((size) => [size, 0])),
			};
			entry.counts[result.size] = group.count;
			groups.set(key, entry);
		}
	}
	const nonEmpty = sizes.filter((size) => size > 0);
	const compared = nonEmpty.length >= 2 ? nonEmpty : sizes;
	return [...groups.values()]
		.filter(
			(group) =>
				new Set(compared.map((size) => group.counts[size])).size > 1
		)
		.sort((a, b) => b.counts[sizes.at(-1)] - a.counts[sizes.at(-1)]);
}

function truncate(text, length) {
	return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

const SWEEP_TITLES = {
	events: 'events sweep: distinct events, one date each',
	recurring: 'recurring sweep: one weekly series',
};

/**
 * Render the scaling sweep as markdown: the environment it ran in, one
 * table per sweep with every size and page, and, per list page, the query
 * groups whose count changes with the size. `sizes` maps each sweep to the
 * sizes it measured.
 */
export function formatScalingReport({
	scaling,
	environment,
	sizes,
	samples,
	generatedAt = new Date().toISOString(),
}) {
	const lines = [
		'# Events list scaling results',
		'',
		`Generated: ${generatedAt}`,
		'',
	];

	if (environment) {
		lines.push(
			`Environment: WordPress ${environment.wordpress}, PHP ${environment.php}, database ${environment.database}, theme ${environment.theme}, active plugins: ${environment.plugins}. Persistent object cache: ${environment.objectCache}; OPcache: ${environment.opcache}.`,
			''
		);
	}
	lines.push(
		`Sampling: one discarded warm-up request and ${samples} measured requests per page and size; medians. Each list page is profiled with one more request whose timing is not used.`,
		''
	);

	const pages = [...new Set(scaling.map((r) => r.page))];

	for (const sweep of [...new Set(scaling.map((r) => r.sweep))]) {
		lines.push(`## ${SWEEP_TITLES[sweep] ?? sweep}`, '');
		lines.push(
			'| Size | Page | Stored events | Series | Upcoming occurrences | Rendered | Queries | List queries | Duration (ms) | List duration (ms) | Peak memory (MB) |'
		);
		lines.push(
			'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
		);
		for (const result of scaling.filter((r) => r.sweep === sweep)) {
			lines.push(
				`| ${result.size} | ${result.page} | ${result.storedEvents} | ${
					result.storedSeries
				} | ${result.upcomingOccurrences} | ${result.rendered} | ${
					result.metrics.queryCount
				} | ${result.list.queryCount} | ${result.metrics.durationMs.toFixed(
					1
				)} | ${result.list.durationMs.toFixed(1)} | ${(
					result.metrics.memoryBytes /
					(1024 * 1024)
				).toFixed(2)} |`
			);
		}
		lines.push('');

		for (const page of pages.filter((p) => p !== 'control')) {
			const growing = growingQueryGroups(
				scaling,
				sweep,
				page,
				sizes[sweep]
			);
			lines.push(`### ${sweep} sweep, ${page}: queries that grow`, '');
			if (!growing.length) {
				lines.push(
					'No recorded query group changes its count across the sizes.',
					''
				);
				continue;
			}
			lines.push(
				`| Caller | Query | ${sizes[sweep].join(' | ')} |`,
				`| --- | --- | ${sizes[sweep].map(() => '---').join(' | ')} |`
			);
			for (const group of growing) {
				lines.push(
					`| \`${group.caller}\` | \`${truncate(
						group.shape,
						90
					).replace(/\|/g, '\\|')}\` | ${sizes[sweep]
						.map((size) => group.counts[size])
						.join(' | ')} |`
				);
			}
			lines.push('');
		}
	}

	return lines.join('\n');
}

const PLAIN_PAGE_CONTENT =
	'<!-- wp:paragraph --><p>Baseline page with no Fair Event blocks.</p><!-- /wp:paragraph -->';

const FEATURE_PAGE_CONTENT = [
	'<!-- wp:fair-events/events-list /-->',
	'<!-- wp:fair-audience/mailing-signup /-->',
	'<!-- wp:fair-timetable/timetable /-->',
	'<!-- wp:fair-payment/simple-payment /-->',
	'<!-- wp:fair-audience/fair-form /-->',
	'<!-- wp:fair-calendar-button/calendar-button /-->',
].join('\n\n');

const FIXTURES = {
	plain: {
		title: 'Fair Performance – Plain',
		slug: 'fair-performance-plain',
		content: PLAIN_PAGE_CONTENT,
	},
	feature: {
		title: 'Fair Performance – Feature',
		slug: 'fair-performance-feature',
		content: FEATURE_PAGE_CONTENT,
	},
};

async function realMeasureBackend(url, { profile = false } = {}) {
	const response = await fetch(url, {
		headers: {
			'X-Fair-Performance-Audit': '1',
			...(profile ? { 'X-Fair-Performance-Profile': '1' } : {}),
		},
	});
	const body = await response.text();

	// An error page is fast and cheap, so it must never pass as a measurement.
	if (!response.ok) {
		throw new Error(`${url} responded with HTTP ${response.status}.`);
	}

	const durationMs = Number(response.headers.get('x-fair-perf-duration-ms'));
	const memoryBytes = Number(
		response.headers.get('x-fair-perf-peak-memory-bytes')
	);
	const queryCount = Number(response.headers.get('x-fair-perf-query-count'));

	if (
		!Number.isFinite(durationMs) ||
		!Number.isFinite(memoryBytes) ||
		!Number.isFinite(queryCount)
	) {
		throw new Error(
			`Performance headers missing on the response from ${url}. Is fair-performance-instrumentation.php mounted?`
		);
	}

	const environmentHeader = response.headers.get('x-fair-perf-environment');

	return {
		durationMs,
		memoryBytes,
		queryCount,
		list: {
			count: Number(response.headers.get('x-fair-perf-list-count')),
			queryCount: Number(
				response.headers.get('x-fair-perf-list-query-count')
			),
			durationMs: Number(
				response.headers.get('x-fair-perf-list-duration-ms')
			),
		},
		environment: environmentHeader ? JSON.parse(environmentHeader) : null,
		body,
		recorded: profile ? parseProfileComment(body) : undefined,
	};
}

async function createFrontendMeasurer() {
	const browser = await chromium.launch({ headless: true });
	return {
		async measure(url) {
			const context = await browser.newContext();
			const page = await context.newPage();
			const response = await page.goto(url, {
				waitUntil: 'networkidle',
			});
			if (!response?.ok()) {
				throw new Error(
					`${url} responded with HTTP ${response?.status()}.`
				);
			}
			const resources = await page.evaluate(() =>
				performance
					.getEntriesByType('resource')
					.filter((entry) => /\.(js|css)(\?|$)/.test(entry.name))
					.map((entry) => ({
						name: entry.name,
						transferSize: entry.transferSize,
					}))
			);
			await context.close();
			return {
				requestCount: resources.length,
				transferBytes: resources.reduce(
					(sum, r) => sum + (r.transferSize || 0),
					0
				),
				assets: resources.map((r) => r.name),
			};
		},
		async close() {
			await browser.close();
		},
	};
}

async function main() {
	let options;
	try {
		options = parseArguments(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 2;
		return;
	}

	const rootDirectory = fileURLToPath(new URL('..', import.meta.url)).replace(
		/\/$/,
		''
	);
	const plugins = await loadPluginCatalog(rootDirectory);
	const matrix = buildComparisonMatrix(plugins);
	const baseUrl = `http://localhost:${await resolveTestsPort(rootDirectory)}`;
	const executor = createProcessExecutor({
		cwd: rootDirectory,
		env: { ...process.env, CI: '1' },
	});

	if (options.eventsListScaling) {
		const outcome = await runEventsListScaling({
			options,
			executor,
			plugins,
			baseUrl,
			measureBackend: realMeasureBackend,
		});
		if (outcome.scaling) {
			const report = formatScalingReport({
				scaling: outcome.scaling,
				environment: outcome.environment,
				sizes: outcome.sizes,
				samples: options.samples,
			});
			console.log(`\n${report}`);
			if (options.outFile) {
				await writeFile(options.outFile, report);
				console.log(`\nReport written to ${options.outFile}`);
			}
			if (options.jsonOut) {
				await writeFile(
					options.jsonOut,
					JSON.stringify(
						{
							generatedAt: new Date().toISOString(),
							mode: 'events-list-scaling',
							environment: outcome.environment,
							sizes: outcome.sizes,
							results: outcome.scaling,
						},
						null,
						2
					)
				);
				console.log(`JSON report written to ${options.jsonOut}`);
			}
		}
		process.exitCode = outcome.code;
		return;
	}

	const frontendMeasurer = await createFrontendMeasurer();
	let outcome;
	try {
		outcome = await runPerformanceAudit({
			options,
			executor,
			plugins,
			matrix,
			fixtures: FIXTURES,
			eventFixtures: EVENT_FIXTURES,
			baseUrl,
			measureBackend: realMeasureBackend,
			measureFrontend: frontendMeasurer.measure,
		});
	} finally {
		await frontendMeasurer.close();
	}

	if (outcome.results) {
		const report = formatMarkdownReport({
			results: outcome.results,
			comparisons: outcome.comparisons,
			skipped: outcome.skipped,
		});
		console.log(`\n${report}`);
		if (options.outFile) {
			await writeFile(options.outFile, report);
			console.log(`\nReport written to ${options.outFile}`);
		}
		if (options.jsonOut) {
			const json = formatJsonReport({
				results: outcome.results,
				comparisons: outcome.comparisons,
				skipped: outcome.skipped,
			});
			await writeFile(options.jsonOut, json);
			console.log(`JSON report written to ${options.jsonOut}`);
		}
	}

	process.exitCode = outcome.code;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
