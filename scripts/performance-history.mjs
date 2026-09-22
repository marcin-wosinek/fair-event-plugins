#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Publish a scripts/performance-runner.mjs JSON report to the long-lived
 * `performance-history` branch, so `.github/workflows/performance.yml`
 * leaves behind a growing, versioned record instead of a run whose only
 * trace is a 30-day artifact. Reuses the same Contents API primitives as
 * scripts/pr-assets.mjs (see that file for why `gh api` over a raw fetch +
 * token), just pointed at a different branch.
 *
 * Writes two things per run:
 *   - `<date>-<runId>.json` — one immutable entry per run, never overwritten.
 *   - `latest.json` — always replaced, a stable link to the newest report.
 *
 * The JSON contains only plugin slugs, scenario names, and numeric
 * performance figures — no participant/user data — so publishing it to this
 * public repo carries the same "synthetic data only" posture already
 * documented for pr-assets screenshots, with nothing further to redact.
 */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { ensureBranch, getExistingSha, uploadFile } from './pr-assets.mjs';

/** Long-lived branch that holds performance-runner report history. */
export const HISTORY_BRANCH = 'performance-history';

/**
 * @param {object} options
 * @param {string} options.repo `owner/repo`.
 * @param {Buffer} options.buffer JSON report bytes (from performance-runner.mjs --json-out).
 * @param {string} options.runId Unique identifier for this run, e.g. a GitHub Actions run id.
 * @param {Function} [options.run] Injected API executor (default `runGhApi` via pr-assets.mjs).
 * @returns {Promise<{entryUrl: string, latestUrl: string}>}
 */
export async function publishPerformanceHistory({ repo, buffer, runId, run }) {
	await ensureBranch({ repo, run, branch: HISTORY_BRANCH });

	const date = new Date().toISOString().slice(0, 10);
	const entryPath = `${date}-${runId}.json`;
	const entry = await uploadFile({
		repo,
		path: entryPath,
		buffer,
		message: `Add performance report for run ${runId}`,
		run,
		branch: HISTORY_BRANCH,
	});

	const latestSha = await getExistingSha({
		repo,
		path: 'latest.json',
		run,
		branch: HISTORY_BRANCH,
	});
	const latest = await uploadFile({
		repo,
		path: 'latest.json',
		buffer,
		sha: latestSha,
		message: `Update latest.json to run ${runId}`,
		run,
		branch: HISTORY_BRANCH,
	});

	return { entryUrl: entry.rawUrl, latestUrl: latest.rawUrl };
}

async function main() {
	const [, , filePath, runId] = process.argv;
	if (!filePath || !runId) {
		console.error(
			'Usage: node scripts/performance-history.mjs <report.json> <run-id>'
		);
		process.exitCode = 2;
		return;
	}

	const repo = execFileSync(
		'gh',
		['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
		{ encoding: 'utf8' }
	).trim();

	const buffer = await readFile(filePath);
	const result = await publishPerformanceHistory({ repo, buffer, runId });

	console.log(`Published: ${result.entryUrl}`);
	console.log(`Latest:    ${result.latestUrl}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
