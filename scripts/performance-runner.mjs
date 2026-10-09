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

import { createProcessExecutor } from './api-test-runner.mjs';

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

export function parseArguments(args) {
	let reuse = false;
	let samples = 5;
	let scenario;
	let outFile;
	let jsonOut;

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
		} else {
			throw new Error(`Unknown argument "${argument}".`);
		}
	}

	if (!Number.isInteger(samples) || samples < 1) {
		throw new Error('The --samples option must be a positive integer.');
	}

	return { reuse, samples, scenario, outFile, jsonOut };
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

/**
 * Run the full audit: provision (unless reused), snapshot and later restore
 * plugin activation state, create fixtures, sweep the comparison matrix, and
 * always clean up — including on a thrown error or SIGINT/SIGTERM.
 *
 * Measurement has two phases. The fixture pages are measured first, in every
 * scenario, while the site holds no events, so their numbers stay comparable
 * with earlier runs. Only then are the event fixtures seeded and their pages
 * measured, in the scenarios `scenarioMeasuresEventPages()` accepts.
 *
 * Cleanup removes the fixtures before restoring the activation state, and a
 * cleanup step that fails turns an otherwise successful run into a failed
 * one.
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
	const allSlugs = plugins.map((p) => p.slug);
	let ownsEnvironment = false;
	let capturedState = false;
	let originalActivePlugins = [];
	let interruptedSignal;
	const results = [];
	const skipped = [];

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

	async function measure() {
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
			if (interruptedSignal) {
				break;
			}

			phase(`Measuring scenario: ${scenario.name}`);
			const code = await activateOnly(scenario.plugins);
			if (code !== 0) {
				return { code };
			}

			for (const [pageKey, pageId] of Object.entries(createdPages)) {
				await measurePage(scenario, pageKey, `${baseUrl}/?p=${pageId}`);
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

		if (eventScenarios.length && !interruptedSignal) {
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
				if (interruptedSignal) {
					break;
				}

				phase(`Measuring event pages in scenario: ${scenario.name}`);
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

		if (interruptedSignal) {
			return { code: SIGNAL_EXIT_CODES[interruptedSignal] };
		}

		const comparisons = compareToBaseline(results, matrix[0].name);
		return { code: 0, results, comparisons, skipped };
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
		outcome = await measure();
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

async function realMeasureBackend(url) {
	const response = await fetch(url, {
		headers: { 'X-Fair-Performance-Audit': '1' },
	});
	await response.arrayBuffer();

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

	return { durationMs, memoryBytes, queryCount };
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
	const baseUrl = 'http://localhost:8889';
	const executor = createProcessExecutor({
		cwd: rootDirectory,
		env: { ...process.env, CI: '1' },
	});

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
