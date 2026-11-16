#!/usr/bin/env node
/* eslint-disable no-console */

// Post-deploy check of the Mollie OAuth proxy on fair-event-plugins.com
// (#2290). Every connected site refreshes its Mollie token through the
// proxy, and a paused or inactive Fair Platform makes the proxy URLs fall
// through to the homepage without any PHP error. This check passes only
// when:
//
// - GET /wp-json/fair-platform/v1/health answers 200 JSON with the proxy's
//   service identifier and status "ok";
// - an empty POST to /oauth/refresh answers the proxy's own 400 JSON
//   "Missing refresh_token". It sends no token, real or dummy, so the proxy
//   returns before contacting Mollie.
//
// Redirects are never followed: a redirect, HTML, a missing route, malformed
// JSON, a timeout or any other status fails. Each attempt runs both checks;
// the last attempt's failures are reported and the exit code is 1.
//
// Usage: node scripts/verify-oauth-proxy.mjs --url=https://fair-event-plugins.com
//          [--attempts=5] [--delay=10000] [--timeout=15000]

import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const HEALTH_PATH = '/wp-json/fair-platform/v1/health';
export const REFRESH_PATH = '/oauth/refresh';
export const SERVICE = 'fair-platform-oauth-proxy';

const PAUSED_HINT =
	'Fair Platform is paused (another Fair plugin bundles an older shared library; update every Fair plugin on the site; see PHP_PATTERNS.md § Shared Package) or inactive (wp plugin list).';
const REWRITE_HINT =
	'Fair Platform is paused or inactive, or its rewrite rules are missing (wp rewrite flush).';
const UNHEALTHY_HINT =
	'Fair Platform is running but unhealthy: check MOLLIE_CLIENT_ID and MOLLIE_CLIENT_SECRET in wp-config.php and that the plugin ships its vendor/ Mollie library.';

/**
 * A URL safe to print: origin and path, without query or fragment.
 *
 * @param {string} value URL.
 * @param {string} base  Base for relative URLs.
 * @return {string} Printable URL.
 */
function printable(value, base) {
	try {
		const url = new URL(value, base);
		return `${url.origin}${url.pathname}`;
	} catch {
		return '(unparseable location)';
	}
}

/**
 * Make one request without following redirects.
 *
 * @param {Object}   options           Options.
 * @param {Function} options.fetch     Fetch implementation.
 * @param {string}   options.url       URL.
 * @param {Object}   options.init      Fetch init.
 * @param {number}   options.timeoutMs Timeout.
 * @return {Promise<{response?: Response, text?: string, error?: string}>} Result.
 */
async function send({ fetch, url, init, timeoutMs }) {
	try {
		const response = await fetch(url, {
			...init,
			redirect: 'manual',
			cache: 'no-store',
			signal: AbortSignal.timeout(timeoutMs),
		});
		const text = await response.text();
		return { response, text };
	} catch (error) {
		if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
			return { error: `timed out after ${timeoutMs} ms` };
		}
		const code = error?.cause?.code || error?.name || 'error';
		return { error: `request failed (${code})` };
	}
}

/**
 * Parse a JSON body when the response says it is JSON.
 *
 * @param {Response} response Response.
 * @param {string}   text     Body.
 * @return {{json?: *, problem?: string}} Parsed body or why it isn't usable.
 */
function readJson(response, text) {
	const type = response.headers.get('content-type') || '(none)';
	if (!/^application\/json\b/i.test(type)) {
		return {
			problem: `answered ${type.split(';')[0]} (HTTP ${response.status}), not the proxy's JSON`,
		};
	}
	try {
		return { json: JSON.parse(text) };
	} catch {
		return { problem: `answered malformed JSON (HTTP ${response.status})` };
	}
}

/**
 * Describe a redirect, if the response is one.
 *
 * @param {Response} response Response.
 * @param {string}   url      Request URL.
 * @return {string|null} Description.
 */
function redirectProblem(response, url) {
	if (response.status < 300 || response.status >= 400) {
		return null;
	}
	const location = response.headers.get('location');
	return `redirected (HTTP ${response.status}) to ${
		location ? printable(location, url) : '(no location)'
	}`;
}

/**
 * Check the health route.
 *
 * @param {Object} options Options (see verifyProxy).
 * @return {Promise<string|null>} Failure, or null when healthy.
 */
export async function checkHealth({ baseUrl, fetch, timeoutMs, headers }) {
	const url = `${baseUrl}${HEALTH_PATH}`;
	const fail = (detail, hint) =>
		`Health check ${HEALTH_PATH} ${detail}. ${hint}`;

	const { response, text, error } = await send({
		fetch,
		url,
		init: {
			method: 'GET',
			headers: { Accept: 'application/json', ...headers },
		},
		timeoutMs,
	});
	if (error) {
		return fail(error, PAUSED_HINT);
	}

	const redirect = redirectProblem(response, url);
	if (redirect) {
		return fail(redirect, PAUSED_HINT);
	}

	const { json, problem } = readJson(response, text);
	if (problem) {
		return fail(problem, PAUSED_HINT);
	}

	if (response.status === 404 && json?.code === 'rest_no_route') {
		return fail('route is missing (HTTP 404 rest_no_route)', PAUSED_HINT);
	}

	if (json?.service !== SERVICE) {
		return fail(
			`answered HTTP ${response.status} without the proxy's service identifier`,
			PAUSED_HINT
		);
	}

	if (response.status === 503 || json.status === 'unhealthy') {
		return fail(
			`reports unhealthy (HTTP ${response.status})`,
			UNHEALTHY_HINT
		);
	}

	if (response.status !== 200 || json.status !== 'ok') {
		return fail(
			`answered an unexpected status (HTTP ${response.status})`,
			UNHEALTHY_HINT
		);
	}

	return null;
}

