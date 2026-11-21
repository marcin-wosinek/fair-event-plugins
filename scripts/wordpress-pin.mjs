/**
 * Keep the WordPress release pinned in `.wp-env.json` current (#2393).
 *
 * An unpinned `core` makes every `wp-env start` and `wp-env run` ask
 * WordPress.org's stable-check endpoint for the latest release, and a dropped
 * request fails the test that ran the command. The pin removes that lookup;
 * this script, run daily by `.github/workflows/update-wordpress-pin.yml`,
 * proposes a new pin when WordPress ships a newer stable release.
 *
 *   node scripts/wordpress-pin.mjs check [--open-pr-core=<core>] [--write]
 *        [--body-file=<path>]
 *
 * Prints `current=`, `latest=` and `action=` lines for $GITHUB_OUTPUT.
 * `action` is `none` (pin current, or newer than WordPress.org reports),
 * `skip` (the open update PR already proposes this release), `create` (no
 * open update PR) or `update` (the open PR proposes an older release).
 * `--open-pr-core` is the `core` value on the open update PR's branch, if
 * there is one. With `--write`, a `create`/`update` action rewrites `core` in
 * `.wp-env.json` and writes the PR description to `--body-file`.
 *
 * Any failed or ambiguous lookup exits non-zero before anything is written.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const STABLE_CHECK_URL =
	'https://api.wordpress.org/core/stable-check/1.0/';
export const VERSION_HISTORY_URL =
	'https://wordpress.org/documentation/article/wordpress-versions/';
export const RELEASE_ARCHIVE_URL = 'https://wordpress.org/download/releases/';
export const CORE_PREFIX = 'WordPress/WordPress#';
const CONFIG_PATH = fileURLToPath(new URL('../.wp-env.json', import.meta.url));
const VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)?$/;
const REQUEST_TIMEOUT_MS = 30_000;

export class PinError extends Error {}

/**
 * Compare two numeric WordPress versions; `7.1` equals `7.1.0`.
 *
 * @param {string} a A version like `7.1.5`.
 * @param {string} b Another version.
 * @return {number} Negative, zero or positive, like a sort comparator.
 */
export function compareVersions(a, b) {
	const parts = [a, b].map((version) => {
		if (!VERSION_PATTERN.test(version)) {
			throw new PinError(`Not a stable WordPress version: "${version}"`);
		}
		return version.split('.').map(Number);
	});
	for (let index = 0; index < 3; index++) {
		const difference = (parts[0][index] ?? 0) - (parts[1][index] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

/**
 * The single release the stable-check response marks `latest`.
 *
 * @param {unknown} response Parsed stable-check JSON: `{ "7.1.5": "latest", … }`.
 * @return {string} The latest stable version.
 */
export function parseStableCheck(response) {
	if (!response || typeof response !== 'object' || Array.isArray(response)) {
		throw new PinError('stable-check did not return a JSON object.');
	}
	const latest = Object.entries(response)
		.filter(([, status]) => status === 'latest')
		.map(([version]) => version);
	if (latest.length !== 1) {
		throw new PinError(
			`stable-check marked ${latest.length} releases as latest; expected exactly one.`
		);
	}
	if (!VERSION_PATTERN.test(latest[0])) {
		throw new PinError(
			`stable-check's latest release "${latest[0]}" is not a numeric stable version.`
		);
	}
	return latest[0];
}

/**
 * The version a `core` value pins.
 *
 * @param {unknown} core `.wp-env.json` `core`, e.g. `WordPress/WordPress#7.1.5`.
 * @return {string} The pinned version.
 */
export function pinnedVersion(core) {
	const version =
		typeof core === 'string' && core.startsWith(CORE_PREFIX)
			? core.slice(CORE_PREFIX.length)
			: null;
	if (version === null || !VERSION_PATTERN.test(version)) {
		throw new PinError(
			`.wp-env.json core must be "${CORE_PREFIX}<version>", got ${JSON.stringify(core)}.`
		);
	}
	return version;
}

/**
 * Decide what the daily check does.
 *
 * @param {Object}      options
 * @param {string}      options.current   The pinned version on main.
 * @param {string}      options.latest    The latest stable version.
 * @param {string|null} options.openPrCore `core` on the open update PR, if any.
 * @return {'none'|'skip'|'create'|'update'} The action.
 */
export function decideAction({ current, latest, openPrCore }) {
	if (compareVersions(latest, current) <= 0) {
		return 'none';
	}
	if (!openPrCore) {
		return 'create';
	}
	let proposed;
	try {
		proposed = pinnedVersion(openPrCore);
	} catch {
		// A hand-edited update branch: replace it with a well-formed pin.
		return 'update';
	}
	return compareVersions(proposed, latest) === 0 ? 'skip' : 'update';
}

/**
 * Replace `core` in the `.wp-env.json` text, keeping its formatting.
 *
 * @param {string} text    The file's contents.
 * @param {string} version The release to pin.
 * @return {string} The updated contents.
 */
export function setCoreInConfig(text, version) {
	const core = JSON.stringify(`${CORE_PREFIX}${version}`);
	const pattern = /("core"\s*:\s*)"[^"]*"/;
	if (!pattern.test(text)) {
		throw new PinError(
			'.wp-env.json has no string "core" entry to update.'
		);
	}
	const updated = text.replace(pattern, `$1${core}`);
	if (JSON.parse(updated).core !== `${CORE_PREFIX}${version}`) {
		throw new PinError('Updating .wp-env.json core produced invalid JSON.');
	}
	return updated;
}

/**
 * The announcement the official version history links for a release.
 *
 * @param {string} html    The version history page.
 * @param {string} version The release.
 * @return {string|null} The announcement URL, or null if not listed yet.
 */
export function findAnnouncement(html, version) {
	const escaped = version.replaceAll('.', '\\.');
	const row = new RegExp(
		`<tr>\\s*<td>\\s*<a [^>]*>${escaped}</a>[\\s\\S]*?</tr>`
	).exec(html);
	const link = row
		? /href="(https:\/\/wordpress\.org\/news\/[^"]+)"/.exec(row[0])
		: null;
	return link ? link[1] : null;
}

