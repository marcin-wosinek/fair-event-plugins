#!/usr/bin/env node

/**
 * Bounded SonarQube Cloud review for one PR revision or for main after merge.
 *
 *   node scripts/sonar-review.mjs pr <number> [--sha <full-sha>]
 *   node scripts/sonar-review.mjs main <merge-sha>
 *
 * Prints a JSON report. The wait limit starts at the first check of this run
 * and is never extended by polling. See TESTING.md § SonarQube review.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const WAIT_LIMIT_MS = 15 * 60 * 1000;
export const POLL_INTERVAL_MS = 30 * 1000;
export const REQUEST_TIMEOUT_MS = 30 * 1000;
export const SONAR_APP = 'sonarqubecloud';
export const PROJECT_KEY = 'marcin-wosinek_fair-event-plugins';
export const REPO = 'marcin-wosinek/fair-event-plugins';
const SONAR = 'https://sonarcloud.io';

/** States that end the wait. Only `pending` keeps polling. */
export const STATES = [
	'passed',
	'gate-failed',
	'skipped',
	'unavailable',
	'failed',
	'superseded',
	'pending',
	'pending-timeout',
];

/** An HTTP 4xx from an evidence source: retrying will not help. */
export class UnavailableError extends Error {}

function sonarActionsJobs(runs) {
	return runs.filter(
		(run) => run.app?.slug === 'github-actions' && /sonar/i.test(run.name)
	);
}

function actionsSignal(jobs) {
	if (jobs.some((job) => job.status !== 'completed')) {
		return 'pending';
	}
	if (
		jobs.some((job) =>
			['failure', 'timed_out', 'cancelled', 'startup_failure'].includes(
				job.conclusion
			)
		)
	) {
		return 'failed';
	}
	if (
		jobs.length > 0 &&
		jobs.every((job) => ['skipped', 'neutral'].includes(job.conclusion))
	) {
		return 'skipped';
	}
	return jobs.length > 0 ? 'passed' : null;
}

/**
 * Classify one observation of a PR revision. Pure: all inputs are already
 * fetched. `findings` is null until the app check has completed.
 */
export function classifyPullRequest({ sha, headSha, suites, runs, findings }) {
	if (headSha !== sha) {
		return {
			state: 'superseded',
			reason: `PR head moved to ${headSha}; verify that revision separately.`,
		};
	}
	const appRun = runs.find((run) => run.app?.slug === SONAR_APP);
	const jobs = sonarActionsJobs(runs);
	const actions = actionsSignal(jobs);
	const notes = jobs
		.filter((job) => job.status === 'completed')
		.map(
			(job) =>
				`Actions job "${job.name}" concluded ${job.conclusion}: ${job.html_url}`
		);
	const base = { checkUrl: appRun?.details_url ?? jobs[0]?.html_url, notes };

	if (appRun && appRun.status === 'completed') {
		if (['success', 'failure'].includes(appRun.conclusion)) {
			if (!findings) {
				return {
					...base,
					state: 'pending',
					reason: 'Fetching findings.',
				};
			}
			if (findings.commitSha !== sha) {
				return {
					...base,
					state: 'pending',
					reason: `SonarQube Cloud findings still describe ${findings.commitSha ?? 'no commit'}.`,
				};
			}
			const gateOk =
				appRun.conclusion === 'success' &&
				findings.gate.status === 'OK';
			return {
				...base,
				state: gateOk ? 'passed' : 'gate-failed',
				reason: appRun.output?.title ?? findings.gate.status,
				gate: findings.gate,
				issues: findings.issues,
				hotspots: findings.hotspots,
			};
		}
		if (
			['skipped', 'neutral', 'cancelled', 'stale'].includes(
				appRun.conclusion
			)
		) {
			return {
				...base,
				state: 'skipped',
				reason: `SonarQube Cloud check concluded ${appRun.conclusion}.`,
			};
		}
		return {
			...base,
			state: 'failed',
			reason: `SonarQube Cloud check concluded ${appRun.conclusion}.`,
		};
	}
	if (appRun) {
		return { ...base, state: 'pending', reason: `Check ${appRun.status}.` };
	}
	if (actions === 'pending') {
		return {
			...base,
			state: 'pending',
			reason: 'Sonar Actions job running.',
		};
	}
	if (actions === 'failed') {
		return {
			...base,
			state: 'failed',
			reason: 'Sonar Actions job failed before publishing an analysis.',
		};
	}
	if (actions === 'skipped') {
		return {
			...base,
			state: 'skipped',
			reason: 'Sonar Actions job skipped.',
		};
	}
	const suite = suites.find((item) => item.app?.slug === SONAR_APP);
	if (suite && suite.status !== 'completed') {
		return {
			...base,
			state: 'pending',
			reason: `SonarQube Cloud check suite ${suite.status}.`,
		};
	}
	if (suite) {
		return {
			...base,
			state: 'skipped',
			reason: `SonarQube Cloud check suite concluded ${suite.conclusion} without a check.`,
		};
	}
	return {
		...base,
		state: 'unavailable',
		reason: 'No SonarQube Cloud check suite or Sonar Actions job for this revision.',
	};
}

