#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Shard timing data and CI benchmarks for the balanced E2E and API shards.
 *
 * Refresh the checked-in timing data from finished CI runs (needs `gh`):
 *
 *   node scripts/shard-timings.mjs refresh --suite=e2e --run=<id> --run=<id> …
 *
 * Downloads each run's shard reports (latest attempt per shard), measures every
 * spec file's clean execution time, and writes the median per file to
 * scripts/shard-timings/<suite>.json. A file sample is clean when every test in
 * it ran once and passed or was skipped; samples with retries, failures or
 * tests that never ran are counted as excluded, not used as timings.
 *
 * Compare CI runs (workflow elapsed, per-shard test time, runner minutes,
 * retries and failures):
 *
 *   node scripts/shard-timings.mjs report --suite=api --run=<id> … [--label=After]
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { reportFiles, TIMINGS_DIRECTORY } from './shard-assignment.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY = 'marcin-wosinek/fair-event-plugins';

export function parseOptions(args) {
	const [command, ...rest] = args;
	if (!['refresh', 'report'].includes(command)) {
		throw new Error(
			'Usage: shard-timings.mjs refresh|report --suite=e2e|api --run=<id> [--run=<id> …]'
		);
	}
	const values = (name) =>
		rest
			.filter((argument) => argument.startsWith(`--${name}=`))
			.map((argument) => argument.slice(name.length + 3));
	const [suite] = values('suite');
	if (!['e2e', 'api'].includes(suite)) {
		throw new Error('Pass --suite=e2e or --suite=api.');
	}
	const runs = values('run');
	if (!runs.length || runs.some((run) => !/^\d+$/.test(run))) {
		throw new Error('Pass at least one numeric --run=<workflow run id>.');
	}
	return {
		command,
		suite,
		runs,
		label: values('label')[0] ?? 'Runs',
	};
}