/**
 * The update PR's description.
 *
 * @param {Object}      options
 * @param {string}      options.current      The pinned version on main.
 * @param {string}      options.latest       The proposed version.
 * @param {string|null} options.announcement The release announcement URL.
 * @return {string} Markdown.
 */
export function prBody({ current, latest, announcement }) {
	const link = announcement
		? `Release announcement: ${announcement}`
		: `The release announcement is not listed in the [WordPress version history](${VERSION_HISTORY_URL}) yet; see the [release archive](${RELEASE_ARCHIVE_URL}).`;
	return `## Summary

- Update the WordPress release the wp-env development and tests sites run from **${current}** to **${latest}**.
- ${link}

Opened by the daily \`update-wordpress-pin\` workflow (#2393) as soon as WordPress.org reported ${latest} as the latest stable release. Merge it once the regular CI suites pass, the same as any dependency update.

## Test plan

- [ ] The regular API and E2E suites pass on this PR; a failure here is a compatibility break with WordPress ${latest}.
- [ ] Locally, after merging: \`npx wp-env start\`, then \`npx wp-env run tests-cli wp core version\` prints ${latest} (TESTING.md § WordPress release).
`;
}

async function fetchWithTimeout(url, fetchImpl) {
	let response;
	try {
		response = await fetchImpl(url, {
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			headers: { 'user-agent': 'fair-event-plugins-wordpress-pin' },
		});
	} catch (error) {
		throw new PinError(`Request to ${url} failed: ${error.message}`);
	}
	if (!response.ok) {
		throw new PinError(
			`Request to ${url} returned HTTP ${response.status}.`
		);
	}
	return response;
}

/**
 * @param {Function} fetchImpl A `fetch` implementation.
 * @return {Promise<string>} The latest stable WordPress version.
 */
export async function fetchLatestVersion(fetchImpl = fetch) {
	const response = await fetchWithTimeout(STABLE_CHECK_URL, fetchImpl);
	let json;
	try {
		json = await response.json();
	} catch (error) {
		throw new PinError(
			`stable-check returned invalid JSON: ${error.message}`
		);
	}
	return parseStableCheck(json);
}

/**
 * Best effort: a missing announcement links the release archive instead.
 *
 * @param {string}   version   The release.
 * @param {Function} fetchImpl A `fetch` implementation.
 * @param {Function} warn      Logger for a failed lookup.
 * @return {Promise<string|null>} The announcement URL.
 */
export async function fetchAnnouncement(version, fetchImpl = fetch, warn) {
	try {
		const response = await fetchWithTimeout(VERSION_HISTORY_URL, fetchImpl);
		return findAnnouncement(await response.text(), version);
	} catch (error) {
		warn?.(`Could not read the version history: ${error.message}`);
		return null;
	}
}

export function parseArgs(argv) {
	const [command, ...rest] = argv;
	if (command !== 'check') {
		throw new PinError(
			'Usage: wordpress-pin.mjs check [--open-pr-core=<core>] [--write] [--body-file=<path>]'
		);
	}
	const options = { write: false, openPrCore: null, bodyFile: null };
	for (const arg of rest) {
		if (arg === '--write') {
			options.write = true;
		} else if (arg.startsWith('--open-pr-core=')) {
			options.openPrCore = arg.slice('--open-pr-core='.length) || null;
		} else if (arg.startsWith('--body-file=')) {
			options.bodyFile = arg.slice('--body-file='.length);
		} else {
			throw new PinError(`Unknown argument: ${arg}`);
		}
	}
	if (options.write && !options.bodyFile) {
		throw new PinError('--write needs --body-file.');
	}
	return options;
}

/**
 * @param {Object}   options    Parsed arguments.
 * @param {Object}   deps
 * @param {Function} deps.fetch     A `fetch` implementation.
 * @param {string}   deps.configPath Path to `.wp-env.json`.
 * @param {Function} deps.log       Output line writer.
 * @param {Function} deps.warn      Warning writer.
 * @return {Promise<Object>} `{ current, latest, action }`.
 */
export async function run(
	options,
	{
		fetch: fetchImpl = fetch,
		configPath = CONFIG_PATH,
		log = console.log,
		warn = console.warn,
	} = {}
) {
	const text = await readFile(configPath, 'utf8');
	const current = pinnedVersion(JSON.parse(text).core);
	const latest = await fetchLatestVersion(fetchImpl);
	const action = decideAction({
		current,
		latest,
		openPrCore: options.openPrCore,
	});
	if (compareVersions(latest, current) < 0) {
		warn(
			`::warning::.wp-env.json pins WordPress ${current}, newer than the latest stable release ${latest}; leaving it unchanged.`
		);
	}
	if (options.write && (action === 'create' || action === 'update')) {
		const announcement = await fetchAnnouncement(latest, fetchImpl, warn);
		const updated = setCoreInConfig(text, latest);
		await writeFile(
			options.bodyFile,
			prBody({ current, latest, announcement })
		);
		await writeFile(configPath, updated);
	}
	log(`current=${current}`);
	log(`latest=${latest}`);
	log(`action=${action}`);
	return { current, latest, action };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		await run(parseArgs(process.argv.slice(2)));
	} catch (error) {
		console.error(
			`::error::${error instanceof PinError ? error.message : error.stack}`
		);
		process.exitCode = 1;
	}
}