/**
 * Classify one observation of main after merge. `analyses` is newest first;
 * `contains(revision)` says whether it includes the merged change on main.
 */
export function classifyMain({ analyses, contains, gateFor }) {
	const analysis = analyses.find((item) => contains(item.revision));
	if (!analysis) {
		return {
			state: 'pending',
			reason: 'No main analysis contains the merged change yet.',
		};
	}
	const gate = gateFor(analysis.key);
	if (!gate) {
		return { state: 'pending', reason: 'Fetching the quality gate.' };
	}
	return {
		state: gate.status === 'OK' ? 'passed' : 'gate-failed',
		reason: `Quality gate ${gate.status}.`,
		analyzedSha: analysis.revision,
		analysisDate: analysis.date,
		checkUrl: `${SONAR}/dashboard?id=${PROJECT_KEY}&branch=main`,
		gate,
	};
}

/**
 * Poll `observe` until it reports a terminal state or the fixed deadline
 * passes. Each observation receives the time remaining so requests can be
 * capped; polling never moves the deadline.
 */
export async function waitForAnalysis({
	observe,
	now = Date.now,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	limitMs = WAIT_LIMIT_MS,
	intervalMs = POLL_INTERVAL_MS,
}) {
	const startedAt = now();
	const expiresAt = startedAt + limitMs;
	const stamp = (ms) => new Date(ms).toISOString();
	let last = null;
	let polls = 0;
	while (now() < expiresAt) {
		const remainingMs = expiresAt - now();
		try {
			last = await observe({ remainingMs });
		} catch (error) {
			if (error instanceof UnavailableError) {
				return {
					state: 'unavailable',
					reason: error.message,
					polls: polls + 1,
					startedAt: stamp(startedAt),
					finishedAt: stamp(now()),
				};
			}
			last = {
				state: 'pending',
				reason: `Transient error: ${error.message}`,
			};
		}
		polls += 1;
		if (last.state !== 'pending') {
			return {
				...last,
				polls,
				startedAt: stamp(startedAt),
				finishedAt: stamp(now()),
			};
		}
		const wait = Math.min(intervalMs, expiresAt - now());
		if (wait > 0) {
			await sleep(wait);
		}
	}
	return {
		...last,
		state: 'pending-timeout',
		reason: 'analysis pending — wait limit reached',
		lastStatus: last?.reason ?? 'not checked',
		polls,
		startedAt: stamp(startedAt),
		expiredAt: stamp(expiresAt),
	};
}

const run = promisify(execFile);

async function gh(apiPath, timeoutMs) {
	try {
		const { stdout } = await run('gh', ['api', apiPath], {
			timeout: timeoutMs,
			maxBuffer: 16 * 1024 * 1024,
		});
		return JSON.parse(stdout);
	} catch (error) {
		if (/HTTP 4\d\d/.test(String(error.stderr))) {
			throw new UnavailableError(
				`gh api ${apiPath}: ${error.stderr.trim()}`
			);
		}
		throw error;
	}
}

