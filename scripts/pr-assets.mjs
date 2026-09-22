/**
 * GitHub-hosted long-lived branch storage.
 *
 * `ensureBranch`/`getExistingSha`/`uploadFile` publish a file to a
 * dedicated, long-lived branch via GitHub's Git Data and Contents APIs,
 * each accepting a `branch` override (default `pr-assets`). This backs two
 * consumers: `publishScreenshot` below (responsive-UI screenshots, one
 * subdirectory per issue: `pr-assets/<issue-number>/<filename>`) and
 * `scripts/performance-history.mjs` (performance-runner JSON reports, on
 * the separate `performance-history` branch).
 *
 * The issue number (not the PR number) is the screenshot identifier:
 * before-state screenshots are captured before a PR exists, and the
 * eventual PR always closes exactly one issue.
 *
 * Uploads shell out to the already-authenticated `gh` CLI (`gh api`) rather
 * than a raw `fetch` + token, so no new secret is needed beyond `gh auth
 * login`. Every exported function accepts an injectable `run` executor so
 * tests can fake the GitHub API without touching the network.
 */

import { execFileSync } from 'node:child_process';

/** Well-known empty tree SHA — every git repository has it. */
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Long-lived branch that holds all PR screenshot evidence. */
export const ASSETS_BRANCH = 'pr-assets';

/**
 * Default `run` executor: shells out to `gh api`, sending `body` (if given)
 * as a JSON payload on stdin and returning the parsed JSON response. Tests
 * inject a fake instead, so a call never reaches the network.
 *
 * @param {object} options
 * @param {string} options.path GitHub API path, e.g. `repos/{owner}/{repo}/branches/pr-assets`.
 * @param {'GET'|'POST'|'PUT'} [options.method] HTTP method (default GET).
 * @param {object} [options.body] JSON request body.
 * @returns {object|null} Parsed JSON response, or null for an empty body.
 */
export function runGhApi({ path, method = 'GET', body }) {
	const args = ['api', path, '-X', method];
	if (body !== undefined) {
		args.push('--input', '-');
	}

	const output = execFileSync('gh', args, {
		encoding: 'utf8',
		input: body !== undefined ? JSON.stringify(body) : undefined,
	});

	return output ? JSON.parse(output) : null;
}

/** True when `error` (thrown by a failed `run` call) represents a 404. */
export function isNotFoundError(error) {
	const message = `${error?.stderr || error?.message || ''}`;
	return /HTTP 404/.test(message) || /\bNot Found\b/.test(message);
}

/**
 * Ensure the shared `pr-assets` branch exists, bootstrapping it as an empty
 * root commit (no parents, the well-known empty tree) the first time it's
 * needed. Uses only the Git Data API, so the caller's checked-out working
 * branch is never touched.
 *
 * @param {object} options
 * @param {string} options.repo `owner/repo`.
 * @param {Function} [options.run] Injected API executor (default `runGhApi`).
 * @param {string} [options.branch] Branch to ensure (default `pr-assets`).
 * @returns {Promise<{created: boolean}>}
 */
export async function ensureBranch({
	repo,
	run = runGhApi,
	branch = ASSETS_BRANCH,
}) {
	try {
		await run({ path: `repos/${repo}/branches/${branch}` });
		return { created: false };
	} catch (error) {
		if (!isNotFoundError(error)) {
			throw error;
		}
	}

	const commit = await run({
		method: 'POST',
		path: `repos/${repo}/git/commits`,
		body: {
			message: `Initialize ${branch} branch`,
			tree: EMPTY_TREE_SHA,
			parents: [],
		},
	});

	await run({
		method: 'POST',
		path: `repos/${repo}/git/refs`,
		body: { ref: `refs/heads/${branch}`, sha: commit.sha },
	});

	return { created: true };
}

/**
 * Look up the blob `sha` of an existing file on the `pr-assets` branch, so a
 * re-run can update it instead of failing a create. Returns `null` when the
 * path doesn't exist yet.
 *
 * @param {object} options
 * @param {string} options.repo `owner/repo`.
 * @param {string} options.path File path within the branch, e.g. `1554/before-desktop.png`.
 * @param {Function} [options.run] Injected API executor.
 * @param {string} [options.branch] Branch to read from (default `pr-assets`).
 * @returns {Promise<string|null>}
 */
export async function getExistingSha({
	repo,
	path,
	run = runGhApi,
	branch = ASSETS_BRANCH,
}) {
	try {
		const result = await run({
			path: `repos/${repo}/contents/${path}?ref=${branch}`,
		});
		return result?.sha ?? null;
	} catch (error) {
		if (isNotFoundError(error)) {
			return null;
		}
		throw error;
	}
}

/**
 * Create or replace a file on the `pr-assets` branch via the Contents API.
 * Pass the `sha` from {@link getExistingSha} to update an existing file
 * safely; omit it to create a new one. Rejects (never resolves with a
 * partial success) when the response doesn't confirm the write.
 *
 * @param {object} options
 * @param {string} options.repo `owner/repo`.
 * @param {string} options.path File path within the branch.
 * @param {Buffer} options.buffer File content.
 * @param {string|null} [options.sha] Existing blob sha, when replacing.
 * @param {string} [options.message] Commit message.
 * @param {Function} [options.run] Injected API executor.
 * @param {string} [options.branch] Branch to write to (default `pr-assets`).
 * @returns {Promise<{path: string, sha: string, rawUrl: string}>}
 */
export async function uploadFile({
	repo,
	path,
	buffer,
	sha = null,
	message,
	run = runGhApi,
	branch = ASSETS_BRANCH,
}) {
	const body = {
		message: message || `Add ${path}`,
		content: buffer.toString('base64'),
		branch,
	};
	if (sha) {
		body.sha = sha;
	}

	const result = await run({
		method: 'PUT',
		path: `repos/${repo}/contents/${path}`,
		body,
	});

	const contentSha = result?.content?.sha;
	if (!contentSha) {
		throw new Error(
			`Upload of ${path} did not return a content sha; response: ${JSON.stringify(
				result
			)}`
		);
	}

	return {
		path,
		sha: contentSha,
		rawUrl: `https://raw.githubusercontent.com/${repo}/${branch}/${path}`,
	};
}

/**
 * End-to-end: ensure the branch exists, look up any existing file at
 * `<issue>/<filename>`, then create or replace it. This is what
 * `scripts/screenshot.js`'s `--upload github` target calls.
 *
 * @param {object} options
 * @param {string} options.repo `owner/repo`.
 * @param {number|string} options.issue Issue number the screenshot belongs to.
 * @param {string} options.filename Screenshot filename, e.g. `before-desktop.png`.
 * @param {Buffer} options.buffer File content.
 * @param {Function} [options.run] Injected API executor.
 * @returns {Promise<{path: string, sha: string, rawUrl: string}>}
 */
export async function publishScreenshot({
	repo,
	issue,
	filename,
	buffer,
	run = runGhApi,
}) {
	await ensureBranch({ repo, run });

	const path = `${issue}/${filename}`;
	const sha = await getExistingSha({ repo, path, run });

	return uploadFile({
		repo,
		path,
		buffer,
		sha,
		message: `Add ${filename} for #${issue}`,
		run,
	});
}