export function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	if (!sorted.length) {
		return undefined;
	}
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value, digits = 1) {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

/**
 * One timing sample per spec file of a Playwright JSON results report.
 *
 * The duration spans the file's first test start to its last test end, so
 * file-level hooks count. A sample is clean only when every test ran exactly
 * once and passed or was skipped.
 *
 * @param {Object} report      Parsed JSON results report.
 * @param {string} [workspace] API workspace; omit for the root E2E suite.
 * @return {{id: string, seconds: number, clean: boolean, retries: number, failures: number}[]}
 *   One sample per file.
 */
export function fileSamples(report, workspace) {
	const files = reportFiles(report, workspace);
	return (report.suites ?? []).map((suite, index) => {
		const tests = [];
		const walk = (node) => {
			for (const spec of node.specs ?? []) {
				tests.push(...spec.tests);
			}
			(node.suites ?? []).forEach(walk);
		};
		walk(suite);

		let start = Infinity;
		let end = -Infinity;
		let retries = 0;
		let failures = 0;
		let unrun = 0;
		for (const test of tests) {
			const results = test.results ?? [];
			if (!results.length) {
				unrun++;
			}
			retries += Math.max(0, results.length - 1);
			if (!['expected', 'skipped'].includes(test.status)) {
				failures++;
			}
			for (const result of results) {
				const startedAt = Date.parse(result.startTime);
				start = Math.min(start, startedAt);
				end = Math.max(end, startedAt + result.duration);
			}
		}
		return {
			id: files[index].id,
			seconds: end > start ? round((end - start) / 1000) : 0,
			clean: tests.length > 0 && !retries && !failures && !unrun,
			retries,
			failures,
		};
	});
}

/**
 * Median clean duration per file across runs; a file with no clean sample
 * keeps the median of its excluded samples so a long, flaky file still
 * weighs what it costs, and says so with `samples: 0`.
 *
 * @param {Object[][]} runs Samples per run (fileSamples() of every report).
 * @return {Object<string, {seconds: number, samples: number, excluded: number}>}
 *   Timing entries by file id, sorted by id.
 */
export function aggregateSamples(runs) {
	const byId = new Map();
	for (const samples of runs) {
		for (const sample of samples) {
			const entry = byId.get(sample.id) ?? { clean: [], excluded: [] };
			(sample.clean ? entry.clean : entry.excluded).push(sample.seconds);
			byId.set(sample.id, entry);
		}
	}
	const files = {};
	for (const id of [...byId.keys()].sort()) {
		const { clean, excluded } = byId.get(id);
		files[id] = {
			seconds: round(median(clean.length ? clean : excluded)),
			samples: clean.length,
			excluded: excluded.length,
		};
	}
	return files;
}

/**
 * Pick the latest attempt of each shard artifact.
 *
 * @param {string[]} folders Artifact folder names.
 * @param {string}   suite   "e2e" or "api".
 * @return {Map<number, string>} Folder per shard number.
 */
export function latestShardFolders(folders, suite) {
	const pattern =
		suite === 'e2e'
			? /^playwright-report-shard-(\d+)-of-\d+-attempt-(\d+)$/
			: /^api-report-shard-(\d+)-of-\d+-attempt-(\d+)$/;
	const latest = new Map();
	for (const folder of folders) {
		const match = pattern.exec(folder);
		if (!match) {
			continue;
		}
		const shard = Number(match[1]);
		const attempt = Number(match[2]);
		if (attempt > (latest.get(shard)?.attempt ?? 0)) {
			latest.set(shard, { folder, attempt });
		}
	}
	return new Map(
		[...latest]
			.sort(([a], [b]) => a - b)
			.map(([shard, v]) => [shard, v.folder])
	);
}

async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

/**
 * Download one run's shard artifacts and read their reports.
 *
 * @param {string} run   Workflow run id.
 * @param {string} suite "e2e" or "api".
 * @return {Promise<{shard: number, reports: Object[], timings: Object|undefined}[]>}
 *   Reports per shard; each report entry is `{workspace, report}`.
 */
async function downloadShards(run, suite) {
	const directory = await mkdtemp(join(tmpdir(), `shard-timings-${run}-`));
	try {
		await execFileAsync(
			'gh',
			[
				'run',
				'download',
				run,
				'--repo',
				REPOSITORY,
				'--pattern',
				suite === 'e2e'
					? 'playwright-report-shard-*'
					: 'api-report-shard-*',
				'--dir',
				directory,
			],
			{ maxBuffer: 64 * 1024 * 1024 }
		);
		const shards = [];
		for (const [shard, folder] of latestShardFolders(
			await readdir(directory),
			suite
		)) {
			const reports = [];
			let timings;
			if (suite === 'e2e') {
				reports.push({
					workspace: undefined,
					report: await readJson(
						join(directory, folder, 'e2e-results', 'results.json')
					),
				});
			} else {
				const results = join(directory, folder, 'api-results');
				for (const file of (await readdir(results)).sort()) {
					if (file === 'timings.json') {
						timings = await readJson(join(results, file));
					} else if (file.endsWith('.json')) {
						reports.push({
							workspace: file.slice(0, -'.json'.length),
							report: await readJson(join(results, file)),
						});
					}
				}
			}
			shards.push({ shard, reports, timings });
		}
		return shards;
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function runMetadata(run) {
	const { stdout } = await execFileAsync('gh', [
		'run',
		'view',
		run,
		'--repo',
		REPOSITORY,
		'--json',
		'attempt,conclusion,createdAt,event,headBranch,headSha,jobs',
	]);
	return JSON.parse(stdout);
}

/**
 * Benchmark figures of one run.
 *
 * Elapsed time runs from the first job start to the last job end, so queue
 * delay before the first job is excluded. Runner minutes add up every job.
 * A shard's test time is Playwright's own duration (E2E) or the sum of its
 * workspace test phases (API).
 *
 * @param {Object}   metadata `gh run view --json` output.
 * @param {Object[]} shards   downloadShards() output.
 * @param {string}   suite    "e2e" or "api".
 * @return {Object} Figures in minutes.
 */
export function runFigures(metadata, shards, suite) {
	const jobs = metadata.jobs.filter(
		(job) => job.startedAt && job.completedAt
	);
	const started = jobs.map((job) => Date.parse(job.startedAt));
	const completed = jobs.map((job) => Date.parse(job.completedAt));
	const shardMinutes = shards.map(({ reports, timings }) => {
		if (suite === 'api' && timings) {
			return (
				timings.phases
					.filter((phase) => phase.name.startsWith('API tests: '))
					.reduce((sum, phase) => sum + phase.seconds, 0) / 60
			);
		}
		return (
			reports.reduce(
				(sum, { report }) => sum + (report.stats?.duration ?? 0),
				0
			) / 60000
		);
	});
	const stat = (name) =>
		shards.reduce(
			(sum, { reports }) =>
				sum +
				reports.reduce(
					(inner, { report }) => inner + (report.stats?.[name] ?? 0),
					0
				),
			0
		);
	return {
		conclusion: metadata.conclusion,
		attempt: metadata.attempt,
		elapsed: (Math.max(...completed) - Math.min(...started)) / 60000,
		runnerMinutes:
			jobs.reduce(
				(sum, job, index) => sum + completed[index] - started[index],
				0
			) / 60000,
		shardMinutes,
		slowest: Math.max(...shardMinutes),
		fastest: Math.min(...shardMinutes),
		gap: Math.max(...shardMinutes) - Math.min(...shardMinutes),
		flaky: stat('flaky'),
		failed: stat('unexpected'),
	};
}

function summary(values) {
	const present = values.filter((value) => Number.isFinite(value));
	return `${median(present).toFixed(1)} (${Math.min(...present).toFixed(
		1
	)}–${Math.max(...present).toFixed(1)})`;
}

/**
 * Markdown tables for a set of runs: one row per run, then medians.
 *
 * @param {string}   label Heading.
 * @param {Object[]} rows  `{run, figures}` per run.
 * @return {string} Markdown.
 */
export function formatReport(label, rows) {
	const shardCount = Math.max(
		...rows.map(({ figures }) => figures.shardMinutes.length)
	);
	const shardHeaders = Array.from(
		{ length: shardCount },
		(_, index) => `Shard ${index + 1}`
	);
	const lines = [
		`### ${label}`,
		'',
		`| Run | Result | Elapsed | ${shardHeaders.join(
			' | '
		)} | Gap | Runner min | Flaky | Failed |`,
		`| --- | --- | --- | ${shardHeaders
			.map(() => '---')
			.join(' | ')} | --- | --- | --- | --- |`,
	];
	for (const { run, figures } of rows) {
		lines.push(
			`| ${run} | ${figures.conclusion}${
				figures.attempt > 1 ? ` (attempt ${figures.attempt})` : ''
			} | ${figures.elapsed.toFixed(1)} | ${figures.shardMinutes
				.map((value) => value.toFixed(1))
				.join(
					' | '
				)} | ${figures.gap.toFixed(1)} | ${figures.runnerMinutes.toFixed(
				1
			)} | ${figures.flaky} | ${figures.failed} |`
		);
	}
	const column = (pick) => rows.map(({ figures }) => pick(figures));
	lines.push(
		'',
		'| Median (range), minutes | Value |',
		'| --- | --- |',
		`| Workflow elapsed | ${summary(column((f) => f.elapsed))} |`,
		`| Slowest shard, test time | ${summary(column((f) => f.slowest))} |`,
		`| Fastest shard, test time | ${summary(column((f) => f.fastest))} |`,
		`| Fastest-to-slowest gap | ${summary(column((f) => f.gap))} |`,
		`| Runner minutes, all jobs | ${summary(
			column((f) => f.runnerMinutes)
		)} |`,
		...shardHeaders.map(
			(header, index) =>
				`| ${header}, test time | ${summary(
					column((f) => f.shardMinutes[index])
				)} |`
		),
		`| Flaky tests / failed tests (total) | ${column((f) => f.flaky).reduce(
			(a, b) => a + b,
			0
		)} / ${column((f) => f.failed).reduce((a, b) => a + b, 0)} |`,
		''
	);
	return lines.join('\n');
}

async function refresh({ suite, runs }) {
	const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
	const samples = [];
	const sources = [];
	for (const run of runs) {
		const metadata = await runMetadata(run);
		const shards = await downloadShards(run, suite);
		const runSamples = shards.flatMap(({ reports }) =>
			reports.flatMap(({ workspace, report }) =>
				fileSamples(report, workspace)
			)
		);
		const excluded = runSamples.filter((sample) => !sample.clean);
		console.log(
			`Run ${run} (${metadata.headBranch}@${metadata.headSha.slice(
				0,
				8
			)}, ${metadata.conclusion}): ${runSamples.length} files from ${
				shards.length
			} shards, ${excluded.length} excluded${
				excluded.length
					? `: ${excluded
							.map(
								(sample) =>
									`${sample.id} (${sample.retries} retries, ${sample.failures} failed)`
							)
							.join(', ')}`
					: ''
			}`
		);
		samples.push(runSamples);
		sources.push({
			run: Number(run),
			attempt: metadata.attempt,
			headSha: metadata.headSha,
			createdAt: metadata.createdAt,
			conclusion: metadata.conclusion,
		});
	}
	const files = aggregateSamples(samples);
	const path = join(rootDirectory, TIMINGS_DIRECTORY, `${suite}.json`);
	await writeFile(
		path,
		`${JSON.stringify(
			{
				suite,
				about: 'Median clean seconds per spec file. Refresh with: node scripts/shard-timings.mjs refresh (TESTING.md § Rebalancing shards).',
				runs: sources,
				files,
			},
			null,
			'\t'
		)}\n`
	);
	console.log(`Wrote ${Object.keys(files).length} file timings to ${path}`);
}

async function report({ suite, runs, label }) {
	const rows = [];
	for (const run of runs) {
		const metadata = await runMetadata(run);
		const shards = await downloadShards(run, suite);
		rows.push({ run, figures: runFigures(metadata, shards, suite) });
	}
	console.log(formatReport(label, rows));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const run = async () => {
		const options = parseOptions(process.argv.slice(2));
		await (options.command === 'refresh'
			? refresh(options)
			: report(options));
	};
	run().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
