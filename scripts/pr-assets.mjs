/**
 * GitHub-hosted evidence for pull requests.
 *
 * Two independent parts live here:
 *
 * 1. Generic long-lived branch storage. `ensureBranch`/`getExistingSha`/
 *    `uploadFile` publish a file to a dedicated branch via GitHub's Git Data
 *    and Contents APIs. `scripts/performance-history.mjs` uses them for the
 *    `performance-history` branch. Screenshots no longer use them: the legacy
 *    `pr-assets` branch is kept only so historical PR images keep rendering.
 *
 * 2. Screenshot attachments. Screenshots are uploaded as GitHub attachments
 *    (`gh issue comment|edit --attach`), never committed to a branch:
 *    - Before a PR exists, `uploadIssueScreenshot` attaches the PNG to a
 *      marked comment on the ticket. The marker records the implementation
 *      branch and filename, so a re-upload supersedes only that work
 *      stream's image even when several PRs share one issue.
 *    - Once the PR exists, `attachPrScreenshots` attaches the final PNGs to
 *      the PR itself and rewrites the matching `![<filename>](...)`
 *      references in its description. A new attachment is verified before
 *      the existing reference is replaced, and the description is re-read
 *      after every `gh` call because `gh` can upload some files and still
 *      exit non-zero.
 *    - `verifyPrScreenshots` checks that every image the PR description
 *      references is a resolving URL rather than a local path.
 *
 *    Images are keyed by their alt text, which is always the filename.
 *
 * Everything shells out to the already-authenticated `gh` CLI rather than a
 * raw `fetch` + token, so no new secret is needed beyond `gh auth login`.
 * `gh issue edit` works on pull requests too and, unlike `gh pr edit`, does
 * not need the `read:org` scope. Every exported function accepts injectable
 * executors so tests never touch the network.
 *
 * Run as a CLI for the PR steps:
 *
 *   node scripts/pr-assets.mjs attach --pr <n> [--issue <n>] <file>...
 *   node scripts/pr-assets.mjs verify --pr <n> [<filename>...]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Well-known empty tree SHA — every git repository has it. */
export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Default `run` executor: shells out to `gh api`, sending `body` (if given)
 * as a JSON payload on stdin and returning the parsed JSON response. Tests
 * inject a fake instead, so a call never reaches the network.
 *
 * @param {object} options
 * @param {string} options.path GitHub API path, e.g. `repos/{owner}/{repo}/branches/main`.
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
 * Ensure a long-lived storage branch exists, bootstrapping it as an empty
 * root commit (no parents, the well-known empty tree) the first time it's
 * needed. Uses only the Git Data API, so the caller's checked-out working
 * branch is never touched.
 *
 * @param {object} options
 * @param {string} options.repo `owner/repo`.
 * @param {Function} [options.run] Injected API executor (default `runGhApi`).
 * @param {string} options.branch Branch to ensure.
 * @returns {Promise<{created: boolean}>}
 */