/**
 * Check that the token-refresh endpoint answers as the proxy, with an empty
 * request that never carries a token.
 *
 * @param {Object} options Options (see verifyProxy).
 * @return {Promise<string|null>} Failure, or null when it answers.
 */
export async function checkRefresh({ baseUrl, fetch, timeoutMs, headers }) {
	const url = `${baseUrl}${REFRESH_PATH}`;
	const fail = (detail) =>
		`Refresh check ${REFRESH_PATH} ${detail}. ${REWRITE_HINT}`;

	const { response, text, error } = await send({
		fetch,
		url,
		init: {
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/x-www-form-urlencoded',
				...headers,
			},
			body: '',
		},
		timeoutMs,
	});
	if (error) {
		return fail(error);
	}

	const redirect = redirectProblem(response, url);
	if (redirect) {
		return fail(redirect);
	}

	const { json, problem } = readJson(response, text);
	if (problem) {
		return fail(problem);
	}

	if (
		response.status !== 400 ||
		json?.success !== false ||
		json?.data?.message !== 'Missing refresh_token'
	) {
		return fail(
			`answered HTTP ${response.status} instead of the proxy's "Missing refresh_token" 400`
		);
	}

	return null;
}

/**
 * Verify the proxy, retrying a bounded number of times.
 *
 * @param {Object}   options           Options.
 * @param {string}   options.baseUrl   Site URL, e.g. https://fair-event-plugins.com.
 * @param {Function} [options.fetch]   Fetch implementation.
 * @param {number}   [options.attempts] Attempts.
 * @param {number}   [options.delayMs] Delay between attempts.
 * @param {number}   [options.timeoutMs] Timeout per request.
 * @param {Object}   [options.headers] Extra request headers (tests only).
 * @param {Function} [options.log]     Progress logger.
 * @param {Function} [options.sleep]   Delay implementation.
 * @return {Promise<{ok: boolean, failures: string[]}>} Result of the last attempt.
 */
export async function verifyProxy({
	baseUrl,
	fetch = globalThis.fetch,
	attempts = 5,
	delayMs = 10000,
	timeoutMs = 15000,
	headers = {},
	log = console.log,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
	const options = {
		baseUrl: String(baseUrl).replace(/\/+$/, ''),
		fetch,
		timeoutMs,
		headers,
	};
	let failures = [];

	for (let attempt = 1; attempt <= attempts; attempt++) {
		failures = [
			await checkHealth(options),
			await checkRefresh(options),
		].filter(Boolean);

		if (failures.length === 0) {
			log(
				`OAuth proxy at ${options.baseUrl} is answering (attempt ${attempt}/${attempts}).`
			);
			return { ok: true, failures };
		}

		log(`Attempt ${attempt}/${attempts} failed:`);
		for (const failure of failures) {
			log(`  - ${failure}`);
		}
		if (attempt < attempts) {
			await sleep(delayMs);
		}
	}

	return { ok: false, failures };
}

/**
 * Parse command-line options.
 *
 * @param {string[]} argv Arguments.
 * @return {Object} Options for verifyProxy.
 */
export function parseArgs(argv) {
	const values = {};
	for (const arg of argv) {
		const match = arg.match(/^--([a-z]+)=(.*)$/);
		if (!match) {
			throw new Error(`Unknown argument: ${arg}`);
		}
		values[match[1]] = match[2];
	}

	if (!values.url || !/^https?:\/\//.test(values.url)) {
		throw new Error('--url=<http(s) site URL> is required');
	}

	const number = (name, fallback, min) => {
		if (values[name] === undefined) {
			return fallback;
		}
		const value = Number(values[name]);
		if (!Number.isInteger(value) || value < min) {
			throw new Error(`--${name} must be an integer >= ${min}`);
		}
		return value;
	};

	return {
		baseUrl: values.url,
		attempts: number('attempts', 5, 1),
		delayMs: number('delay', 10000, 0),
		timeoutMs: number('timeout', 15000, 1),
	};
}

async function main() {
	let options;
	try {
		options = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(error.message);
		process.exit(2);
	}

	const { ok, failures } = await verifyProxy(options);
	if (!ok) {
		for (const failure of failures) {
			console.error(
				process.env.GITHUB_ACTIONS
					? `::error title=OAuth proxy not answering::${failure}`
					: failure
			);
		}
		process.exit(1);
	}
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
	await main();
}