async function sonar(apiPath, timeoutMs) {
	const headers = {};
	// Optional, for a private project; never printed.
	if (process.env.SONAR_TOKEN) {
		headers.Authorization = `Bearer ${process.env.SONAR_TOKEN}`;
	}
	const response = await fetch(`${SONAR}${apiPath}`, {
		headers,
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (response.status >= 400 && response.status < 500) {
		throw new UnavailableError(
			`SonarQube Cloud ${apiPath}: HTTP ${response.status}`
		);
	}
	if (!response.ok) {
		throw new Error(`SonarQube Cloud ${apiPath}: HTTP ${response.status}`);
	}
	return response.json();
}

function failedConditions(projectStatus) {
	return {
		status: projectStatus.status,
		failedConditions: (projectStatus.conditions ?? [])
			.filter((condition) => condition.status !== 'OK')
			.map(({ metricKey, actualValue, comparator, errorThreshold }) => ({
				metricKey,
				actualValue,
				comparator,
				errorThreshold,
			})),
	};
}

async function pullRequestFindings(number, timeoutMs) {
	const query = `projectKey=${PROJECT_KEY}&pullRequest=${number}`;
	const [list, status, issues, hotspots] = await Promise.all([
		sonar(
			`/api/project_pull_requests/list?project=${PROJECT_KEY}`,
			timeoutMs
		),
		sonar(`/api/qualitygates/project_status?${query}`, timeoutMs),
		sonar(
			`/api/issues/search?componentKeys=${PROJECT_KEY}&pullRequest=${number}&resolved=false&ps=100`,
			timeoutMs
		),
		sonar(
			`/api/hotspots/search?${query}&status=TO_REVIEW&ps=100`,
			timeoutMs
		),
	]);
	const entry = list.pullRequests.find((item) => item.key === String(number));
	const location = (item) =>
		`${item.component.replace(`${PROJECT_KEY}:`, '')}:${item.line ?? ''}`;
	return {
		commitSha: entry?.commit?.sha ?? null,
		gate: failedConditions(status.projectStatus),
		issues: issues.issues.map((issue) => ({
			rule: issue.rule,
			severity: issue.severity,
			type: issue.type,
			location: location(issue),
			message: issue.message,
			url: `${SONAR}/project/issues?id=${PROJECT_KEY}&pullRequest=${number}&open=${issue.key}`,
		})),
		hotspots: hotspots.hotspots.map((hotspot) => ({
			rule: hotspot.ruleKey,
			location: location(hotspot),
			message: hotspot.message,
			url: `${SONAR}/security_hotspots?id=${PROJECT_KEY}&pullRequest=${number}&hotspots=${hotspot.key}`,
		})),
	};
}

async function observePullRequest(number, sha, { remainingMs }) {
	const timeout = Math.min(REQUEST_TIMEOUT_MS, remainingMs);
	const pull = await gh(`repos/${REPO}/pulls/${number}`, timeout);
	const [suites, runs] = await Promise.all([
		gh(`repos/${REPO}/commits/${sha}/check-suites?per_page=100`, timeout),
		gh(`repos/${REPO}/commits/${sha}/check-runs?per_page=100`, timeout),
	]);
	const appRun = runs.check_runs.find((item) => item.app?.slug === SONAR_APP);
	const published =
		pull.head.sha === sha &&
		appRun?.status === 'completed' &&
		['success', 'failure'].includes(appRun.conclusion);
	return classifyPullRequest({
		sha,
		headSha: pull.head.sha,
		suites: suites.check_suites,
		runs: runs.check_runs,
		findings: published ? await pullRequestFindings(number, timeout) : null,
	});
}

async function isAncestor(ancestor, descendant) {
	try {
		await run('git', ['merge-base', '--is-ancestor', ancestor, descendant]);
		return true;
	} catch {
		return false;
	}
}

async function observeMain(mergeSha, { remainingMs }) {
	const timeout = Math.min(REQUEST_TIMEOUT_MS, remainingMs);
	await run('git', ['fetch', '--quiet', 'origin', 'main'], { timeout });
	const { analyses } = await sonar(
		`/api/project_analyses/search?project=${PROJECT_KEY}&branch=main&ps=20`,
		timeout
	);
	const containing = new Set();
	for (const analysis of analyses) {
		if (
			(await isAncestor(mergeSha, analysis.revision)) &&
			(await isAncestor(analysis.revision, 'origin/main'))
		) {
			containing.add(analysis.revision);
		}
	}
	const match = analyses.find((item) => containing.has(item.revision));
	const gates = {};
	if (match) {
		const { projectStatus } = await sonar(
			`/api/qualitygates/project_status?analysisId=${match.key}`,
			timeout
		);
		gates[match.key] = failedConditions(projectStatus);
	}
	return classifyMain({
		analyses,
		contains: (revision) => containing.has(revision),
		gateFor: (key) => gates[key],
	});
}

async function main(argv) {
	const [mode, target, ...rest] = argv;
	const shaFlag = rest.indexOf('--sha');
	if (mode === 'pr' && /^\d+$/.test(target ?? '')) {
		const sha =
			shaFlag >= 0
				? rest[shaFlag + 1]
				: (
						await gh(
							`repos/${REPO}/pulls/${target}`,
							REQUEST_TIMEOUT_MS
						)
					).head.sha;
		const report = await waitForAnalysis({
			observe: (context) => observePullRequest(target, sha, context),
		});
		return { target: { pullRequest: Number(target), sha }, ...report };
	}
	if (mode === 'main' && /^[0-9a-f]{40}$/.test(target ?? '')) {
		const report = await waitForAnalysis({
			observe: (context) => observeMain(target, context),
		});
		return { target: { branch: 'main', containsSha: target }, ...report };
	}
	throw new Error(
		'Usage: sonar-review.mjs pr <number> [--sha <full-sha>] | main <full-merge-sha>'
	);
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main(process.argv.slice(2)).then(
		(report) => {
			process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
			process.exitCode = report.state === 'passed' ? 0 : 2;
		},
		(error) => {
			process.stderr.write(`${error.message}\n`);
			process.exitCode = 1;
		}
	);
}
