#!/usr/bin/env node
/* eslint-disable no-console */

// Benchmarks E2E dependency preparation from finished workflow runs, through
// the authenticated `gh` CLI. Each observation is one run attempt.
//
//   node scripts/e2e-deps-benchmark.mjs baseline=41442928764:1-5 candidate=41450000000:1-5
//
// A `<label>=<run id>[:<attempts>]` argument adds those attempts to a group;
// `<attempts>` is `3`, `1-5` or `1,3,4` (default: every attempt). Add
// `--json` for machine-readable output. Preparation is the browser step plus
// every system-dependency step (cache restore, verification, install, save,
// report), from the jobs API. APT lines come from that step's log.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = 'marcin-wosinek/fair-event-plugins';

/** Steps that make up dependency preparation, old and new layouts alike. */
export const PREPARATION_STEPS = [
	'Install Playwright browser',
	'Start system dependency timer',
	'Compute system dependency cache key',
	'Restore system dependency archives',
	'Install Playwright system dependencies',
	'Save system dependency archives',
	'Report system dependency preparation',
];

export function parseAttempts(spec, latest) {
	if (!spec) {
		return Array.from({ length: latest }, (_, i) => i + 1);
	}
	return spec.split(',').flatMap((part) => {
		const [from, to] = part.split('-').map(Number);
		if (!to) {
			return [from];
		}
		return Array.from({ length: to - from + 1 }, (_, i) => from + i);
	});
}

export function parseArgs(args) {
	const groups = [];
	let json = false;
	for (const arg of args) {
		if (arg === '--json') {
			json = true;
			continue;
		}
		const match = arg.match(/^([\w-]+)=(\d+)(?::([\d,-]+))?$/);
		if (!match) {
			throw new Error(`Unrecognised argument: ${arg}`);
		}
		groups.push({ label: match[1], run: match[2], attempts: match[3] });
	}
	return { groups, json };
}

function seconds(start, end) {
	return start && end ? (Date.parse(end) - Date.parse(start)) / 1000 : 0;
}

/** Sums the preparation steps of a job (skipped steps count 0). */
export function preparationSeconds(job) {
	return job.steps
		.filter((step) => PREPARATION_STEPS.includes(step.name))
		.reduce(
			(sum, step) => sum + seconds(step.started_at, step.completed_at),
			0
		);
}

/**
 * Extracts the dependency-install part of a raw job log: the `Run` group
 * that invokes `playwright install-deps` directly or through the script.
 */
export function installSection(log) {
	const lines = log.split(/\r?\n/).map((line) => line.replace(/^\S+Z /, ''));
	const sections = [];
	let current = null;
	for (const line of lines) {
		if (line.startsWith('##[group]Run ')) {
			current = [line];
			sections.push(current);
		} else if (current) {
			current.push(line);
		}
	}
	const match = sections.find((section) =>
		section
			.slice(0, 12)
			.some((line) =>
				/install-deps|--with-deps|e2e-system-deps\.mjs install/.test(
					line
				)
			)
	);
	return match ? match.join('\n') : '';
}

export function aptFacts(section) {
	const lines = section.split('\n');
	const need = lines.find((line) =>
		/^Need to get .* of archives\./.test(line)
	);
	const needIndex = lines.indexOf(need);
	const fetched =
		needIndex >= 0
			? lines
					.slice(needIndex)
					.find((line) => /^Fetched .* in /.test(line))
			: undefined;
	return {
		needToGet: need || null,
		fetched: fetched || null,
		problems: lines.filter(
			(line) => /^(Err|Ign):\d+ /.test(line) || /^(W|E): /.test(line)
		).length,
		attempts: lines.filter((line) =>
			/^Need to get .* of archives\./.test(line)
		).length,
	};
}

export function imageVersion(log) {
	const match = log.match(/Image: (\S+)[\s\S]*?Version: (\S+)/);
	return match ? `${match[1]} ${match[2]}` : null;
}

/**
 * fresh: everything downloaded; reuse: nothing left to download;
 * partial-reuse: some archives downloaded; recovered: install ran twice.
 */
export function observedState(facts) {
	if (facts.attempts > 1) {
		return 'recovered';
	}
	if (!facts.needToGet) {
		return 'unknown';
	}
	if (!facts.needToGet.includes('/')) {
		return 'fresh';
	}
	return /^Need to get 0 B\//.test(facts.needToGet)
		? 'reuse'
		: 'partial-reuse';
}