export async function ensureBranch({ repo, run = runGhApi, branch }) {
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
 * Look up the blob `sha` of an existing file on a storage branch, so a
 * re-run can update it instead of failing a create. Returns `null` when the
 * path doesn't exist yet.
 *
 * @param {object} options
 * @param {string} options.repo `owner/repo`.
 * @param {string} options.path File path within the branch, e.g. `latest.json`.
 * @param {Function} [options.run] Injected API executor.
 * @param {string} options.branch Branch to read from.
 * @returns {Promise<string|null>}
 */
export async function getExistingSha({ repo, path, run = runGhApi, branch }) {
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
 * Create or replace a file on a storage branch via the Contents API.
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
 * @param {string} options.branch Branch to write to.
 * @returns {Promise<{path: string, sha: string, rawUrl: string}>}
 */
export async function uploadFile({
	repo,
	path,
	buffer,
	sha = null,
	message,
	run = runGhApi,
	branch,
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

// ---------------------------------------------------------------------------
// Screenshot attachments
// ---------------------------------------------------------------------------

/** Hidden marker on an issue comment that holds an early screenshot. */
const ISSUE_MARKER = 'screenshot-attachment';

/** Marker that replaces {@link ISSUE_MARKER} once a newer upload exists. */
const SUPERSEDED_MARKER = 'screenshot-attachment-superseded';

/** Temporary block that receives new PR attachments before they're verified. */
export const STAGING_START = '<!-- screenshot-staging:start -->';
export const STAGING_END = '<!-- screenshot-staging:end -->';

/** URLs `gh --attach` produces for uploaded images. */
const ATTACHMENT_URL =
	/^https:\/\/github\.com\/user-attachments\/(?:assets|files)\/[\w-]+$/;

/** Filenames double as Markdown alt text and `./<filename>` references. */
const SAFE_FILENAME = /^[\w.-]+$/;

/** True for a GitHub attachment URL, as opposed to a local path or branch URL. */
export function isAttachmentUrl(url) {
	return ATTACHMENT_URL.test(url || '');
}

/**
 * Default `gh` executor. Unlike {@link runGhApi} it never throws on a
 * non-zero exit, because an attachment command can fail after partly
 * updating the PR and the caller must inspect the result either way.
 *
 * @param {string[]} args `gh` arguments.
 * @param {object} [options]
 * @param {string} [options.input] Data written to stdin.
 * @param {string} [options.cwd] Working directory, so `./<file>` resolves.
 * @returns {{status: number, stdout: string, stderr: string}}
 */
export function runGh(args, { input, cwd } = {}) {
	const result = spawnSync('gh', args, { encoding: 'utf8', input, cwd });
	if (result.error) {
		throw result.error;
	}
	return {
		status: result.status,
		stdout: result.stdout || '',
		stderr: result.stderr || '',
	};
}

/** Run a `gh api` call and parse its JSON, throwing on a non-zero exit. */
function ghJson(gh, args, input) {
	const { status, stdout, stderr } = gh(args, { input });
	if (status !== 0) {
		throw new Error(`gh ${args[0]} ${args[1]} failed: ${stderr.trim()}`);
	}
	return stdout.trim() ? JSON.parse(stdout) : null;
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function referencePattern(filename) {
	return new RegExp(`!\\[${escapeRegExp(filename)}\\]\\(([^)\\s]+)\\)`, 'g');
}

function assertSafeFilename(filename) {
	if (!SAFE_FILENAME.test(filename)) {
		throw new Error(
			`Screenshot filename "${filename}" may only contain letters, digits, ".", "_" and "-".`
		);
	}
}

/** Every `![alt](url)` image reference in a Markdown body. */
export function listImageReferences(body) {
	return [...(body || '').matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map(
		(match) => ({ alt: match[1], url: match[2] })
	);
}

/** The URL of the last image whose alt text is `filename`, or null. */
export function findReference(body, filename) {
	const matches = [...(body || '').matchAll(referencePattern(filename))];
	return matches.length ? matches[matches.length - 1][1] : null;
}

/**
 * Point every `![filename](...)` reference at `url`, or append one when the
 * body has none yet.
 */
export function replaceReference(body, filename, url) {
	const replacement = `![${filename}](${url})`;
	const pattern = referencePattern(filename);
	if (pattern.test(body)) {
		return body.replace(referencePattern(filename), () => replacement);
	}
	return `${body.replace(/\s+$/, '')}\n\n${replacement}\n`;
}

/** Split a PR body into its content and the (possibly absent) staging block. */
export function splitStaging(body) {
	const text = body || '';
	const start = text.indexOf(STAGING_START);
	if (start === -1) {
		return { main: text, staged: '' };
	}
	const end = text.indexOf(STAGING_END, start);
	const stop = end === -1 ? text.length : end + STAGING_END.length;
	const before = text.slice(0, start).replace(/\s+$/, '');
	const after = text.slice(stop).replace(/^\s+/, '');
	return {
		main: after ? `${before}\n\n${after}` : before,
		staged: text.slice(start, stop),
	};
}

/** Append a staging block with a `./<filename>` reference per file. */
export function buildStagedBody(main, filenames) {
	const references = filenames.map((name) => `![${name}](./${name})`);
	return [
		main.replace(/\s+$/, ''),
		'',
		STAGING_START,
		...references,
		STAGING_END,
		'',
	].join('\n');
}

/** Waits between checks of a new attachment: it can 404 for 15+ seconds. */
const VERIFY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * True when `url` downloads as an image. Follows GitHub's redirect to the
 * signed storage URL, so it checks what a reader's browser would get. A
 * fresh upload can briefly 404, so failed checks are retried with backoff.
 *
 * @param {string} url Image URL.
 * @param {Function} [fetchImpl] Injected `fetch`.
 * @param {object} [options]
 * @param {number[]} [options.delays] Waits before each retry.
 * @param {Function} [options.wait] Injected sleep.
 * @returns {Promise<boolean>}
 */
export async function verifyImageUrl(
	url,
	fetchImpl = fetch,
	{ delays = VERIFY_DELAYS_MS, wait = sleep } = {}
) {
	for (let attempt = 0; attempt <= delays.length; attempt++) {
		if (attempt > 0) {
			await wait(delays[attempt - 1]);
		}
		try {
			const response = await fetchImpl(url, { redirect: 'follow' });
			const type = response.headers.get('content-type') || '';
			await response.body?.cancel?.();
			if (response.ok && /^image\//.test(type)) {
				return true;
			}
		} catch {
			// Network hiccup: treat like a not-yet-available attachment.
		}
	}
	return false;
}

function readIssueBody({ repo, number, gh }) {
	return ghJson(gh, ['api', `repos/${repo}/issues/${number}`])?.body || '';
}

function writeIssueBody({ repo, number, body, gh }) {
	ghJson(
		gh,
		[
			'api',
			'-X',
			'PATCH',
			`repos/${repo}/issues/${number}`,
			'--input',
			'-',
		],
		JSON.stringify({ body })
	);
}

function issueMarker(branch, filename, superseded = false) {
	const name = superseded ? SUPERSEDED_MARKER : ISSUE_MARKER;
	return `<!-- ${name} branch="${branch}" file="${filename}" -->`;
}

/**
 * Active (not superseded) screenshot comments on `issue` for one branch and
 * filename, oldest first.
 */
export function findIssueScreenshotComments({
	repo,
	issue,
	branch,
	filename,
	gh = runGh,
}) {
	const pages = ghJson(gh, [
		'api',
		'--paginate',
		'--slurp',
		`repos/${repo}/issues/${issue}/comments`,
	]);
	const marker = issueMarker(branch, filename);
	return (pages || [])
		.flat()
		.filter((comment) => (comment.body || '').includes(marker));
}

/** The newest issue attachment URL for one branch and filename, or null. */
export function findIssueScreenshot(options) {
	const comments = findIssueScreenshotComments(options);
	for (const comment of comments.reverse()) {
		const url = findReference(comment.body, options.filename);
		if (isAttachmentUrl(url)) {
			return url;
		}
	}
	return null;
}

/** Copy `file` into a fresh directory so `gh` can attach it as `./<name>`. */
async function stageFile(file, workDir) {
	const filename = basename(file);
	assertSafeFilename(filename);
	const dir = workDir || (await mkdtemp(join(tmpdir(), 'pr-screenshots-')));
	await copyFile(file, join(dir, filename));
	return { filename, dir };
}

/**
 * Attach a screenshot to a marked comment on `issue`, before the
 * implementation PR exists. The marker records `branch` and the filename; a
 * successful upload supersedes earlier comments for the same pair only, so
 * separate PRs on one issue never overwrite each other's images.
 *
 * @param {object} options
 * @param {string} options.repo `owner/repo`.
 * @param {number|string} options.issue Ticket number.
 * @param {string} options.branch Implementation branch.
 * @param {string} options.file Local PNG path; it is copied, never moved.
 * @param {Function} [options.gh] Injected `gh` executor.
 * @param {Function} [options.fetchImpl] Injected `fetch`.
 * @param {object} [options.verifyOptions] Retry options for {@link verifyImageUrl}.
 * @returns {Promise<{url: string, commentUrl: string, superseded: number}>}
 */
export async function uploadIssueScreenshot({
	repo,
	issue,
	branch,
	file,
	gh = runGh,
	fetchImpl = fetch,
	verifyOptions,
}) {
	const { filename, dir } = await stageFile(file);
	const previous = findIssueScreenshotComments({
		repo,
		issue,
		branch,
		filename,
		gh,
	});

	const body = [
		issueMarker(branch, filename),
		`Screenshot \`${filename}\` for branch \`${branch}\`. The final copy is attached to the implementation PR.`,
		'',
		`![${filename}](./${filename})`,
		'',
	].join('\n');
	const result = gh(
		[
			'issue',
			'comment',
			String(issue),
			'-R',
			repo,
			'--body-file',
			'-',
			'--attach',
			`./${filename}#${filename}`,
		],
		{ input: body, cwd: dir }
	);

	const posted = /https:\/\/\S+#issuecomment-(\d+)/.exec(result.stdout);
	if (!posted) {
		throw new Error(
			`Attaching ${filename} to #${issue} failed (gh exit ${
				result.status
			}): ${result.stderr.trim()}`
		);
	}

	const [commentUrl, commentId] = posted;
	const comment = ghJson(gh, [
		'api',
		`repos/${repo}/issues/comments/${commentId}`,
	]);
	const url = findReference(comment?.body, filename);
	if (
		!isAttachmentUrl(url) ||
		!(await verifyImageUrl(url, fetchImpl, verifyOptions))
	) {
		// Don't leave a comment behind that looks like evidence but isn't.
		gh([
			'api',
			'-X',
			'DELETE',
			`repos/${repo}/issues/comments/${commentId}`,
		]);
		throw new Error(
			`Attaching ${filename} to #${issue} did not produce a working attachment (gh exit ${result.status}, reference: ${url}).`
		);
	}

	for (const old of previous) {
		ghJson(
			gh,
			[
				'api',
				'-X',
				'PATCH',
				`repos/${repo}/issues/comments/${old.id}`,
				'--input',
				'-',
			],
			JSON.stringify({
				body: `${issueMarker(
					branch,
					filename,
					true
				)}\nSuperseded by ${commentUrl}.`,
			})
		);
	}

	return { url, commentUrl, superseded: previous.length };
}

/** The open PR whose head is `branch`, or null. */
export function findPullRequestForBranch({ repo, branch, gh = runGh }) {
	const owner = repo.split('/')[0];
	const pulls = ghJson(gh, [
		'api',
		`repos/${repo}/pulls?state=open&head=${encodeURIComponent(
			`${owner}:${branch}`
		)}`,
	]);
	return pulls?.[0]?.number ?? null;
}

/**
 * The implementation branch and ticket of a PR, for retrieving early issue
 * attachments. The ticket comes from `Closes|Fixes|Resolves|Refs #N`.
 */
function readPullRequestContext({ repo, pr, gh }) {
	const pull = ghJson(gh, ['api', `repos/${repo}/pulls/${pr}`]);
	const ticket = /\b(?:Closes|Fixes|Resolves|Refs)\s+#(\d+)/i.exec(
		pull?.body || ''
	);
	return { branch: pull?.head?.ref ?? null, issue: ticket?.[1] ?? null };
}

async function downloadAttachment(url, target, fetchImpl) {
	const response = await fetchImpl(url, { redirect: 'follow' });
	if (!response.ok) {
		throw new Error(`Downloading ${url} failed (HTTP ${response.status}).`);
	}
	await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

/**
 * Attach final screenshots to the implementation PR and point its
 * description's `![<filename>](...)` references at them.
 *
 * New files go into a staging block first. The description is re-read after
 * the `gh` call whatever its exit status, and each staged URL is verified
 * before it replaces the existing reference — so a failed replacement never
 * breaks a working image. Only files still missing are retried. Throws, after
 * cleaning up the staging block, when any file could not be attached.
 *
 * A path that doesn't exist locally is fetched from its marked issue
 * attachment for the PR's branch.
 *
 * @param {object} options
 * @param {string} options.repo `owner/repo`.
 * @param {number|string} options.pr Implementation PR number.
 * @param {string[]} options.files Local PNG paths; copied, never moved.
 * @param {number|string} [options.issue] Ticket, when the PR body lacks `Closes #N`.
 * @param {Function} [options.gh] Injected `gh` executor.
 * @param {Function} [options.fetchImpl] Injected `fetch`.
 * @param {object} [options.verifyOptions] Retry options for {@link verifyImageUrl}.
 * @param {number} [options.maxAttempts] Upload attempts per file (default 3).
 * @param {Function} [options.log] Progress logger.
 * @returns {Promise<Record<string, string>>} Filename → attachment URL.
 */
export async function attachPrScreenshots({
	repo,
	pr,
	files,
	issue = null,
	gh = runGh,
	fetchImpl = fetch,
	verifyOptions,
	maxAttempts = 3,
	log = () => {},
}) {
	const workDir = await mkdtemp(join(tmpdir(), 'pr-screenshots-'));
	const pending = new Set();
	let context = null;

	for (const file of files) {
		const filename = basename(file);
		assertSafeFilename(filename);
		if (pending.has(filename)) {
			throw new Error(`${filename} is listed more than once.`);
		}

		if (existsSync(file)) {
			await stageFile(file, workDir);
		} else {
			context ??= readPullRequestContext({ repo, pr, gh });
			const ticket = issue ?? context.issue;
			const url =
				ticket && context.branch
					? findIssueScreenshot({
							repo,
							issue: ticket,
							branch: context.branch,
							filename,
							gh,
					  })
					: null;
			if (!url) {
				throw new Error(
					`${file} does not exist and no issue attachment for branch ${
						context.branch
					} was found${ticket ? ` on #${ticket}` : ''}.`
				);
			}
			await downloadAttachment(url, join(workDir, filename), fetchImpl);
			log(`Retrieved ${filename} from its #${ticket} attachment.`);
		}
		pending.add(filename);
	}

	const attached = {};
	const failures = {};
	for (let attempt = 1; attempt <= maxAttempts && pending.size; attempt++) {
		const names = [...pending];
		const { main } = splitStaging(readIssueBody({ repo, number: pr, gh }));
		const args = [
			'issue',
			'edit',
			String(pr),
			'-R',
			repo,
			'--body-file',
			'-',
		];
		for (const name of names) {
			args.push('--attach', `./${name}#${name}`);
		}

		const result = gh(args, {
			input: buildStagedBody(main, names),
			cwd: workDir,
		});
		if (result.status !== 0) {
			log(
				`Attempt ${attempt}: gh exited ${
					result.status
				}: ${result.stderr.trim()}`
			);
		}

		// Inspect the description whatever gh reported: it can upload some
		// files and still exit non-zero.
		const current = readIssueBody({ repo, number: pr, gh });
		const { main: content, staged } = splitStaging(current);
		let body = content;
		for (const name of names) {
			const url = findReference(staged, name);
			if (!isAttachmentUrl(url)) {
				failures[name] = 'not uploaded';
			} else if (!(await verifyImageUrl(url, fetchImpl, verifyOptions))) {
				failures[name] = `${url} does not resolve`;
			} else {
				body = replaceReference(body, name, url);
				attached[name] = url;
				delete failures[name];
				pending.delete(name);
			}
		}

		if (body !== current) {
			writeIssueBody({ repo, number: pr, body, gh });
		}
	}

	if (pending.size) {
		const missing = [...pending]
			.map((name) => `  ${name}: ${failures[name]}`)
			.join('\n');
		const error = new Error(
			`Screenshot evidence on PR #${pr} is incomplete. Local files are unchanged; re-run to retry.\n${missing}`
		);
		error.attached = attached;
		error.missing = [...pending];
		throw error;
	}

	return attached;
}

/**
 * Check that every image the PR description references resolves, that none
 * still points at a local path, that no staging block is left over, and that
 * each `expected` filename is referenced.
 *
 * @returns {Promise<{checked: number, problems: string[]}>}
 */
export async function verifyPrScreenshots({
	repo,
	pr,
	expected = [],
	gh = runGh,
	fetchImpl = fetch,
	verifyOptions,
}) {
	const body = readIssueBody({ repo, number: pr, gh });
	const problems = [];
	if (body.includes(STAGING_START)) {
		problems.push('the description still has an unfinished staging block');
	}

	const references = listImageReferences(splitStaging(body).main);
	for (const name of expected) {
		if (!references.some((reference) => reference.alt === name)) {
			problems.push(`${name}: not referenced`);
		}
	}
	for (const { alt, url } of references) {
		if (!/^https?:\/\//.test(url)) {
			problems.push(`${alt}: ${url} is a local path, not an attachment`);
		} else if (!(await verifyImageUrl(url, fetchImpl, verifyOptions))) {
			problems.push(`${alt}: ${url} does not resolve`);
		}
	}

	return { checked: references.length, problems };
}

/** `owner/repo` of the current checkout. */
export function resolveRepo() {
	return execFileSync(
		'gh',
		['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'],
		{ encoding: 'utf8' }
	).trim();
}

export function parseCliArgs(argv) {
	const [command, ...rest] = argv;
	const opts = { pr: null, issue: null };
	const positional = [];
	for (let i = 0; i < rest.length; i++) {
		if (rest[i] === '--pr') {
			opts.pr = rest[++i];
		} else if (rest[i] === '--issue') {
			opts.issue = rest[++i];
		} else {
			positional.push(rest[i]);
		}
	}
	return { command, opts, positional };
}

async function main() {
	const { command, opts, positional } = parseCliArgs(process.argv.slice(2));
	const valid =
		opts.pr &&
		(command === 'verify' || (command === 'attach' && positional.length));
	if (!valid) {
		console.error(
			'Usage:\n' +
				'  node scripts/pr-assets.mjs attach --pr <n> [--issue <n>] <file>...\n' +
				'  node scripts/pr-assets.mjs verify --pr <n> [<filename>...]'
		);
		process.exitCode = 2;
		return;
	}

	const repo = resolveRepo();
	if (command === 'attach') {
		const attached = await attachPrScreenshots({
			repo,
			pr: opts.pr,
			issue: opts.issue,
			files: positional.map((file) => resolve(file)),
			log: (message) => console.error(message),
		});
		for (const [name, url] of Object.entries(attached)) {
			console.log(`Attached: ${name} → ${url}`);
		}
		return;
	}

	const { checked, problems } = await verifyPrScreenshots({
		repo,
		pr: opts.pr,
		expected: positional.map((file) => basename(file)),
	});
	if (problems.length) {
		console.error(
			`PR #${
				opts.pr
			} screenshot evidence is incomplete:\n  ${problems.join('\n  ')}`
		);
		process.exitCode = 1;
		return;
	}
	console.log(`All ${checked} images on PR #${opts.pr} resolve.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error.message || error);
		process.exitCode = 1;
	});
}