export function stats(values) {
	const sorted = values
		.filter((value) => Number.isFinite(value))
		.sort((a, b) => a - b);
	if (sorted.length === 0) {
		return { n: 0, median: null, min: null, max: null };
	}
	const mid = Math.floor(sorted.length / 2);
	const median =
		sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
	return {
		n: sorted.length,
		median,
		min: sorted[0],
		max: sorted.at(-1),
	};
}

function gh(args, { json = true } = {}) {
	const result = spawnSync('gh', args, {
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
	});
	if (result.status !== 0) {
		throw new Error(`gh ${args.join(' ')} failed: ${result.stderr}`);
	}
	return json ? JSON.parse(result.stdout) : result.stdout;
}

function observe(label, runId, attempt) {
	const run = gh([
		'api',
		`repos/${REPO}/actions/runs/${runId}/attempts/${attempt}`,
	]);
	const { jobs } = gh([
		'api',
		`repos/${REPO}/actions/runs/${runId}/attempts/${attempt}/jobs`,
	]);
	const job = jobs.find((candidate) => candidate.name === 'e2e') || jobs[0];
	const log = gh(
		[
			'api',
			'--allow-escape-sequences',
			`repos/${REPO}/actions/jobs/${job.id}/logs`,
		],
		{ json: false }
	).replace(/\x1b\[[0-9;]*m/g, '');
	const facts = aptFacts(installSection(log));
	return {
		label,
		url: `${run.html_url}/attempts/${attempt}`,
		attempt,
		sha: run.head_sha.slice(0, 8),
		conclusion: job.conclusion,
		image: imageVersion(log),
		state: observedState(facts),
		queueSeconds: seconds(run.run_started_at, job.started_at),
		preparationSeconds: preparationSeconds(job),
		jobSeconds: seconds(job.started_at, job.completed_at),
		...facts,
	};
}

export function summarise(observations) {
	const groups = new Map();
	for (const observation of observations) {
		const key = `${observation.label}/${observation.state}`;
		if (!groups.has(key)) {
			groups.set(key, []);
		}
		groups.get(key).push(observation);
	}
	return [...groups].map(([key, items]) => ({
		group: key,
		preparation: stats(items.map((item) => item.preparationSeconds)),
		job: stats(items.map((item) => item.jobSeconds)),
		runnerMinutes:
			items.reduce((sum, item) => sum + item.jobSeconds, 0) / 60,
		problems: items.reduce((sum, item) => sum + item.problems, 0),
		retriedInstalls: items.filter((item) => item.attempts > 1).length,
		failed: items.filter((item) => item.conclusion !== 'success').length,
	}));
}

function markdown(observations, summary) {
	const lines = [
		'| Group | Run | SHA | Image | State | Queue | Prep | Job | APT | Problems | Result |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
		...observations.map(
			(o) =>
				`| ${o.label} | [${o.url.split('/runs/')[1]}](${o.url}) | ${o.sha} | ${o.image} | ${o.state} | ${o.queueSeconds}s | ${o.preparationSeconds}s | ${(o.jobSeconds / 60).toFixed(1)}m | ${o.needToGet || '—'} ${o.fetched ? `(${o.fetched})` : ''} | ${o.problems} | ${o.conclusion} |`
		),
		'',
		'| Group | n | Prep median | Prep range | Slowest prep | Job median | Job range | Runner min | APT problems | Failed |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
		...summary.map(
			(s) =>
				`| ${s.group} | ${s.preparation.n} | ${s.preparation.median}s | ${s.preparation.min}–${s.preparation.max}s | ${s.preparation.max}s | ${(s.job.median / 60).toFixed(1)}m | ${(s.job.min / 60).toFixed(1)}–${(s.job.max / 60).toFixed(1)}m | ${s.runnerMinutes.toFixed(1)} | ${s.problems} | ${s.failed} |`
		),
	];
	return lines.join('\n');
}

export function main(args = process.argv.slice(2)) {
	const { groups, json } = parseArgs(args);
	if (groups.length === 0) {
		console.error(
			'Usage: node scripts/e2e-deps-benchmark.mjs <label>=<run id>[:<attempts>] … [--json]'
		);
		return 2;
	}
	const observations = [];
	for (const group of groups) {
		const latest = gh([
			'api',
			`repos/${REPO}/actions/runs/${group.run}`,
		]).run_attempt;
		for (const attempt of parseAttempts(group.attempts, latest)) {
			observations.push(observe(group.label, group.run, attempt));
		}
	}
	const summary = summarise(observations);
	console.log(
		json
			? JSON.stringify({ observations, summary }, null, '\t')
			: markdown(observations, summary)
	);
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main();
}
